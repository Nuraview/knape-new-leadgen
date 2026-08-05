/**
 * Today's outreach counts for the sidebar panel.
 *
 * Ported from apps/web/actions/dashboard/get-activity-stats.ts:
 *   calls / emails → crm_Activity_Events, by type
 *   views          → crm_Lead_Views (distinct leads opened)
 *
 * Bucketed by the OPERATOR's local day, not UTC: the team works US hours from
 * India, so a call logged at 2 AM local still belongs to the day that began
 * the morning before. The timezone comes from the browser and is validated
 * before it reaches SQL.
 *
 * Attribution: the legacy query is per-user. Our identities live in a
 * different database, so the session is resolved to a CRM user by email (see
 * ./crm-actor.ts). Until those addresses line up the counts fall back to
 * instance-wide, which is the honest reading for a single-operator team and
 * becomes per-user automatically once the emails match.
 */
import { sql } from "drizzle-orm";
import crmDb from "../database/crm";

export type TodayActivity = {
  calls: number;
  emails: number;
  views: number;
  scope: "user" | "instance";
};

/** Reject anything that is not a plausible IANA zone before it reaches SQL. */
function safeTimezone(tz: string | undefined): string {
  if (!tz || !/^[A-Za-z]+\/[A-Za-z0-9_+\-/]+$/.test(tz)) return "UTC";
  return tz;
}

export async function getTodayActivity(
  timezone: string | undefined,
  crmUserId: string | null,
): Promise<TodayActivity> {
  const tz = safeTimezone(timezone);
  const scope: TodayActivity["scope"] = crmUserId ? "user" : "instance";

  const events = await crmDb.execute<{ type: string; count: number }>(sql`
    select type, count(*)::int as count
    from "crm_Activity_Events"
    where (${crmUserId}::uuid is null or user_id = ${crmUserId}::uuid)
      and (created_at at time zone 'UTC' at time zone ${tz})::date
          = (now() at time zone ${tz})::date
    group by type
  `);

  const views = await crmDb.execute<{ count: number }>(sql`
    select count(distinct lead_id)::int as count
    from "crm_Lead_Views"
    where (${crmUserId}::uuid is null or user_id = ${crmUserId}::uuid)
      and (viewed_at at time zone 'UTC' at time zone ${tz})::date
          = (now() at time zone ${tz})::date
  `);

  const rows = (events as unknown as { rows?: { type: string; count: number }[] })
    .rows ?? [];
  const viewRows = (views as unknown as { rows?: { count: number }[] }).rows ?? [];

  const byType = (name: string) =>
    Number(rows.find((r) => r.type === name)?.count ?? 0);

  return {
    calls: byType("call"),
    emails: byType("email"),
    views: Number(viewRows[0]?.count ?? 0),
    scope,
  };
}
