import { NextRequest, NextResponse } from "next/server";

import { and, eq, ilike, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { crmLeads, crmLeadStatuses, crmLeadViews } from "@/drizzle/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function notEmpty<T>(v: T | null | undefined): v is T {
  return v != null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const companiesOnly = searchParams.get("companies_only") === "1";
  const highlightedFilter = searchParams.get("highlighted"); // "1" | "0" | null
  // Irrelevant view switch:
  //   missing / "0"  → active leads only (default — what reviewers work from)
  //   "1"            → archive of irrelevant leads only (the training-data view)
  //   "all"          → both, useful for ops / debugging
  const irrelevantFilter = searchParams.get("irrelevant");
  const q = searchParams.get("q")?.trim() || null;
  const statusIdsRaw = searchParams.get("status_ids");
  const statusIds = statusIdsRaw
    ? statusIdsRaw.split(",").filter(Boolean)
    : null;
  // Day-bucketed views (Kanban) need EVERY lead within a date window, not
  // the newest-N. With a plain limit (capped at MAX_LIMIT=200) a
  // high-volume day fills the whole cap, so older day-columns starve —
  // "Yesterday" showed 0 while "Today" had 200+, and toggling
  // "Companies only" inverted it (smaller set → 200 rows reached back a
  // day). `days=N` switches to a bounded date window with a higher
  // ceiling; the list view (no `days`) is unchanged.
  //
  // Ceiling raised 1500 → 8000 (Jun 2026): on high-volume scrapes a 4-day
  // window holds ~3k active leads. At 1500 the API returned only the
  // newest-by-date 1500, which fully filled Today + Yesterday and left the
  // older two Kanban columns truncated/empty — looked like "missing leads"
  // vs another tab loaded at a quieter time. 8000 comfortably covers the
  // whole window so every day-column shows its true count.
  const windowDays = Math.min(
    Math.max(0, parseInt(searchParams.get("days") ?? "") || 0),
    31,
  );
  const effectiveMax = windowDays > 0 ? 8000 : MAX_LIMIT;
  const limit = Math.min(
    Math.max(1, parseInt(searchParams.get("limit") ?? "") || DEFAULT_LIMIT),
    effectiveMax,
  );
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "") || 0);

  const conds = [isNull(crmLeads.deletedAt)];
  if (irrelevantFilter === "1") {
    conds.push(isNotNull(crmLeads.irrelevantAt));
  } else if (irrelevantFilter !== "all") {
    conds.push(isNull(crmLeads.irrelevantAt));
  }
  if (companiesOnly) {
    conds.push(isNotNull(crmLeads.company));
    conds.push(sql`${crmLeads.company} <> ''`);
  }
  if (highlightedFilter === "1") conds.push(isNotNull(crmLeads.highlightedAt));
  if (highlightedFilter === "0") conds.push(isNull(crmLeads.highlightedAt));
  const hasClientInfoFilter = searchParams.get("has_client_info");
  if (hasClientInfoFilter === "1") {
    conds.push(sql`${crmLeads.hasClientInfo} = true`);
  } else if (hasClientInfoFilter === "0") {
    conds.push(sql`${crmLeads.hasClientInfo} IS NOT TRUE`);
  }
  // Reminders filter — show leads that the reviewer should pay attention
  // to right now: either an active scheduled reminder OR a recently-fired
  // one (sticky for 24h since first send so multiple follow-ups are
  // visible per the Apr 2026 client ask).
  if (searchParams.get("reminders") === "1") {
    conds.push(
      sql`(
        ${crmLeads.reminderAt} IS NOT NULL
        OR (${crmLeads.reminderFirstSentAt} IS NOT NULL
            AND ${crmLeads.reminderFirstSentAt} > now() - interval '24 hours')
      )`,
    );
  }
  if (statusIds && statusIds.length) {
    conds.push(inArray(crmLeads.leadStatusId, statusIds));
  }
  if (q) {
    const pattern = `%${q}%`;
    const orClause = or(
      ilike(crmLeads.company, pattern),
      ilike(crmLeads.jobTitle, pattern),
      ilike(crmLeads.firstName, pattern),
      ilike(crmLeads.email, pattern),
    );
    if (orClause) conds.push(orClause);
  }

  if (windowDays > 0) {
    // Match the Kanban's day-bucketing key (extracted_at, fallback
    // created_at), and ALWAYS keep leads with an active/recent reminder
    // so the Reminders pseudo-column isn't truncated by the date window.
    conds.push(
      sql`(
        COALESCE(${crmLeads.extractedAt}, ${crmLeads.createdAt})
          >= now() - ${windowDays} * interval '1 day'
        OR ${crmLeads.reminderAt} IS NOT NULL
        OR (${crmLeads.reminderFirstSentAt} IS NOT NULL
            AND ${crmLeads.reminderFirstSentAt} > now() - interval '24 hours')
      )`,
    );
  }

  const whereClause = and(...conds.filter(notEmpty));

  // Order: company-present first, then extracted_at DESC, then createdAt DESC.
  // Serialize naked TIMESTAMP columns as ISO-8601 strings ending in 'Z' so
  // the browser parses them as UTC. Otherwise JS reads them as local time and
  // the display ends up ~5.5h off (IST).
  const isoUtc = (col: any) =>
    sql`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

  // Lift the scraped client location out of source_payload at query time —
  // pusher.py emits both `client_location` (preferred, from the lead detail
  // page) and `location` (fallback, from the search-result tile). The
  // scraper's "no location found" sentinels collapse to NULL so the UI
  // doesn't render `Not Found` as a real place. Returned as `clientLocation`
  // and shown with a 📍 pin in the list / Kanban / drawer.
  const clientLocationSql = sql`
    COALESCE(
      NULLIF(NULLIF(NULLIF(NULLIF(NULLIF(${crmLeads.sourcePayload}->>'client_location', ''), 'Not Found'), 'Not specified'), 'Not available in RSS'), 'Unknown'),
      NULLIF(NULLIF(NULLIF(NULLIF(NULLIF(${crmLeads.sourcePayload}->>'location', ''), 'Not Found'), 'Not specified'), 'Not available in RSS'), 'Unknown')
    )
  `;

  // True when the lead has a non-empty client_job_history_full in
  // sourcePayload (Nuxt-extracted past hires). The legacy `has_client_info`
  // boolean is set off the "About the client" DOM sidebar only — it goes
  // false whenever Upwork shifts that markup, even when our Nuxt-payload
  // path still pulls history (with names + feedback) through cleanly.
  // The badge logic below uses BOTH so we don't flag a useful lead as
  // "no client info" when there's clearly past-hires data on it.
  const hasJobHistorySql = sql<boolean>`
    COALESCE(${crmLeads.sourcePayload}->>'client_job_history_full', '') NOT IN ('', '[]', 'null')
  `;

  // Lift the job's budget out of source_payload — `budget_raw` is the
  // already-formatted string the scraper pulled straight off the posting
  // ("$500.00" fixed, or an hourly range like "$30.00-$50.00"), so both
  // engagement types display without us guessing which. Upwork's "no budget"
  // rows store "N/A" (and some are empty), both of which collapse to NULL so
  // the card can hide the budget instead of printing "N/A". Shown on the
  // Kanban card + drawer (client ask Jul 2026).
  const budgetSql = sql<string | null>`
    NULLIF(NULLIF(${crmLeads.sourcePayload}->>'budget_raw', ''), 'N/A')
  `;

  // Raw "posted X ago" string exactly as the scraper read it off the Upwork
  // posting (e.g. "1 hour ago", "yesterday"). The parsed postedAt timestamp is
  // only filled for a fraction of rows, whereas this relative string is present
  // far more often — so the card shows it verbatim below the scraped time
  // (client ask Jul 2026). Junk sentinels ("Unknown", "·", empty) collapse to
  // NULL so the card can hide the line.
  const postedRawSql = sql<string | null>`
    NULLIF(NULLIF(NULLIF(${crmLeads.sourcePayload}->>'posted_at', ''), 'Unknown'), '·')
  `;

  const rows = await db
    .select({
      id: crmLeads.id,
      company: crmLeads.company,
      firstName: crmLeads.firstName,
      lastName: crmLeads.lastName,
      jobTitle: crmLeads.jobTitle,
      email: crmLeads.email,
      phone: crmLeads.phone,
      phoneSecondary: crmLeads.phoneSecondary,
      linkedinUrl: crmLeads.linkedinUrl,
      upworkJobUrl: crmLeads.upworkJobUrl,
      extractedAt: isoUtc(crmLeads.extractedAt),
      createdAt: isoUtc(crmLeads.createdAt),
      // When the CLIENT posted the job on Upwork — more meaningful for
      // reviewer freshness than extractedAt (= when we saw it).
      postedAt: isoUtc(crmLeads.postedAt),
      postedRaw: postedRawSql,
      highlightedAt: isoUtc(crmLeads.highlightedAt),
      lastContactedAt: isoUtc(crmLeads.lastContactedAt),
      reminderAt: isoUtc(crmLeads.reminderAt),
      reminderSentAt: isoUtc(crmLeads.reminderSentAt),
      reminderFirstSentAt: isoUtc(crmLeads.reminderFirstSentAt),
      reminderFollowupPending: crmLeads.reminderFollowupPending,
      reminderNote: crmLeads.reminderNote,
      reminderAccount: crmLeads.reminderAccount,
      leadStatusId: crmLeads.leadStatusId,
      statusName: crmLeadStatuses.name,
      hasClientInfo: crmLeads.hasClientInfo,
      irrelevantAt: isoUtc(crmLeads.irrelevantAt),
      irrelevantReason: crmLeads.irrelevantReason,
      clientLocation: clientLocationSql,
      hasJobHistory: hasJobHistorySql,
      budget: budgetSql,
      videoLink: crmLeads.videoLink,
      // Per-user "have I eyeballed this" stamp. The join is filtered to
      // the current user so reviewer A's open doesn't light up reviewer
      // B's row. NULL = never opened by me.
      viewedAt: isoUtc(crmLeadViews.viewedAt),
    })
    .from(crmLeads)
    .leftJoin(crmLeadStatuses, eq(crmLeads.leadStatusId, crmLeadStatuses.id))
    .leftJoin(
      crmLeadViews,
      and(
        eq(crmLeadViews.leadId, crmLeads.id),
        eq(crmLeadViews.userId, session.user.id),
      ),
    )
    .where(whereClause)
    // List view (no `days`): sort by when WE ingested the lead (extractedAt,
    // fallback createdAt) so freshly-scraped leads land at the TOP and are
    // visibly arriving. After a scraper outage the catch-up backlog carries
    // OLD Upwork posting dates; a posting-time sort buried those below the
    // fold and looked like "no new leads". The Kanban/day-window view (`days`)
    // keeps the posting-time sort — its columns are already day-bucketed.
    .orderBy(
      windowDays > 0
        ? sql`COALESCE(${crmLeads.postedAt}, ${crmLeads.extractedAt}, ${crmLeads.createdAt}) DESC NULLS LAST`
        : sql`COALESCE(${crmLeads.extractedAt}, ${crmLeads.createdAt}) DESC NULLS LAST`,
    )
    .limit(limit)
    .offset(offset);

  // Real totals for the list header (items.length is capped at `limit`, so it
  // can't show growth). Only on the first page — the header doesn't change as
  // you page. `addedRecently` = ingested in the last 24h, so the count visibly
  // moves while the scraper runs.
  let total: number | null = null;
  let addedRecently: number | null = null;
  if (offset === 0) {
    const [counts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        addedRecently: sql<number>`count(*) filter (where COALESCE(${crmLeads.extractedAt}, ${crmLeads.createdAt}) > now() - interval '24 hours')::int`,
      })
      .from(crmLeads)
      .where(whereClause);
    total = counts?.total ?? null;
    addedRecently = counts?.addedRecently ?? null;
  }

  return NextResponse.json({
    items: rows,
    nextOffset: rows.length === limit ? offset + limit : null,
    total,
    addedRecently,
  });
}
