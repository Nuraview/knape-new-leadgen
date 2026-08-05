import { NextRequest, NextResponse } from "next/server";

import { eq, sql as dsql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { crmLeadEnrichment, crmLeadSources } from "@/drizzle/schema";
import { inngest } from "@/inngest/client";
import { requireScraperAuth } from "@/lib/ingest-auth";
import { sanitizeName } from "@/lib/sanitize-name";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Shape of one scraped posting. Keep this permissive — the scraper owns its
// payload format and we store the full object in `source_payload`. Only the
// fields we display/query are lifted into typed columns.
// Be forgiving — the scraper returns heterogeneous fields and Gemini
// enrichment may produce "Not Found" strings. We normalize at ingest time.
const ItemSchema = z
  .object({
    upwork_job_url: z.string().min(1),
    upwork_job_id: z.string().optional().nullable(),
    // accept any string, we parse server-side
    extracted_at: z.string().optional().nullable(),
    company: z.string().optional().nullable(),
    first_name: z.string().optional().nullable(),
    last_name: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    job_title: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    payload: z.unknown().optional(),
  })
  .passthrough();

const BodySchema = z.object({
  items: z.array(ItemSchema).min(1).max(500),
});

// Cached lookup — avoid re-querying per item.
let upworkSourceIdCache: string | null = null;

async function getUpworkSourceId(): Promise<string | null> {
  if (upworkSourceIdCache) return upworkSourceIdCache;
  const [row] = await db
    .select({ id: crmLeadSources.id })
    .from(crmLeadSources)
    .where(eq(crmLeadSources.name, "Upwork"))
    .limit(1);
  upworkSourceIdCache = row?.id ?? null;
  return upworkSourceIdCache;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const unauth = requireScraperAuth(req);
  if (unauth) return unauth;

  let body: z.infer<typeof BodySchema>;
  try {
    const json = await req.json();
    body = BodySchema.parse(json);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid payload", issues: err.issues },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let sourceId: string | null;
  try {
    sourceId = await getUpworkSourceId();
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[ingest/upwork] lookup failed:", msg, (e as Error).stack);
    return NextResponse.json(
      { error: "lookup_failed", message: msg },
      { status: 500 },
    );
  }
  // Fresh leads start with no status — the reviewer assigns Follow-up or
  // Lost themselves once they've eyeballed the lead. Keeping a default
  // here would put a hidden "New" value behind every row, which mismatches
  // the dropdown (only Follow-up + Lost) and makes the empty selector lie
  // about persisted state.
  const statusId: string | null = null;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  // Newly-inserted lead IDs that qualify for auto-enrichment. We collect
  // them during the loop and fan out one Inngest event batch + one audit
  // INSERT at the end — keeps the ingest hot path cheap.
  const enrichTargets: { leadId: string; hasClientInfo: boolean }[] = [];

  // "Not Found" is Gemini's sentinel for missing data — map to null so the
  // front-end doesn't treat it as real content.
  const clean = (v: string | null | undefined): string | null => {
    if (v == null) return null;
    const t = v.trim();
    if (!t || t.toLowerCase() === "not found" || t.toLowerCase() === "n/a")
      return null;
    return t;
  };

  // The pusher sends either ISO-8601 (happy path) or en-IN locale strings
  // (e.g. "23/04/2026, 15:57:00") — try both, fall back to now().
  const parseExtractedAt = (v: string | null | undefined): string => {
    if (!v) return new Date().toISOString();
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString();
    // en-IN: "dd/mm/yyyy, HH:MM:SS"
    const m = v.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      const [_, dd, mm, yyyy, hh, mi, ss] = m;
      const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss ?? "00"}+05:30`;
      const parsed = new Date(iso);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return new Date().toISOString();
  };

  // Parse the scraper's relative `posted_at` string (e.g. "5 hours ago",
  // "13 minutes ago") into an actual UTC timestamp, using `extractedAt` as
  // the reference point. Returns null when the string doesn't match or is
  // absent — reviewer should rely on extractedAt as fallback.
  const RELATIVE_UNIT = {
    second: 1000,
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000, // ~30d
    year: 31_536_000_000,
  } as const;
  const parsePostedAt = (
    raw: unknown,
    extractedAtIso: string,
  ): string | null => {
    if (typeof raw !== "string") return null;
    const extractedMs = new Date(extractedAtIso).getTime();
    if (isNaN(extractedMs)) return null;

    // Upwork's relative label, normalized. Everything is anchored to
    // extractedAt (when we scraped it) — the label is relative to that moment.
    const s = raw.trim().toLowerCase();
    // Junk / no-date sentinels the scraper emits when it couldn't read a date.
    if (!s || s === "unknown" || s === "·" || s === "-" || s === "n/a") {
      return null;
    }
    const at = (deltaMs: number) =>
      new Date(extractedMs - deltaMs).toISOString();

    // "just now" / "moments ago" / "recently" / "today" — posted so recently
    // (or same-day with no finer detail) that we anchor it to the scrape time.
    if (/^(just\s*now|just\s*posted|now|recently|today)\b/.test(s)) return at(0);
    if (/^(a\s+)?moments?\s+ago\b/.test(s)) return at(0);

    // "yesterday" → one day before the scrape.
    if (/^yesterday\b/.test(s)) return at(RELATIVE_UNIT.day);

    // "last week" / "last month" / "last year".
    const lastM = s.match(/^last\s+(week|month|year)\b/);
    if (lastM) {
      return at(RELATIVE_UNIT[lastM[1] as keyof typeof RELATIVE_UNIT]);
    }

    // "<n> <unit>(s) ago"  OR  "a/an <unit> ago" (e.g. "an hour ago").
    const m = s.match(
      /^(?:(\d+)|an?)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/,
    );
    if (m) {
      const n = m[1] ? Number(m[1]) : 1;
      const unit = m[2] as keyof typeof RELATIVE_UNIT;
      return at(n * RELATIVE_UNIT[unit]);
    }

    return null;
  };

  // The pusher flattens the scraper's nested `client_info.x` into top-level
  // `client_x` keys in the payload. This evaluates whether a payload carries
  // actual logged-in data (rating, review count, industry, hires, etc.) or
  // just placeholders. Score ≥ 2 signals → `has_client_info = true`.
  //
  // After Upwork's May 2026 About-the-client redesign, the rating /
  // review_count / "Payment method verified" / job-posting-stats elements
  // were removed or renamed. We now also count `client_industry`,
  // `client_hires`, `client_hours`, `client_total_spent_label`, and
  // `client_member_since`, all of which only render on logged-in pages —
  // so the score remains a faithful "session alive" proxy.
  const scoreClientInfo = (p: any): boolean => {
    if (!p || typeof p !== "object") return false;
    const n = (v: unknown): number => {
      if (typeof v !== "string" && typeof v !== "number") return 0;
      const s = String(v).replace(/[^0-9.]/g, "");
      return s ? Number(s) : 0;
    };
    const truthyText = (v: unknown): boolean => {
      const s = String(v ?? "").trim().toLowerCase();
      return s !== "" && s !== "unknown" && s !== "n/a" && s !== "0";
    };
    let score = 0;
    if (n(p.client_rating) > 0) score++;
    if (n(p.client_review_count) > 0) score++;
    const jp = String(p.client_total_jobs_posted ?? "").toLowerCase();
    if (jp && /\d/.test(jp) && !jp.startsWith("unknown")) score++;
    if (String(p.client_payment_verified ?? "").toLowerCase() === "true")
      score++;
    if (n(p.client_jobs_completed) > 0) score++;
    // New-layout signals — added May 2026.
    if (truthyText(p.client_industry)) score++;
    if (truthyText(p.client_hires)) score++;
    if (truthyText(p.client_hours)) score++;
    if (truthyText(p.client_total_spent_label)) score++;
    if (
      String(p.client_member_since ?? "")
        .trim()
        .toLowerCase()
        .startsWith("member since")
    )
      score++;
    return score >= 2;
  };

  // Extract the canonical Upwork job ID (~02XXX) from the URL when the
  // scraper didn't send it. The URL slug is unstable — Upwork's HTML
  // search highlight markup leaks into hrefs producing
  // `_~02XXX/?...` or `span-class-highlight-X-span_~02XXX/?...` for the
  // SAME job. The trailing `~02XXX` is the stable identifier.
  const extractJobId = (url: string | null | undefined): string | null => {
    if (!url) return null;
    const m = url.match(/_~([0-9]+)\//);
    return m ? m[1] : null;
  };

  // Use a single SQL round-trip per item — simpler, good enough at the
  // expected scraper rate (< 50 items per batch).
  try {
  for (const item of body.items) {
    const extractedAt = parseExtractedAt(item.extracted_at as string | null | undefined);
    const cleanCompany = clean(item.company);
    // Name fields use sanitizeName — same null-handling as clean(), plus
    // it strips LLM hallucinations ("Person", "Unknown", "Client", etc.)
    // that survive Gemini's "return Not Found" instruction.
    const cleanFirstName = sanitizeName(item.first_name);
    const cleanLastName = sanitizeName(item.last_name);
    const cleanEmail = clean(item.email);
    const cleanJobTitle = clean(item.job_title);
    const cleanDescription = clean(item.description);
    const hasClientInfo = scoreClientInfo(item.payload);
    const postedAt = parsePostedAt(
      (item.payload as any)?.posted_at,
      extractedAt,
    );
    const jobId =
      item.upwork_job_id ?? extractJobId(item.upwork_job_url);

    // UPSERT keyed on upwork_job_url. `upwork_job_id` would be the better
    // dedup key (highlight-markup slug variants share a job ID) but its
    // partial index is currently NON-unique — see commit 7583028: the
    // unique promotion is blocked by 43 dup pairs in prod that still need
    // a one-shot cleanup. Until that lands, conflicting on job_id 500s
    // every INSERT with "no unique constraint matching ON CONFLICT
    // specification" and freezes lead ingestion entirely (we lost ~6h of
    // leads on 2026-05-03 to this). URL-based conflict misses the
    // highlight-slug dups but at least keeps the pipeline alive.
    const conflictTarget = dsql`("upwork_job_url") WHERE "upwork_job_url" IS NOT NULL`;
    const result: any = await db.execute(dsql`
      INSERT INTO "crm_Leads" (
        "id", "__v", "createdAt",
        "firstName", "lastName", "company", "jobTitle", "email", "description",
        "lead_source_id", "lead_status_id",
        "upwork_job_url", "upwork_job_id", "extracted_at", "source_payload",
        "has_client_info", "posted_at"
      ) VALUES (
        gen_random_uuid(), 0, now(),
        ${cleanFirstName},
        ${cleanLastName ?? ""},
        ${cleanCompany},
        ${cleanJobTitle},
        ${cleanEmail},
        ${cleanDescription},
        ${sourceId},
        ${statusId},
        ${item.upwork_job_url},
        ${jobId},
        ${extractedAt}::timestamp,
        ${JSON.stringify(item.payload ?? null)}::jsonb,
        ${hasClientInfo},
        ${postedAt}::timestamp
      )
      ON CONFLICT ${conflictTarget}
      DO UPDATE SET
        -- Refresh the URL too — same job, possibly a cleaner slug arrived.
        "upwork_job_url" = COALESCE(EXCLUDED."upwork_job_url", "crm_Leads"."upwork_job_url"),
        "company" = COALESCE(EXCLUDED."company", "crm_Leads"."company"),
        "jobTitle" = COALESCE(EXCLUDED."jobTitle", "crm_Leads"."jobTitle"),
        "email" = COALESCE(EXCLUDED."email", "crm_Leads"."email"),
        "firstName" = COALESCE(EXCLUDED."firstName", "crm_Leads"."firstName"),
        "description" = COALESCE(EXCLUDED."description", "crm_Leads"."description"),
        "source_payload" = EXCLUDED."source_payload",
        -- Upgrade has_client_info when a re-scrape delivers better data, but
        -- never downgrade (a transient bad scrape shouldn't clear an earlier
        -- good classification).
        "has_client_info" = "crm_Leads"."has_client_info" OR EXCLUDED."has_client_info",
        -- posted_at is immutable once set — it's the Upwork client's posting
        -- time, which doesn't change. Only fill it in when we didn't know
        -- before.
        "posted_at" = COALESCE("crm_Leads"."posted_at", EXCLUDED."posted_at"),
        -- extracted_at is the FIRST-SEEN timestamp. It's set once on INSERT
        -- and never bumped by re-ingestion. Earlier code used
        -- GREATEST(existing, new) which made re-scraped leads LOOK freshly
        -- extracted — a correctness bug. Reviewers were seeing leads that
        -- had been in the DB for hours as "5m ago". Keep the original.
        --
        -- "updatedAt" is bumped below so you can still tell how recently the
        -- scraper re-confirmed this lead.
        "updatedAt" = now()
      RETURNING (xmax = 0) AS inserted_flag, "id" AS lead_id, "has_client_info" AS has_client_info
    `);

    const rows: any[] = Array.isArray(result)
      ? result
      : (result?.rows ?? []);
    if (rows.length === 0) {
      skipped++;
    } else if (rows[0].inserted_flag) {
      inserted++;
      // Only NEWLY inserted rows are candidates for auto-enrichment.
      // We don't re-run on UPDATEs (re-scrapes) — a row might be
      // re-scraped 50× over its life and we don't want to spend $0.05
      // each time. Manual "Enrich" button covers retries.
      enrichTargets.push({
        leadId: rows[0].lead_id,
        hasClientInfo: !!rows[0].has_client_info,
      });
    } else {
      updated++;
    }
  }

  } catch (e) {
    const err = e as Error & { code?: string; detail?: string };
    console.error("[ingest/upwork] insert failed:", err.message, err.code, err.detail, err.stack);
    return NextResponse.json(
      {
        error: "insert_failed",
        message: err.message,
        code: err.code,
        detail: err.detail,
        progress: { inserted, updated, skipped },
      },
      { status: 500 },
    );
  }

  // ------------------------------------------------------------------
  // Auto-enrichment fan-out. Best-effort, non-blocking — a failure here
  // must not 500 the ingest call, since the leads are already persisted
  // and the manual "Enrich" button covers retries.
  //
  // Gates:
  //   - Only NEWLY inserted rows (we don't re-enrich on every re-scrape).
  //   - Only rows where the Upwork session was logged in
  //     (`hasClientInfo === true`). Otherwise the company name is a
  //     placeholder ("Confidential Client") and serper would chase noise.
  //   - Globally togglable via env: ENRICHMENT_AUTO_ENABLED=false to
  //     halt all auto-runs (e.g. while debugging budget overruns).
  // ------------------------------------------------------------------
  const autoEnabled =
    (process.env.ENRICHMENT_AUTO_ENABLED ?? "true").toLowerCase() !== "false";
  const queueable = enrichTargets.filter((t) => t.hasClientInfo);
  if (autoEnabled && queueable.length > 0) {
    try {
      const nowIso = new Date().toISOString();
      const auditRows = queueable.map((t) => ({
        id: crypto.randomUUID(),
        leadId: t.leadId,
        status: "PENDING" as const,
        mode: "auto",
        fields: ["linkedinUrl", "email", "firstName", "lastName"],
        triggeredBy: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      }));
      const insertedAudit = await db
        .insert(crmLeadEnrichment)
        .values(auditRows)
        .returning({
          id: crmLeadEnrichment.id,
          leadId: crmLeadEnrichment.leadId,
        });
      await inngest.send(
        insertedAudit.map((r) => ({
          name: "enrich/lead.run",
          data: {
            leadId: r.leadId,
            enrichmentId: r.id,
            mode: "auto",
          },
        })),
      );
    } catch (e) {
      // Log but don't fail the ingest. The scraper retries are aimed at
      // ingest only — enrichment is async and recoverable.
      const msg = (e as Error).message;
      console.error("[ingest/upwork] auto-enrich queue failed:", msg);
    }
  }

  return NextResponse.json({
    inserted,
    updated,
    skipped,
    enrichmentsQueued: autoEnabled ? queueable.length : 0,
  });
}
