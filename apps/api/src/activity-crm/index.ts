/**
 * CRM activity scoreboard — calls made, emails sent, projects viewed, per day.
 *
 * Ported from apps/web/actions/dashboard/get-activity-stats.ts.
 *
 * Named `activity-crm` on purpose: `apps/api/src/activity/` already exists and
 * is Kaneo's task-activity domain. Two unrelated things called "activity" in
 * one API is how you get a route mounted over the top of another.
 *
 * Two rules carry client history and must not drift:
 *
 * 1. **Days are bucketed in IST, pinned** — not in the viewer's browser zone.
 *    The client asked for this explicitly (Jul 2026): "regardless of my
 *    computer's timezone it must be IST 6 AM to 6 AM". An earlier version
 *    followed the operator's US wall clock; that is superseded. `tz` is still
 *    accepted on the query string so the legacy callers keep working, and is
 *    deliberately ignored for bucketing.
 * 2. **The day starts at 6 AM, not midnight** — same rule as the leads kanban.
 *    Work logged at 2 AM counts toward the day that began the morning before.
 *    The shift is applied identically to the JS day keys and the SQL bucketing,
 *    so labels and counts cannot disagree.
 *
 * Attribution mirrors ../lead/activity-today.ts: identities live in the PM
 * database, so the session is resolved to a CRM user by email. Unmatched falls
 * back to instance-wide, which is the honest reading for a one-operator team.
 */
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import crmDb from "../database/crm";
import { resolveCrmActorId } from "../lead/crm-actor";
import { requireCrmAccess } from "../utils/require-crm-access";

export type DayStat = {
  date: string;
  calls: number;
  emails: number;
  views: number;
};

export type ActivityStats = { today: DayStat; days: DayStat[] };

/** The activity day begins at 06:00 local, not midnight. */
const DAY_START_HOUR = 6;

const isValidTz = (raw: string) => /^[A-Za-z0-9_+\-/]+$/.test(raw);

/**
 * The pinned bucketing zone. ACTIVITY_TZ / LOCAL_TZ let ops re-pin it if the
 * team relocates; validated because it is interpolated into SQL.
 */
function bucketTimezone(): string {
  const raw = process.env.ACTIVITY_TZ || process.env.LOCAL_TZ || "Asia/Kolkata";
  return isValidTz(raw) ? raw : "Asia/Kolkata";
}

export async function getActivityStats(
  days: number,
  crmUserId: string | null,
): Promise<ActivityStats> {
  const empty = (date: string): DayStat => ({
    date,
    calls: 0,
    emails: 0,
    views: 0,
  });

  const span = Math.max(1, Math.min(days, 31));
  const tz = bucketTimezone();

  // The calendar days we want, newest first — dayKeys[0] is today. Shift each
  // instant back 6h before taking its day so the boundary is 6 AM.
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz }); // YYYY-MM-DD
  const now = Date.now();
  const shiftMs = DAY_START_HOUR * 3_600_000;
  const dayKeys: string[] = [];
  for (let i = 0; i < span; i++) {
    dayKeys.push(fmt.format(new Date(now - i * 86_400_000 - shiftMs)));
  }

  // Stored timestamps are naive-UTC. Interpret as UTC, subtract the 6h shift,
  // then bucket in `tz`, so grouping is identical regardless of the database
  // session timezone or the caller's machine. Over-fetch a day to survive the
  // boundary, then trim to dayKeys below.
  const [events, views] = await Promise.all([
    crmDb.execute<{ day: string; type: string; count: number }>(sql`
      select to_char(((created_at at time zone 'UTC') - ((${DAY_START_HOUR})::text || ' hours')::interval) at time zone ${tz}, 'YYYY-MM-DD') as day,
             type, count(*)::int as count
      from "crm_Activity_Events"
      where (${crmUserId}::uuid is null or user_id = ${crmUserId}::uuid)
        and (created_at at time zone 'UTC') >= now() - ((${span + 1})::text || ' days')::interval
      group by 1, type
    `),
    crmDb.execute<{ day: string; count: number }>(sql`
      select to_char(((viewed_at at time zone 'UTC') - ((${DAY_START_HOUR})::text || ' hours')::interval) at time zone ${tz}, 'YYYY-MM-DD') as day,
             count(*)::int as count
      from "crm_Lead_Views"
      where (${crmUserId}::uuid is null or user_id = ${crmUserId}::uuid)
        and (viewed_at at time zone 'UTC') >= now() - ((${span + 1})::text || ' days')::interval
      group by 1
    `),
  ]);

  const rowsOf = <T>(result: unknown): T[] =>
    Array.isArray(result) ? (result as T[]) : (((result as { rows?: T[] })?.rows ?? []) as T[]);

  const calls: Record<string, number> = {};
  const emails: Record<string, number> = {};
  for (const r of rowsOf<{ day: string; type: string; count: number }>(events)) {
    if (r.type === "call") calls[r.day] = Number(r.count);
    else if (r.type === "email") emails[r.day] = Number(r.count);
  }

  const viewCounts: Record<string, number> = {};
  for (const r of rowsOf<{ day: string; count: number }>(views)) {
    viewCounts[r.day] = Number(r.count);
  }

  const out: DayStat[] = dayKeys.map((d) => ({
    date: d,
    calls: calls[d] ?? 0,
    emails: emails[d] ?? 0,
    views: viewCounts[d] ?? 0,
  }));

  return { today: out[0] ?? empty(dayKeys[0] ?? ""), days: out };
}

const activityCrm = new Hono<{
  Variables: { userId: string; userEmail: string };
}>()
  .use("*", requireCrmAccess)
  .get("/stats", async (c) => {
    const raw = Number(c.req.query("days"));
    const days = Number.isFinite(raw) && raw > 0 ? raw : 1;
    const actorId = await resolveCrmActorId(c.get("userEmail"));
    return c.json(await getActivityStats(days, actorId));
  });

export default activityCrm;
