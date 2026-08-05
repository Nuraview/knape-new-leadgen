"use server";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { getSession } from "@/lib/auth/session";

export type DayStat = { date: string; calls: number; emails: number; views: number };
export type ActivityStats = { today: DayStat; days: DayStat[] };

// VK's team works in IST, so bucket calendar days in this zone — "today" then
// lines up with their wall clock. Stored timestamps are UTC (the GET/PATCH
// routes serialize that way); the rest of the app already compensates for the
// ~5.5h drift. Override via ACTIVITY_TZ if the team relocates.
const TZ = (() => {
  const raw = process.env.ACTIVITY_TZ || "Asia/Kolkata";
  return /^[A-Za-z0-9_+\-/]+$/.test(raw) ? raw : "Asia/Kolkata";
})();

const isValidTz = (raw: string) => /^[A-Za-z0-9_+\-/]+$/.test(raw);

// The activity "day" does not start at midnight — it starts at 6 AM (client
// ask Jul 2026, same rule already live on the leads Kanban). So work done at,
// say, 2 AM still counts toward the day that began the morning before, and
// "today" only rolls to the new date once the local clock passes 6 AM. We
// model this by shifting every instant back DAY_START_HOUR hours before taking
// its calendar day — applied identically to the JS day keys and the SQL
// bucketing so the labels and the counts can never disagree. Kept in the
// operator's LOCAL_TZ (US wall clock), NOT re-pinned to IST.
const DAY_START_HOUR = 6;

const rowsOf = (res: any): any[] => (Array.isArray(res) ? res : (res?.rows ?? []));

/**
 * Per-user daily outreach counts for the current session user:
 *   - calls  / emails → crm_Activity_Events (recorded when a lead's primary
 *                       phone / email is set or changed in the drawer)
 *   - views           → crm_Lead_Views (the 👁 eyeball log; distinct leads
 *                       whose most-recent open falls on that day)
 * Returns the last `days` calendar days, newest first (today === days[0]).
 */
export async function getActivityStats(
  days = 5,
  viewerTz?: string,
): Promise<ActivityStats> {
  const empty = (date: string): DayStat => ({ date, calls: 0, emails: 0, views: 0 });

  const session = await getSession();
  if (!session) return { today: empty(""), days: [] };
  const userId = session.user.id;
  const span = Math.max(1, Math.min(days, 31));

  // All three metrics (calls, emails, views) reset on the operator's *local*
  // Bucket the activity "day" in IST, pinned — NOT the viewer's browser zone
  // (client ask Jul 2026: "regardless of my computer's timezone it must be IST
  // 6 AM to 6 AM"). This supersedes the earlier Jun 2026 "follow the operator's
  // US wall clock" behaviour: the day boundary must now be identical on every
  // machine, exactly like the leads Kanban. `viewerTz` is intentionally ignored
  // for bucketing; ACTIVITY_TZ/LOCAL_TZ still let ops re-pin the zone if the
  // team ever relocates. Validated to keep it out of the SQL as a raw ident.
  const LOCAL_TZ = (() => {
    const raw = process.env.ACTIVITY_TZ || process.env.LOCAL_TZ || TZ;
    return isValidTz(raw) ? raw : TZ;
  })();
  void viewerTz; // kept in the signature for callers; not used for bucketing

  // The calendar days we want, in LOCAL_TZ, newest first. dayKeys[0] === today.
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: LOCAL_TZ }); // YYYY-MM-DD
  const now = Date.now();
  // Shift the instant back 6h before taking its LOCAL_TZ day so the boundary is
  // 6 AM, not midnight (see DAY_START_HOUR). Applied to every key incl. today.
  const shiftMs = DAY_START_HOUR * 3_600_000;
  const dayKeys: string[] = [];
  for (let i = 0; i < span; i++)
    dayKeys.push(fmt.format(new Date(now - i * 86_400_000 - shiftMs)));

  // Interpret the stored naive timestamps as UTC, then bucket them in LOCAL_TZ
  // (IST) so the grouping is identical regardless of the DB session timezone OR
  // the viewer's machine. Over-fetch one extra day to be safe against the TZ +
  // 6h-shift boundary, then trim in JS below.
  const [evRes, viewRes] = await Promise.all([
    db.execute(sql`
      select to_char(((created_at at time zone 'UTC') - ((${DAY_START_HOUR})::text || ' hours')::interval) at time zone ${LOCAL_TZ}, 'YYYY-MM-DD') as day,
             type, count(*)::int as count
      from "crm_Activity_Events"
      where user_id = ${userId}
        and (created_at at time zone 'UTC') >= now() - ((${span + 1})::text || ' days')::interval
      group by 1, type
    `),
    db.execute(sql`
      select to_char(((viewed_at at time zone 'UTC') - ((${DAY_START_HOUR})::text || ' hours')::interval) at time zone ${LOCAL_TZ}, 'YYYY-MM-DD') as day,
             count(*)::int as count
      from "crm_Lead_Views"
      where user_id = ${userId}
        and (viewed_at at time zone 'UTC') >= now() - ((${span + 1})::text || ' days')::interval
      group by 1
    `),
  ]);

  const calls: Record<string, number> = {};
  const emails: Record<string, number> = {};
  for (const r of rowsOf(evRes)) {
    if (r.type === "call") calls[r.day] = Number(r.count);
    else if (r.type === "email") emails[r.day] = Number(r.count);
  }
  const views: Record<string, number> = {};
  for (const r of rowsOf(viewRes)) views[r.day] = Number(r.count);

  const out: DayStat[] = dayKeys.map((d) => ({
    date: d,
    calls: calls[d] ?? 0,
    emails: emails[d] ?? 0,
    views: views[d] ?? 0,
  }));

  return { today: out[0], days: out };
}
