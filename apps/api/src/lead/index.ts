/**
 * Leads — the first NuraView CRM domain ported off Next.js.
 *
 * Replaces apps/web/app/(routes)/leads + actions/leads/*. Reads the live
 * crm_Leads table (~50k rows) through the separate CRM connection.
 *
 * Deliberately one aggregate endpoint per view rather than one endpoint per
 * server action: the legacy page issued several sequential queries inside a
 * single RSC render, and turning those into separate HTTP calls would make the
 * SPA slower than the page it replaces.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import crmDb, { isCrmConfigured } from "../database/crm";
import { requireLeadsAccess } from "../utils/require-crm-access";
import { sendInngestEvents } from "../events/inngest-send";
import { getTodayActivity } from "./activity-today";
import { resolveCrmActorId } from "./crm-actor";
import leadSendEmail from "./send-email";
import {
  crmLeadEnrichment,
  crmLeadStatuses,
  crmLeadViews,
  crmLeads,
} from "../database/crm-schema";

const MAX_PAGE_SIZE = 100;

/**
 * The total/addedRecently counts scan the whole filtered set — 50k+ rows, a
 * ~190ms sequential scan that no index avoids because the filter matches
 * 99.6% of the table. Recomputing it on every keystroke dominated the
 * endpoint's response time.
 *
 * The number moves slowly (a scraper trickle), so a short cache keyed by the
 * active filters is accurate enough for a headline count and removes the scan
 * from almost every request. Kept small and in-process deliberately: no Redis
 * dependency for something this cheap to rebuild.
 */
const COUNT_TTL_MS = 20_000;
const countCache = new Map<string, { at: number; value: { total: number; addedRecently: number } }>();

function cachedCounts(key: string) {
  const hit = countCache.get(key);
  if (hit && Date.now() - hit.at < COUNT_TTL_MS) return hit.value;
  return null;
}

function storeCounts(key: string, value: { total: number; addedRecently: number }) {
  // Bounded so a wide variety of filter combinations cannot grow it forever.
  if (countCache.size > 200) countCache.clear();
  countCache.set(key, { at: Date.now(), value });
}

function requireCrm() {
  if (!isCrmConfigured()) {
    throw new HTTPException(503, {
      message:
        "CRM_DATABASE_URL is not configured — see apps/api/.env.example",
    });
  }
}

const lead = new Hono<{ Variables: { userId: string; userEmail: string } }>()
  /*
   * One gate for the whole domain: leads are the lead-gen role's job.
   *
   * This used to split hairs — reads went to the leads role, writes went to
   * full CRM, and a hand-maintained allow-list decided which writes were
   * "kanban enough". That list was wrong every time the product grew: the role
   * could research a lead, save the email it found and draft the outreach, then
   * got 403 on Send, because send-email had never been added to it. Each gap
   * read as the employee not doing the work.
   *
   * Everything under /lead is now open to any leads account, and everything
   * outside /lead still requires full CRM. An endpoint that must be kept from
   * the lead-gen role does not belong in this domain.
   */
  .use("*", requireLeadsAccess)
  /**
   * Aggregate view for the leads page: one round trip returns the counts, the
   * lookup tables and the first page of rows.
   */
  /**
   * Aggregate view for the leads page.
   *
   * Mirrors the legacy contract in apps/web/app/api/leads/route.ts — same
   * filters, same derived fields — because the migration keeps NuraView's
   * flow and only changes the look. Diverging here would silently change how
   * the team's filters behave.
   */
  .get("/view", async (c) => {
    requireCrm();

    // Whose 👁 stamps to read. Resolved from the signed-in identity, same as
    // every other CRM write in this domain.
    const viewerId = await resolveCrmActorId(c.get("userEmail"));

    const url = new URL(c.req.url);
    const p = url.searchParams;

    const q = p.get("q")?.trim();
    const view = p.get("view") === "irrelevant" ? "irrelevant" : "active";
    const companiesOnly = p.get("companies_only") === "1";
    const highlighted = p.get("highlighted") ?? "all"; // all | yes | no
    const clientInfo = p.get("client_info") ?? "all"; // all | rich | missing
    /*
     * "Email only" and the country filter, applied in SQL.
     *
     * These used to be applied in the BROWSER over whatever page had been
     * fetched, while the column header showed the unfiltered server total. On
     * 27 Jul that meant a header reading 366 above three cards: 18 leads had an
     * email, only 4 of them fell inside the 100 rows the board fetches. The
     * other 14 existed and were never drawn — and the operator concluded the
     * employee had not done the work.
     *
     * Filtering here means the rows and the count come from the same query and
     * cannot disagree.
     */
    const hasEmail = p.get("has_email") === "1";
    const country = p.get("country")?.trim();
    const remindersOnly = p.get("reminders") === "1";
    const statusId = p.get("status_id");
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(p.get("limit") ?? "50") || 50));
    // The Kanban needs a DAY WINDOW rather than "the newest N": without it the
    // newest page is entirely today's arrivals and every older column renders
    // empty. Mirrors the legacy `days` param.
    const days = Math.max(0, Number(p.get("days") ?? "0") || 0);
    /*
     * Explicit arrival window, for one Kanban day column at a time.
     *
     * `days` alone cannot drive the board. The Kanban used to make ONE request
     * for the whole window and bucket the rows by day in the browser, but the
     * page size is capped at 100 and a single day routinely carries several
     * hundred leads — so all 100 rows came back as today's and every other
     * column rendered empty. "Yesterday" showed 0 next to the legacy app's 452.
     *
     * With from/to each column queries its own slice and gets its own total,
     * which is what the legacy board did.
     */
    const arrivedFrom = p.get("from");
    const arrivedTo = p.get("to");
    /*
     * "Taken care" as a server-side filter.
     *
     * A lead counts as handled once it has been contacted — UNLESS a reminder
     * was set after that contact, which means the reviewer deliberately put it
     * back in the queue. The board used to compute this in the browser over
     * whatever rows the single request happened to return, so the Taken care
     * column could only ever show leads that were already on the first page.
     */
    const contacted = p.get("contacted");
    const offset = Math.max(0, Number(p.get("offset") ?? "0") || 0);

    const clientLocationSql = sql<string | null>`
      COALESCE(
        NULLIF(NULLIF(NULLIF(NULLIF(NULLIF(${crmLeads.sourcePayload}->>'client_location', ''), 'Not Found'), 'Not specified'), 'Not available in RSS'), 'Unknown'),
        NULLIF(NULLIF(NULLIF(NULLIF(NULLIF(${crmLeads.sourcePayload}->>'location', ''), 'Not Found'), 'Not specified'), 'Not available in RSS'), 'Unknown')
      )`;

    /*
     * Just the three budget keys, not the whole payload.
     *
     * The Kanban card shows a budget, and there is no `budget` column on
     * crm_Leads — the posting's budget lives inside source_payload as either
     * `budget_raw` or the budget_min/max pair. The card was reading
     * `lead.sourcePayload`, which this endpoint never returned, so every card
     * rendered with no budget at all and nothing failed loudly.
     *
     * Projecting three keys rather than the column keeps the board payload
     * small: source_payload is multi-KB per lead and a day column can hold a
     * hundred of them.
     */
    const budgetSql = sql<Record<string, unknown>>`jsonb_build_object(
      'budget_raw', ${crmLeads.sourcePayload}->>'budget_raw',
      'budget_min', ${crmLeads.sourcePayload}->>'budget_min',
      'budget_max', ${crmLeads.sourcePayload}->>'budget_max'
    )`;

    const hasJobHistorySql = sql<boolean>`
      COALESCE(${crmLeads.sourcePayload}->>'client_job_history_full', '') NOT IN ('', '[]', 'null')`;

    const filters = [isNull(crmLeads.deletedAt)];

    // Active is the working pipeline; Irrelevant is the archive.
    filters.push(
      view === "irrelevant"
        ? sql`${crmLeads.irrelevantAt} is not null`
        : isNull(crmLeads.irrelevantAt),
    );

    if (companiesOnly) filters.push(sql`${crmLeads.company} is not null and ${crmLeads.company} <> ''`);
    if (highlighted === "yes") filters.push(sql`${crmLeads.highlightedAt} is not null`);
    if (highlighted === "no") filters.push(isNull(crmLeads.highlightedAt));
    if (hasEmail) {
      filters.push(sql`nullif(btrim(${crmLeads.email}), '') is not null`);
    }
    if (country) {
      // Matches the same expression the card renders, so the dropdown can
      // never offer a value that then filters to nothing.
      filters.push(sql`${clientLocationSql} = ${country}`);
    }
    if (clientInfo === "rich") filters.push(eq(crmLeads.hasClientInfo, true));
    if (clientInfo === "missing") filters.push(sql`coalesce(${crmLeads.hasClientInfo}, false) = false`);
    if (remindersOnly) filters.push(sql`${crmLeads.reminderAt} is not null`);
    if (statusId) filters.push(eq(crmLeads.leadStatusId, statusId));
    if (days > 0) {
      filters.push(
        sql`coalesce(${crmLeads.extractedAt}, ${crmLeads.createdAt}) > now() - (${days} * interval '1 day')`,
      );
    }
    if (contacted === "yes") {
      filters.push(
        sql`${crmLeads.lastContactedAt} is not null
            and (${crmLeads.reminderAt} is null
                 or ${crmLeads.reminderAt} <= ${crmLeads.lastContactedAt})`,
      );
    }
    if (contacted === "no") {
      filters.push(
        sql`(${crmLeads.lastContactedAt} is null
             or (${crmLeads.reminderAt} is not null
                 and ${crmLeads.reminderAt} > ${crmLeads.lastContactedAt}))`,
      );
    }
    // Half-open [from, to): a lead landing exactly at midnight belongs to the
    // day starting, not the day ending, and must never appear in both columns.
    if (arrivedFrom) {
      filters.push(
        sql`coalesce(${crmLeads.extractedAt}, ${crmLeads.createdAt}) >= ${arrivedFrom}::timestamptz`,
      );
    }
    if (arrivedTo) {
      filters.push(
        sql`coalesce(${crmLeads.extractedAt}, ${crmLeads.createdAt}) < ${arrivedTo}::timestamptz`,
      );
    }

    if (q) {
      const like = `%${q}%`;
      const match = or(
        ilike(crmLeads.company, like),
        ilike(crmLeads.jobTitle, like),
        ilike(crmLeads.email, like),
        ilike(crmLeads.description, like),
      );
      if (match) filters.push(match);
    }

    const where = and(...filters);

    const cacheKey = url.search.replace(/[?&](limit|offset)=[^&]*/g, "");
    const cached = cachedCounts(cacheKey);

    const [rows, counts, statuses] = await Promise.all([
      crmDb
        .select({
          id: crmLeads.id,
          company: crmLeads.company,
          firstName: crmLeads.firstName,
          lastName: crmLeads.lastName,
          jobTitle: crmLeads.jobTitle,
          email: crmLeads.email,
          phone: crmLeads.phone,
          // The card shows a "has phone" badge, and legacy counts the
          // manually-pasted secondary slot as a phone too.
          phoneSecondary: crmLeads.phoneSecondary,
          description: crmLeads.description,
          linkedinUrl: crmLeads.linkedinUrl,
          upworkJobUrl: crmLeads.upworkJobUrl,
          createdAt: crmLeads.createdAt,
          postedAt: crmLeads.postedAt,
          extractedAt: crmLeads.extractedAt,
          highlightedAt: crmLeads.highlightedAt,
          lastContactedAt: crmLeads.lastContactedAt,
          reminderAt: crmLeads.reminderAt,
          reminderNote: crmLeads.reminderNote,
          reminderSentAt: crmLeads.reminderSentAt,
          reminderFirstSentAt: crmLeads.reminderFirstSentAt,
          irrelevantAt: crmLeads.irrelevantAt,
          irrelevantReason: crmLeads.irrelevantReason,
          leadStatusId: crmLeads.leadStatusId,
          statusName: crmLeadStatuses.name,
          hasClientInfo: crmLeads.hasClientInfo,
          clientLocation: clientLocationSql,
          hasJobHistory: hasJobHistorySql,
          sourcePayload: budgetSql,
          // Per-user "have I eyeballed this" stamp, for the 👁 on the row and
          // the kanban card. The join is filtered to the CURRENT user, so one
          // reviewer's open does not light up another's list. NULL = never
          // opened by me.
          viewedAt: crmLeadViews.viewedAt,
        })
        .from(crmLeads)
        .leftJoin(crmLeadStatuses, eq(crmLeads.leadStatusId, crmLeadStatuses.id))
        .leftJoin(
          crmLeadViews,
          and(
            eq(crmLeadViews.leadId, crmLeads.id),
            // No actor resolved (an account with no matching CRM user) means
            // no stamps rather than everyone else's.
            eq(crmLeadViews.userId, viewerId ?? sql`'00000000-0000-0000-0000-000000000000'::uuid`),
          ),
        )
        .where(where)
        .orderBy(desc(sql`coalesce(${crmLeads.extractedAt}, ${crmLeads.createdAt})`))
        .limit(limit)
        .offset(offset),

      cached
        ? Promise.resolve([cached])
        : crmDb
            .select({
              total: sql<number>`count(*)::int`,
              addedRecently: sql<number>`count(*) filter (where coalesce(${crmLeads.extractedAt}, ${crmLeads.createdAt}) > now() - interval '24 hours')::int`,
            })
            .from(crmLeads)
            .where(where),

      crmDb.select().from(crmLeadStatuses),
    ]);

    if (!cached && counts[0]) storeCounts(cacheKey, counts[0]);

    return c.json({
      items: rows,
      total: counts[0]?.total ?? 0,
      addedRecently: counts[0]?.addedRecently ?? 0,
      limit,
      offset,
      statuses,
    });
  })

  /** Today's outreach counts for the sidebar panel. */
  /**
   * Lookups the lead drawer's Status and Assigned-To controls need.
   *
   * One call rather than two: they are rendered side by side and neither list
   * is long. Assignees come from the CRM's own Users table because
   * crm_Leads.assigned_to is a uuid into it — the better-auth account is a
   * different identity space.
   */
  .get("/meta", async (c) => {
    requireCrm();

    const [statuses, assignees] = await Promise.all([
      crmDb
        .select({ id: crmLeadStatuses.id, name: crmLeadStatuses.name })
        .from(crmLeadStatuses)
        .orderBy(crmLeadStatuses.name),
      // `Users` has no table definition here (crm-actor.ts queries it the same
      // way) — one narrow read does not justify carrying the whole shape.
      crmDb.execute<{ id: string; name: string | null; email: string | null }>(
        sql`select id, name, email from "Users" order by coalesce(name, email) limit 200`,
      ),
    ]);

    return c.json({
      statuses,
      assignees:
        (assignees as unknown as { rows?: { id: string; name: string | null; email: string | null }[] })
          .rows ?? [],
    });
  })

  .get("/activity/today", async (c) => {
    requireCrm();
    const actorId = await resolveCrmActorId(c.get("userEmail"));
    return c.json(await getTodayActivity(c.req.query("tz"), actorId));
  })

  .get("/:id", async (c) => {
    requireCrm();

    const [row] = await crmDb
      .select()
      .from(crmLeads)
      .where(and(eq(crmLeads.id, c.req.param("id")), isNull(crmLeads.deletedAt)))
      .limit(1);

    if (!row) throw new HTTPException(404, { message: "LEAD_NOT_FOUND" });

    /*
     * Stamp the view: opening the detail is "I have eyeballed this lead",
     * which is exactly what the 👁 on the list and the kanban card reflects.
     * ON CONFLICT refreshes viewed_at on every subsequent open so the stamp
     * tracks the most recent visit.
     *
     * Fire-and-forget, exactly as crmx1 had it — a slow write must not hold up
     * the detail render, and a failed stamp just means the icon appears on the
     * next open.
     */
    void resolveCrmActorId(c.get("userEmail"))
      .then((viewerId) => {
        if (!viewerId) return;
        return crmDb
          .insert(crmLeadViews)
          .values({ leadId: row.id, userId: viewerId })
          .onConflictDoUpdate({
            target: [crmLeadViews.leadId, crmLeadViews.userId],
            set: { viewedAt: sql`CURRENT_TIMESTAMP` },
          });
      })
      .catch(() => {
        // Best-effort. See above.
      });

    return c.json(row);
  })

  /* ------------------------------------------------------------- mutations
   *
   * These are the FIRST writes this API makes to the CRM schema. The legacy
   * Next app still writes the same columns, which is safe here because each
   * action sets independent fields on a single row — the semantics are the
   * same as two people using the old app at once, not a merge conflict.
   *
   * Actor columns are uuid referencing the CRM's own Users table, so the
   * better-auth identity is resolved by email (see ./crm-actor.ts) and written
   * as NULL when there is no match rather than guessed.
   */

  .post("/:id/highlight", async (c) => {
    requireCrm();
    const { value } = await readBooleanBody(c);
    const actorId = await resolveCrmActorId(c.get("userEmail"));

    return c.json(
      await patchLead(c.req.param("id"), actorId, {
        highlightedAt: value ? new Date() : null,
      }),
    );
  })

  .post("/:id/contacted", async (c) => {
    requireCrm();
    const { value } = await readBooleanBody(c);
    const actorId = await resolveCrmActorId(c.get("userEmail"));

    return c.json(
      await patchLead(c.req.param("id"), actorId, {
        lastContactedAt: value ? new Date() : null,
      }),
    );
  })

  .post("/:id/irrelevant", async (c) => {
    requireCrm();
    const body = await c.req.json<{ value?: boolean; reason?: string }>();
    const value = body.value !== false;
    const actorId = await resolveCrmActorId(c.get("userEmail"));

    return c.json(
      await patchLead(c.req.param("id"), actorId, {
        irrelevantAt: value ? new Date() : null,
        irrelevantReason: value ? (body.reason?.trim() || null) : null,
      }),
    );
  })

  .post("/:id/reminder", async (c) => {
    requireCrm();
    const body = await c.req.json<{
      at?: string | null;
      note?: string;
      // Which WHATSAPP_RECIPIENTS entry the reminder goes to. The legacy
      // drawer let the reviewer pick; without it every reminder fell back to
      // WHATSAPP_TO regardless of who set it.
      account?: string | null;
    }>();
    const actorId = await resolveCrmActorId(c.get("userEmail"));

    const at = body.at ? new Date(body.at) : null;
    if (body.at && Number.isNaN(at?.getTime())) {
      throw new HTTPException(400, { message: "INVALID_REMINDER_DATE" });
    }

    return c.json(
      await patchLead(c.req.param("id"), actorId, {
        reminderAt: at,
        reminderNote: at ? (body.note?.trim() || null) : null,
        reminderAccount: at ? (body.account?.trim() || null) : null,
      }),
    );
  })
  /**
   * Edit the contact details on a lead.
   *
   * Mirrors the legacy PATCH /api/leads/[id] for exactly the fields the drawer
   * makes editable. Everything else on the row — budget, the Upwork URL, the
   * scrape timestamps, the enrichment columns — is scraped or derived and is
   * NOT writable here, which is why this allow-lists rather than spreading the
   * request body.
   *
   * A field that is absent is left alone; a field sent as "" or null is
   * cleared. That distinction matters: the drawer sends the whole form on save,
   * so "not sent" and "deliberately emptied" have to mean different things.
   */
  .patch("/:id", async (c) => {
    requireCrm();

    const body = await c.req.json<Record<string, unknown>>();
    const actorId = await resolveCrmActorId(c.get("userEmail"));

    /*
     * Columns that reject NULL. Transcribed from information_schema, not
     * guessed — the whole bug was assuming every field was nullable.
     */
    const NOT_NULL_FIELDS = new Set<string>(["lastName"]);

    const EDITABLE = [
      "firstName",
      "lastName",
      "company",
      "jobTitle",
      "email",
      "emailSecondary",
      "phone",
      "phoneSecondary",
      "linkedinUrl",
      "videoLink",
      "description",
      // The Email Generator's draft. Saved as it is generated and cleared on
      // send, so a half-reviewed email survives closing the drawer — exactly
      // what crmx1 did.
      "generatedEmailSubject",
      "generatedEmailBody",
    ] as const;

    const update: Record<string, string | Date | null> = {};

    /*
     * Non-text fields the legacy drawer also wrote. Kept out of the EDITABLE
     * loop because they are not free text: two are foreign keys and one is a
     * timestamp, and each needs its own validation.
     */
    if ("leadStatusId" in body) {
      const value = body.leadStatusId;
      update.leadStatusId =
        typeof value === "string" && value.trim() ? value.trim() : null;
    }
    if ("assignedTo" in body) {
      const value = body.assignedTo;
      update.assignedTo =
        typeof value === "string" && value.trim() ? value.trim() : null;
    }
    if ("lastContactedAt" in body) {
      const value = body.lastContactedAt;
      if (value === null || value === "") {
        update.lastContactedAt = null;
      } else if (typeof value === "string") {
        const when = new Date(value);
        if (Number.isNaN(when.getTime())) {
          throw new HTTPException(400, {
            message: "INVALID_FIELD:lastContactedAt",
          });
        }
        update.lastContactedAt = when;
      }
    }

    for (const field of EDITABLE) {
      if (!(field in body)) continue;

      const value = body[field];
      if (value === null) {
        update[field] = null;
        continue;
      }
      if (typeof value !== "string") {
        throw new HTTPException(400, {
          message: `INVALID_FIELD:${field}`,
        });
      }
      /*
       * Empty means "cleared", which is NULL for a nullable column — storing
       * "" would make it read as present-but-blank everywhere downstream.
       *
       * EXCEPT where the column is NOT NULL. crm_Leads.lastName is, and
       * blanking it threw "null value in column lastName violates not-null
       * constraint" — a 500 that the drawer showed as a failed save. Both
       * Mateen and VK hit it, because leaving a last name empty is completely
       * ordinary on a scraped lead.
       *
       * Verified against information_schema: lastName is the only NOT NULL
       * column in this editable set, so it is the only one that keeps "".
       */
      update[field] =
        value.trim() || (NOT_NULL_FIELDS.has(field) ? "" : null);
    }

    if (Object.keys(update).length === 0) {
      throw new HTTPException(400, { message: "NO_EDITABLE_FIELDS" });
    }

    return c.json(await patchLead(c.req.param("id"), actorId, update));
  })
  /**
   * Queue an enrichment run.
   *
   *   manual → the standard cheap waterfall on demand
   *   deep   → adds the Prospeo phone-find step and the long-tail escalation
   *   auto   → reserved for the ingest path, not reachable here
   *
   * NOTE: production currently has NO enrichment provider keys (no SERPER,
   * PROSPEO, FINDYMAIL or MILLIONVERIFIER), so the waterfall finds nothing.
   * That is pre-existing — this endpoint reproduces crmx1's behaviour exactly
   * and starts working the moment the keys are set. Porting it inert was a
   * deliberate call, not an oversight.
   */
  .post("/:id/enrich", async (c) => {
    requireCrm();

    const body = await c.req
      .json<{ mode?: string }>()
      .catch(() => ({}) as { mode?: string });
    const mode = body.mode === "deep" ? "deep" : "manual";
    const id = c.req.param("id");

    // Confirm the lead exists before queueing. Otherwise the worker 404s
    // internally and we strand a PENDING audit row pointing at a missing FK.
    const [lead] = await crmDb
      .select({ id: crmLeads.id })
      .from(crmLeads)
      .where(and(eq(crmLeads.id, id), isNull(crmLeads.deletedAt)))
      .limit(1);

    if (!lead) throw new HTTPException(404, { message: "LEAD_NOT_FOUND" });

    const actorId = await resolveCrmActorId(c.get("userEmail"));
    const now = new Date();

    const [audit] = await crmDb
      .insert(crmLeadEnrichment)
      .values({
        id: randomUUID(),
        leadId: id,
        status: "PENDING",
        mode,
        // The strategy decides what it can actually fill; listing the targets
        // is for the operator audit ("what was this run after?").
        fields:
          mode === "deep"
            ? ["linkedinUrl", "email", "firstName", "lastName", "phone"]
            : ["linkedinUrl", "email", "firstName", "lastName"],
        triggeredBy: actorId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: crmLeadEnrichment.id });

    if (!audit) {
      throw new HTTPException(500, { message: "ENRICHMENT_AUDIT_NOT_CREATED" });
    }

    // Project onto the lead row so the list can badge "running" without
    // joining the audit table per row.
    await crmDb
      .update(crmLeads)
      .set({ enrichmentStatus: "PENDING", updatedAt: now })
      .where(eq(crmLeads.id, id));

    await sendInngestEvents([
      {
        name: "enrich/lead.run",
        data: {
          leadId: id,
          enrichmentId: audit.id,
          mode,
          triggeredBy: actorId,
        },
      },
    ]);

    return c.json({ queued: true, enrichmentId: audit.id, mode });
  })
  /** Latest run for this lead — the drawer polls this to render the pill. */
  .get("/:id/enrich", async (c) => {
    requireCrm();

    const [latest] = await crmDb
      .select({
        id: crmLeadEnrichment.id,
        status: crmLeadEnrichment.status,
        mode: crmLeadEnrichment.mode,
        error: crmLeadEnrichment.error,
        costUsd: crmLeadEnrichment.costUsd,
        createdAt: crmLeadEnrichment.createdAt,
        updatedAt: crmLeadEnrichment.updatedAt,
      })
      .from(crmLeadEnrichment)
      .where(eq(crmLeadEnrichment.leadId, c.req.param("id")))
      .orderBy(desc(crmLeadEnrichment.createdAt))
      .limit(1);

    return c.json({ latest: latest ?? null });
  })
  /**
   * Proxy to the NuraView email-generator services, which already run on the
   * VPS (ports 8000 and 8002). Server-side so the upstream URL and key stay off
   * the client and the call is same-origin — no mixed-content block over https,
   * no CORS.
   *
   *   current → original generator, returns one { subject, body }
   *   updated → agent returning a 5-email thread: a warm-up sent immediately
   *             plus four threaded follow-ups at +10min / +3h / +9h / +24h
   */
  .post("/generate-email", async (c) => {
    requireCrm();

    const body = await c.req
      .json<{ description?: string; mode?: string }>()
      .catch(() => ({}) as { description?: string; mode?: string });

    if (!body.description || typeof body.description !== "string") {
      throw new HTTPException(400, {
        message: "Missing 'description' in request body",
      });
    }

    const mode = body.mode === "updated" ? "updated" : "current";
    const url =
      mode === "updated"
        ? (process.env.EMAIL_GENERATOR_UPDATED_URL ??
          process.env.EMAIL_GENERATOR_URL ??
          "http://185.245.182.175:8002/generate-email")
        : (process.env.EMAIL_GENERATOR_CURRENT_URL ??
          "http://185.245.182.175:8000/generate-email");
    const key = process.env.EMAIL_GENERATOR_API_KEY ?? "";

    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { "x-api-key": key } : {}),
        },
        body: JSON.stringify({ description: body.description }),
        // Don't hang forever if the generator is wedged.
        signal: AbortSignal.timeout(60_000),
      });

      const text = await upstream.text();
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        data = { detail: text };
      }

      if (!upstream.ok) {
        // Surface the upstream's own error (an OpenAI quota 429, a bad key)
        // so the dialog shows something actionable instead of "no response".
        const detail =
          (data as { detail?: string })?.detail ??
          `Email service responded ${upstream.status}`;
        return c.json({ error: "Email service error", detail }, 502);
      }

      /*
       * Reshape the generator's payload — the step this port was missing, and
       * the reason Generate would have printed "No subject received".
       *
       * BOTH services answer with a thread, not one email: {email1, email2,
       * email3, email4[, email5], usage}. crmx1's proxy flattened email1 into
       * subject/body and the rest into an ordered `followups` array, which is
       * the shape the dialog and POST /lead/:id/send-email both expect. This
       * proxy returned the raw upstream JSON, so every field the UI reads was
       * undefined.
       */
      type EmailPart = { subject?: string; body?: string };
      const result = data as {
        subject?: string;
        email_subject?: string;
        body?: string;
        email_body?: string;
        email1?: EmailPart;
        email2?: EmailPart;
        email3?: EmailPart;
        email4?: EmailPart;
        email5?: EmailPart;
        usage?: Record<string, number>;
      };

      if (result.email1) {
        const followups = [
          result.email2,
          result.email3,
          result.email4,
          result.email5,
        ]
          .filter((f): f is EmailPart => Boolean(f))
          .map((f) => ({ subject: f.subject ?? "", body: f.body ?? "" }));

        return c.json({
          subject: result.email1.subject ?? "No subject received",
          body: result.email1.body ?? "No body received",
          followups,
          usage: result.usage ?? null,
        });
      }

      // Legacy fallback: a generator still returning a single { subject, body }.
      return c.json({
        subject: result.subject ?? result.email_subject ?? "No subject received",
        body: result.body ?? result.email_body ?? "No body received",
      });
    } catch (e) {
      return c.json(
        {
          error: "generator_unreachable",
          message: (e as Error).message,
        },
        502,
      );
    }
  })
  /**
   * Send the reviewed email to this lead, with its follow-ups. The route lives
   * in ./send-email.ts — it is 300 lines of ported send pipeline and does not
   * belong inline here. Mounted through the same `.use("*")` gate above, so a
   * leads-kanban account still cannot reach it.
   */
  .route("/", leadSendEmail);

async function readBooleanBody(c: {
  req: { json: <T>() => Promise<T> };
}): Promise<{ value: boolean }> {
  const body = await c.req.json<{ value?: boolean }>();
  return { value: body.value !== false };
}

/**
 * Single update path so every mutation stamps updatedAt/updatedBy identically
 * and returns the row the client should render, avoiding a follow-up GET.
 */
async function patchLead(
  id: string,
  actorId: string | null,
  patch: Record<string, unknown>,
) {
  const [row] = await crmDb
    .update(crmLeads)
    .set({
      ...patch,
      updatedAt: new Date(),
      ...(actorId ? { updatedBy: actorId } : {}),
    })
    .where(and(eq(crmLeads.id, id), isNull(crmLeads.deletedAt)))
    .returning();

  if (!row) throw new HTTPException(404, { message: "LEAD_NOT_FOUND" });

  return row;
}

export default lead;
