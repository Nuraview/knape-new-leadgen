/**
 * Machine ingest — the scraper and the WhatsApp bridge.
 *
 * Ported from apps/web/app/api/ingest/**. These nine routes are the reason the
 * business has leads: `nuraview-scraper` and `nuraview-whatsapp` POST here with
 * a bearer token and hard-coded `https://crmx1.nuraview.com` URLs. When crmx1
 * is repointed at this stack, that traffic arrives here. If any path is missing
 * or renamed, lead ingestion stops silently — the scraper just logs failures
 * into its own container.
 *
 * Consequences, all deliberate:
 *
 * - **Paths and payload shapes are frozen.** The callers are deployed
 *   containers we are not changing in this migration.
 * - **The SQL is copied verbatim**, comments included. Several statements
 *   encode production incidents (the ON CONFLICT target below cost ~6h of lost
 *   leads on 2026-05-03). This is not the place to tidy queries.
 * - Mounted BEFORE session middleware, and listed in PUBLIC_PREFIXES.
 * - Raw `sql` rather than typed Drizzle tables for `scrape_runs`,
 *   `scraper_heartbeat`, `scraper_cookies`, `whatsapp_*`: those tables are
 *   owned by the legacy app and the bridge, and re-declaring them here would
 *   invite drizzle-kit to propose DDL against tables we only borrow.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import * as z from "zod";
import crmDb from "../database/crm";
import { crmLeadEnrichment, crmLeadSources } from "../database/crm-schema";
import { sendInngestEvents } from "../events/inngest-send";
import { requireScraperAuth, requireWhatsappAuth } from "../utils/ingest-auth";
import { sanitizeName } from "../utils/sanitize-name";

/** node-postgres returns {rows}; drizzle's execute sometimes returns the array. */
function toRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return (rows ?? []) as Record<string, unknown>[];
}

function parseOr400<T>(schema: z.ZodType<T>, json: unknown, label: string): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: JSON.stringify({ error: label, issues: parsed.error.issues }),
    });
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Upwork lead ingest
// ---------------------------------------------------------------------------

// Keep this permissive — the scraper owns its payload format and we store the
// full object in `source_payload`. Only fields we display/query are lifted into
// typed columns. Gemini enrichment may produce "Not Found" strings; we
// normalize at ingest time.
const ItemSchema = z
  .object({
    upwork_job_url: z.string().min(1),
    upwork_job_id: z.string().optional().nullable(),
    extracted_at: z.string().optional().nullable(),
    company: z.string().optional().nullable(),
    first_name: z.string().optional().nullable(),
    last_name: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    job_title: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    payload: z.unknown().optional(),
  })
  .loose();

const UpworkBodySchema = z.object({
  items: z.array(ItemSchema).min(1).max(500),
});

/** Cached lookup — avoid re-querying per item. */
let upworkSourceIdCache: string | null = null;

async function getUpworkSourceId(): Promise<string | null> {
  if (upworkSourceIdCache) return upworkSourceIdCache;
  const [row] = await crmDb
    .select({ id: crmLeadSources.id })
    .from(crmLeadSources)
    .where(eq(crmLeadSources.name, "Upwork"))
    .limit(1);
  upworkSourceIdCache = row?.id ?? null;
  return upworkSourceIdCache;
}

/** "Not Found" is Gemini's sentinel for missing data — map it to null. */
function clean(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "not found" || t.toLowerCase() === "n/a")
    return null;
  return t;
}

/**
 * The pusher sends either ISO-8601 (happy path) or en-IN locale strings
 * (e.g. "23/04/2026, 15:57:00") — try both, fall back to now().
 */
function parseExtractedAt(v: string | null | undefined): string {
  if (!v) return new Date().toISOString();
  const d = new Date(v);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  const m = v.match(/(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, dd, mm, yyyy, hh, mi, ss] = m;
    const parsed = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss ?? "00"}+05:30`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

const RELATIVE_UNIT = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000, // ~30d
  year: 31_536_000_000,
} as const;

/**
 * Parse the scraper's relative `posted_at` ("5 hours ago") into a UTC
 * timestamp, anchored to `extractedAtIso` — the label is relative to the moment
 * we scraped it. Null when unparseable; the reviewer falls back to extractedAt.
 */
function parsePostedAt(raw: unknown, extractedAtIso: string): string | null {
  if (typeof raw !== "string") return null;
  const extractedMs = new Date(extractedAtIso).getTime();
  if (Number.isNaN(extractedMs)) return null;

  const s = raw.trim().toLowerCase();
  // Junk / no-date sentinels the scraper emits when it couldn't read a date.
  if (!s || s === "unknown" || s === "·" || s === "-" || s === "n/a") return null;

  const at = (deltaMs: number) => new Date(extractedMs - deltaMs).toISOString();

  if (/^(just\s*now|just\s*posted|now|recently|today)\b/.test(s)) return at(0);
  if (/^(a\s+)?moments?\s+ago\b/.test(s)) return at(0);
  if (/^yesterday\b/.test(s)) return at(RELATIVE_UNIT.day);

  const lastM = s.match(/^last\s+(week|month|year)\b/);
  if (lastM) return at(RELATIVE_UNIT[lastM[1] as keyof typeof RELATIVE_UNIT]);

  const m = s.match(
    /^(?:(\d+)|an?)\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/,
  );
  if (m) {
    const n = m[1] ? Number(m[1]) : 1;
    return at(n * RELATIVE_UNIT[m[2] as keyof typeof RELATIVE_UNIT]);
  }

  return null;
}

/**
 * Does this payload carry real logged-in client data, or just placeholders?
 * Score >= 2 signals => has_client_info = true.
 *
 * After Upwork's May 2026 About-the-client redesign the rating / review_count /
 * "Payment method verified" elements were removed or renamed, so industry,
 * hires, hours, total_spent_label and member_since are counted too — all of
 * which only render on logged-in pages, keeping the score a faithful
 * "session alive" proxy.
 */
function scoreClientInfo(p: unknown): boolean {
  if (!p || typeof p !== "object") return false;
  const rec = p as Record<string, unknown>;

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
  if (n(rec.client_rating) > 0) score++;
  if (n(rec.client_review_count) > 0) score++;
  const jp = String(rec.client_total_jobs_posted ?? "").toLowerCase();
  if (jp && /\d/.test(jp) && !jp.startsWith("unknown")) score++;
  if (String(rec.client_payment_verified ?? "").toLowerCase() === "true") score++;
  if (n(rec.client_jobs_completed) > 0) score++;
  // New-layout signals — added May 2026.
  if (truthyText(rec.client_industry)) score++;
  if (truthyText(rec.client_hires)) score++;
  if (truthyText(rec.client_hours)) score++;
  if (truthyText(rec.client_total_spent_label)) score++;
  if (
    String(rec.client_member_since ?? "").trim().toLowerCase().startsWith("member since")
  )
    score++;

  return score >= 2;
}

/**
 * Extract the canonical Upwork job id (~02XXX) when the scraper didn't send it.
 * The URL slug is unstable — Upwork's search-highlight markup leaks into hrefs,
 * producing `_~02XXX/?…` or `span-class-highlight-X-span_~02XXX/?…` for the
 * SAME job. The trailing `~02XXX` is the stable identifier.
 */
function extractJobId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/_~([0-9]+)\//);
  return m?.[1] ?? null;
}

const ingest = new Hono();

ingest.post("/upwork", requireScraperAuth, async (c) => {
  const body = parseOr400(UpworkBodySchema, await c.req.json().catch(() => null), "Invalid payload");

  let sourceId: string | null;
  try {
    sourceId = await getUpworkSourceId();
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[ingest/upwork] lookup failed:", msg, (e as Error).stack);
    return c.json({ error: "lookup_failed", message: msg }, 500);
  }

  // Fresh leads start with no status — the reviewer assigns Follow-up or Lost
  // once they've eyeballed the lead. A default here would put a hidden "New"
  // behind every row, mismatching the dropdown and making the empty selector
  // lie about persisted state.
  const statusId: string | null = null;

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  // Newly-inserted lead ids that qualify for auto-enrichment. Collected during
  // the loop so we fan out one event batch + one audit INSERT at the end —
  // keeps the ingest hot path cheap.
  const enrichTargets: { leadId: string; hasClientInfo: boolean }[] = [];

  try {
    for (const item of body.items) {
      const extractedAt = parseExtractedAt(item.extracted_at);
      const cleanCompany = clean(item.company);
      // Name fields use sanitizeName — same null-handling as clean(), plus it
      // strips LLM hallucinations ("Person", "Unknown", "Client") that survive
      // Gemini's "return Not Found" instruction.
      const cleanFirstName = sanitizeName(item.first_name);
      const cleanLastName = sanitizeName(item.last_name);
      const cleanEmail = clean(item.email);
      const cleanJobTitle = clean(item.job_title);
      const cleanDescription = clean(item.description);
      const hasClientInfo = scoreClientInfo(item.payload);
      const postedAt = parsePostedAt(
        (item.payload as Record<string, unknown> | undefined)?.posted_at,
        extractedAt,
      );
      const jobId = item.upwork_job_id ?? extractJobId(item.upwork_job_url);

      // UPSERT keyed on upwork_job_url. `upwork_job_id` would be the better
      // dedup key (highlight-markup slug variants share a job id) but its
      // partial index is currently NON-unique: conflicting on job_id 500s every
      // INSERT with "no unique constraint matching ON CONFLICT specification"
      // and freezes lead ingestion entirely — we lost ~6h of leads on
      // 2026-05-03 to exactly that. URL-based conflict misses the highlight-slug
      // dups but keeps the pipeline alive. Do not "fix" this without first
      // promoting the job_id index to unique.
      const conflictTarget = sql`("upwork_job_url") WHERE "upwork_job_url" IS NOT NULL`;

      const result = await crmDb.execute(sql`
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
          -- posted_at is immutable once set — it's the client's posting time,
          -- which doesn't change. Only fill it in when we didn't know before.
          "posted_at" = COALESCE("crm_Leads"."posted_at", EXCLUDED."posted_at"),
          -- extracted_at is the FIRST-SEEN timestamp: set once on INSERT, never
          -- bumped by re-ingestion. Earlier code used GREATEST(existing, new),
          -- which made re-scraped leads LOOK freshly extracted — reviewers saw
          -- hours-old leads as "5m ago". updatedAt below still tells you how
          -- recently the scraper re-confirmed the lead.
          "updatedAt" = now()
        RETURNING (xmax = 0) AS inserted_flag, "id" AS lead_id, "has_client_info" AS has_client_info
      `);

      const row = toRows(result)[0];
      if (!row) {
        skipped++;
      } else if (row.inserted_flag) {
        inserted++;
        // Only NEWLY inserted rows are candidates for auto-enrichment. A row
        // might be re-scraped 50x over its life and we don't want to spend
        // $0.05 each time; the manual Enrich button covers retries.
        enrichTargets.push({
          leadId: String(row.lead_id),
          hasClientInfo: Boolean(row.has_client_info),
        });
      } else {
        updated++;
      }
    }
  } catch (e) {
    const err = e as Error & { code?: string; detail?: string };
    console.error(
      "[ingest/upwork] insert failed:",
      err.message,
      err.code,
      err.detail,
      err.stack,
    );
    return c.json(
      {
        error: "insert_failed",
        message: err.message,
        code: err.code,
        detail: err.detail,
        progress: { inserted, updated, skipped },
      },
      500,
    );
  }

  // Auto-enrichment fan-out. Best-effort and non-blocking — a failure here must
  // not 500 the ingest call: the leads are already persisted, and a 500 would
  // make the scraper retry the whole batch.
  //
  // Gates: only newly inserted rows; only rows where the Upwork session was
  // logged in (otherwise the company name is "Confidential Client" and the
  // waterfall chases noise); globally killable via ENRICHMENT_AUTO_ENABLED.
  const autoEnabled =
    (process.env.ENRICHMENT_AUTO_ENABLED ?? "true").toLowerCase() !== "false";
  const queueable = enrichTargets.filter((t) => t.hasClientInfo);

  if (autoEnabled && queueable.length > 0) {
    try {
      const now = new Date();
      const auditRows = queueable.map((t) => ({
        id: randomUUID(),
        leadId: t.leadId,
        status: "PENDING",
        mode: "auto",
        fields: ["linkedinUrl", "email", "firstName", "lastName"],
        triggeredBy: null,
        createdAt: now,
        updatedAt: now,
      }));

      const insertedAudit = await crmDb
        .insert(crmLeadEnrichment)
        .values(auditRows)
        .returning({
          id: crmLeadEnrichment.id,
          leadId: crmLeadEnrichment.leadId,
        });

      await sendInngestEvents(
        insertedAudit.map((r) => ({
          name: "enrich/lead.run",
          data: { leadId: r.leadId, enrichmentId: r.id, mode: "auto" },
        })),
      );
    } catch (e) {
      // Log, don't fail. Scraper retries target ingest only; enrichment is
      // async and recoverable from the UI.
      console.error(
        "[ingest/upwork] auto-enrich queue failed:",
        (e as Error).message,
      );
    }
  }

  return c.json({
    inserted,
    updated,
    skipped,
    enrichmentsQueued: autoEnabled ? queueable.length : 0,
  });
});

// ---------------------------------------------------------------------------
// Known job ids — lets the scraper skip work it has already done
// ---------------------------------------------------------------------------

// Without this the scraper clicks into all 20 search results every cycle and
// only discovers at upsert that 19 are duplicates — ~17 min of browser work for
// 0-3 new leads. A short window suffices: cards are fetched newest-first, so an
// id older than the window can't appear near the top of a recency-sorted search.
const KNOWN_JOBS_DEFAULT_DAYS = 7;
const KNOWN_JOBS_MAX_DAYS = 30;

ingest.get("/known-jobs", requireScraperAuth, async (c) => {
  const requested = Number.parseInt(c.req.query("days") ?? "", 10);
  const days = Math.min(
    Math.max(1, Number.isFinite(requested) ? requested : KNOWN_JOBS_DEFAULT_DAYS),
    KNOWN_JOBS_MAX_DAYS,
  );

  const result = await crmDb.execute(sql`
    SELECT DISTINCT "upwork_job_id"
      FROM "crm_Leads"
     WHERE "upwork_job_id" IS NOT NULL
       AND COALESCE("extracted_at", "createdAt") > now() - ${days} * interval '1 day'
  `);

  return c.json({
    days,
    jobIds: toRows(result)
      .map((r) => r.upwork_job_id)
      .filter(Boolean),
  });
});

// ---------------------------------------------------------------------------
// Upwork cookies — the pusher pulls these each tick
// ---------------------------------------------------------------------------

ingest.get("/scraper-cookies", requireScraperAuth, async (c) => {
  const since = c.req.query("since");

  const result = await crmDb.execute(sql`
    SELECT uploaded_at, cookies FROM scraper_cookies WHERE id = 1
  `);
  const row = toRows(result)[0];

  if (!row) {
    return c.json({ uploaded_at: null, cookies: null, unchanged: false });
  }

  const uploadedAt =
    row.uploaded_at instanceof Date
      ? row.uploaded_at.toISOString()
      : (row.uploaded_at as string | null);

  if (since && uploadedAt === since) {
    return c.json({ uploaded_at: uploadedAt, unchanged: true });
  }

  return c.json({ uploaded_at: uploadedAt, cookies: row.cookies });
});

// ---------------------------------------------------------------------------
// Scraper heartbeat — one upsert row driving the System Health panel
// ---------------------------------------------------------------------------

const ScraperHeartbeatSchema = z.object({
  cookies_count: z.number().int().nonnegative().optional().nullable(),
  cookies_present: z.boolean().optional().nullable(),
  cookies_min_expiry: z.string().optional().nullable(),
  cookies_hard_expired: z.boolean().optional().nullable(),
  cookies_working: z.boolean().optional().nullable(),
  // "no-info" replaced "expired" as the low-data signal (see the pusher's
  // behavioural_cookie_health()). Both are accepted so an old and a new pusher
  // both report cleanly — without "no-info" the signal-bearing heartbeats 400
  // and only lightweight cycle-start probes refresh updated_at, which falsely
  // trips the "container down" banner during long cycles.
  cookies_signal: z
    .enum(["working", "degraded", "expired", "no-info", "no-data"])
    .optional()
    .nullable(),
  cookies_client_info_rate: z.number().min(0).max(1).optional().nullable(),
  scraper_healthy: z.boolean().optional().nullable(),
  scraper_version: z.string().optional().nullable(),
  gemini_enabled: z.boolean().optional().nullable(),
  keywords: z.array(z.string()).optional().nullable(),
  current_keyword: z.string().optional().nullable(),
  last_error: z.string().optional().nullable(),
});

ingest.post("/scraper-heartbeat", requireScraperAuth, async (c) => {
  const body = parseOr400(
    ScraperHeartbeatSchema,
    await c.req.json().catch(() => null),
    "Invalid heartbeat",
  );

  // keywords is jsonb — serialize the array as JSON text.
  const keywordsJson = body.keywords ? JSON.stringify(body.keywords) : null;

  // Absent current_keyword must not clear the stored one.
  const updateCurrentKeyword =
    body.current_keyword !== undefined
      ? sql`EXCLUDED.current_keyword`
      : sql`scraper_heartbeat.current_keyword`;

  await crmDb.execute(sql`
    INSERT INTO scraper_heartbeat (
      id, updated_at,
      cookies_count, cookies_present, cookies_min_expiry, cookies_hard_expired,
      cookies_working, cookies_signal, cookies_client_info_rate,
      scraper_healthy, scraper_version, gemini_enabled,
      keywords, current_keyword, last_error
    ) VALUES (
      1, now(),
      ${body.cookies_count ?? null},
      ${body.cookies_present ?? null},
      ${body.cookies_min_expiry ?? null}::timestamptz,
      ${body.cookies_hard_expired ?? null},
      ${body.cookies_working ?? null},
      ${body.cookies_signal ?? null},
      ${body.cookies_client_info_rate ?? null},
      ${body.scraper_healthy ?? null},
      ${body.scraper_version ?? null},
      ${body.gemini_enabled ?? null},
      ${keywordsJson}::jsonb,
      ${body.current_keyword ?? null},
      ${body.last_error ?? null}
    )
    ON CONFLICT (id) DO UPDATE SET
      updated_at               = now(),
      cookies_count            = COALESCE(EXCLUDED.cookies_count,            scraper_heartbeat.cookies_count),
      cookies_present          = COALESCE(EXCLUDED.cookies_present,          scraper_heartbeat.cookies_present),
      cookies_min_expiry       = COALESCE(EXCLUDED.cookies_min_expiry,       scraper_heartbeat.cookies_min_expiry),
      cookies_hard_expired     = COALESCE(EXCLUDED.cookies_hard_expired,     scraper_heartbeat.cookies_hard_expired),
      cookies_working          = COALESCE(EXCLUDED.cookies_working,          scraper_heartbeat.cookies_working),
      cookies_signal           = COALESCE(EXCLUDED.cookies_signal,           scraper_heartbeat.cookies_signal),
      cookies_client_info_rate = COALESCE(EXCLUDED.cookies_client_info_rate, scraper_heartbeat.cookies_client_info_rate),
      scraper_healthy          = COALESCE(EXCLUDED.scraper_healthy,          scraper_heartbeat.scraper_healthy),
      scraper_version          = COALESCE(EXCLUDED.scraper_version,          scraper_heartbeat.scraper_version),
      gemini_enabled           = COALESCE(EXCLUDED.gemini_enabled,           scraper_heartbeat.gemini_enabled),
      keywords                 = COALESCE(EXCLUDED.keywords,                 scraper_heartbeat.keywords),
      current_keyword          = ${updateCurrentKeyword},
      last_error               = EXCLUDED.last_error
  `);

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Scrape run lifecycle — drives the live pipeline status on /leads
// ---------------------------------------------------------------------------

const StartSchema = z.object({
  type: z.literal("start"),
  tick_id: z.string().min(1),
  query: z.string().min(1),
  jobs_expected: z.number().int().nonnegative().optional(),
});

const FinishSchema = z.object({
  type: z.literal("finish"),
  tick_id: z.string().min(1),
  query: z.string().min(1),
  status: z.enum(["completed", "failed", "skipped"]),
  jobs_found: z.number().int().nonnegative().optional(),
  jobs_inserted: z.number().int().nonnegative().optional(),
  jobs_updated: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

// Fired at container startup: marks rows still `running` as failed — orphans
// from a previous pusher instance killed mid-scrape (e.g. a compose rebuild).
const CleanupSchema = z.object({ type: z.literal("cleanup") });

const ScraperEventSchema = z.union([StartSchema, FinishSchema, CleanupSchema]);

ingest.post("/scraper-event", requireScraperAuth, async (c) => {
  const event = parseOr400(
    ScraperEventSchema,
    await c.req.json().catch(() => null),
    "Invalid event",
  );

  if (event.type === "cleanup") {
    const result = await crmDb.execute(sql`
      UPDATE "scrape_runs"
         SET "status"      = 'failed',
             "finished_at" = now(),
             "error"       = 'interrupted — pusher restarted before finish event'
       WHERE "status" = 'running'
    `);
    return c.json({
      ok: true,
      cleaned: (result as { rowCount?: number })?.rowCount ?? 0,
    });
  }

  if (event.type === "start") {
    await crmDb.execute(sql`
      INSERT INTO "scrape_runs"
        ("tick_id", "query", "status", "jobs_expected")
      VALUES
        (${event.tick_id}, ${event.query}, 'running', ${event.jobs_expected ?? null})
    `);
    return c.json({ ok: true });
  }

  // finish — update the most recent running row for this tick_id + query
  await crmDb.execute(sql`
    UPDATE "scrape_runs"
    SET
      "status"        = ${event.status},
      "finished_at"   = now(),
      "jobs_found"    = ${event.jobs_found ?? null},
      "jobs_inserted" = ${event.jobs_inserted ?? null},
      "jobs_updated"  = ${event.jobs_updated ?? null},
      "error"         = ${event.error ?? null}
    WHERE "id" = (
      SELECT "id" FROM "scrape_runs"
      WHERE "tick_id" = ${event.tick_id}
        AND "query"   = ${event.query}
        AND "status"  = 'running'
      ORDER BY "started_at" DESC
      LIMIT 1
    )
  `);

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// WhatsApp bridge
// ---------------------------------------------------------------------------

const InboundSchema = z.object({
  message_id: z.string().nullable().optional(),
  from_jid: z.string(),
  pushname: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  timestamp: z.number().nullable().optional(),
  has_media: z.boolean().optional().default(false),
});

ingest.post("/whatsapp-inbound", requireWhatsappAuth, async (c) => {
  const body = parseOr400(
    InboundSchema,
    await c.req.json().catch(() => null),
    "Invalid inbound",
  );

  await crmDb.execute(sql`
    INSERT INTO whatsapp_message (
      message_id, direction, jid, pushname, body, has_media, wa_timestamp
    ) VALUES (
      ${body.message_id ?? null},
      'in',
      ${body.from_jid},
      ${body.pushname ?? null},
      ${body.body ?? null},
      ${body.has_media},
      ${body.timestamp ?? null}
    )
  `);

  return c.json({ ok: true });
});

const OUTBOX_DEFAULT_BATCH = 10;
const OUTBOX_MAX_BATCH = 50;

/**
 * The bridge polls this every few seconds. Claiming rows in a single
 * UPDATE…RETURNING with FOR UPDATE SKIP LOCKED avoids a TOCTOU race where two
 * replicas claim the same row. Singleton today; the contract stays correct.
 */
ingest.get("/whatsapp-outbox", requireWhatsappAuth, async (c) => {
  const requested = Number.parseInt(c.req.query("limit") ?? "", 10);
  const limit = Number.isFinite(requested)
    ? Math.min(OUTBOX_MAX_BATCH, Math.max(1, requested))
    : OUTBOX_DEFAULT_BATCH;

  // Each bridge socket claims only rows tagged for its own account. Default to
  // 'primary' so an older bridge build that omits the param still drains.
  const account = c.req.query("account") || "primary";

  /*
   * OPERATIONAL ALERTS GO STALE.
   *
   * The bridge lost its WhatsApp session on 13 July and nothing has sent since,
   * so pending rows have been piling up — 182 of them, including work-clock
   * pauses from weeks ago. Re-pairing would have delivered every one of them at
   * once, as if they had all just happened.
   *
   * A batch of stale alerts is worse than silence: it buries whatever is
   * actually current, and it reports old events as new. Anything older than the
   * TTL is retired here rather than sent — at claim time, so it needs no cron
   * and cannot race the drain.
   */
  /*
   * 'failed', NOT 'expired': whatsapp_outbox has a CHECK constraint allowing
   * only pending/sending/sent/failed. Writing 'expired' made THIS statement
   * throw on every poll, which 500'd the whole claim endpoint — the bridge
   * could not drain ANYTHING, and 42 messages (a full day, VK's clock alerts
   * included) sat pending behind a retirement query meant to prevent exactly
   * that kind of pile-up. The error text carries the "expired" meaning;
   * failed rows are never retried, which is the behaviour wanted here.
   */
  const ttlHours = Number(process.env.WHATSAPP_OUTBOX_TTL_HOURS ?? 24);
  if (Number.isFinite(ttlHours) && ttlHours > 0) {
    await crmDb.execute(sql`
      UPDATE whatsapp_outbox
         SET status = 'failed',
             error  = 'Expired: not sent within ' || ${ttlHours} || 'h of being queued'
       WHERE status = 'pending'
         AND created_at < now() - (${ttlHours} || ' hours')::interval
         -- Lead-flow and cookie alerts never expire. Every other alert
         -- describes a moment that has passed; these describe a condition still
         -- true until someone fixes it, and they are the messages most worth
         -- delivering late.
         AND body NOT LIKE '[lead-flow]%'
         AND body NOT LIKE '[cookies]%'
    `);
  }

  const result = await crmDb.execute(sql`
    UPDATE whatsapp_outbox
       SET status       = 'sending',
           attempts     = attempts + 1,
           attempted_at = now()
     WHERE id IN (
       SELECT id FROM whatsapp_outbox
        WHERE status = 'pending'
          AND account = ${account}
        ORDER BY created_at ASC
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id, to_jid, body
  `);

  return c.json({ items: toRows(result) });
});

const OutboxResultSchema = z.object({
  id: z.uuid(),
  status: z.enum(["sent", "failed"]),
  message_id: z.string().optional().nullable(),
  error: z.string().optional().nullable(),
});

ingest.post("/whatsapp-outbox/result", requireWhatsappAuth, async (c) => {
  const body = parseOr400(
    OutboxResultSchema,
    await c.req.json().catch(() => null),
    "Invalid result",
  );

  if (body.status === "sent") {
    await crmDb.execute(sql`
      UPDATE whatsapp_outbox
         SET status     = 'sent',
             message_id = ${body.message_id ?? null},
             error      = NULL,
             sent_at    = now()
       WHERE id = ${body.id}::uuid
    `);
    // Mirror into the message log for the unified thread view.
    await crmDb.execute(sql`
      INSERT INTO whatsapp_message (message_id, direction, jid, body, lead_id)
      SELECT message_id, 'out', to_jid, body, lead_id
        FROM whatsapp_outbox
       WHERE id = ${body.id}::uuid
    `);
  } else {
    await crmDb.execute(sql`
      UPDATE whatsapp_outbox
         SET status = 'failed',
             error  = ${body.error ?? "unknown"}
       WHERE id = ${body.id}::uuid
    `);
  }

  return c.json({ ok: true });
});

const WhatsappHeartbeatSchema = z.object({
  // Which paired account this heartbeat is for. Older bridge builds (and the
  // single-number setup) omit it — default to 'primary' so they keep working.
  account: z.string().min(1).max(64).optional(),
  label: z.string().max(120).optional().nullable(),
  connected: z.boolean().optional().nullable(),
  jid: z.string().optional().nullable(),
  last_seen_at: z.string().optional().nullable(),
  qr_data_url: z.string().optional().nullable(),
  qr_issued_at: z.string().optional().nullable(),
  last_error: z.string().optional().nullable(),
});

ingest.post("/whatsapp-heartbeat", requireWhatsappAuth, async (c) => {
  const body = parseOr400(
    WhatsappHeartbeatSchema,
    await c.req.json().catch(() => null),
    "Invalid heartbeat",
  );

  const account = body.account ?? "primary";

  // qr_data_url and last_error get a full overwrite (cleared on reconnect or
  // pair). jid/label only get overwritten with non-null so a transient null
  // doesn't wipe them. One row per account.
  await crmDb.execute(sql`
    INSERT INTO whatsapp_session (
      account, label, updated_at, connected, jid, last_seen_at, qr_data_url, qr_issued_at, last_error
    ) VALUES (
      ${account},
      ${body.label ?? null},
      now(),
      ${body.connected ?? null},
      ${body.jid ?? null},
      ${body.last_seen_at ?? null}::timestamptz,
      ${body.qr_data_url ?? null},
      ${body.qr_issued_at ?? null}::timestamptz,
      ${body.last_error ?? null}
    )
    ON CONFLICT (account) DO UPDATE SET
      label        = COALESCE(EXCLUDED.label,        whatsapp_session.label),
      updated_at   = now(),
      connected    = COALESCE(EXCLUDED.connected,    whatsapp_session.connected),
      jid          = COALESCE(EXCLUDED.jid,          whatsapp_session.jid),
      last_seen_at = COALESCE(EXCLUDED.last_seen_at, whatsapp_session.last_seen_at),
      qr_data_url  = EXCLUDED.qr_data_url,
      qr_issued_at = EXCLUDED.qr_issued_at,
      last_error   = EXCLUDED.last_error
  `);

  return c.json({ ok: true });
});

export default ingest;
