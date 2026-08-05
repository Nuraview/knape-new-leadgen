import { NextResponse } from "next/server";

import { getActivityStats } from "@/actions/dashboard/get-activity-stats";

// Live scoreboard — never cache. Mirrors the activity page's force-dynamic.
export const dynamic = "force-dynamic";

// Powers the sidebar "Today" widget (days=1) and the full Activity dashboard
// (days=5). Both are client components that poll this endpoint so they can pass
// the browser's local timezone. Session/auth + day bucketing are handled inside
// getActivityStats.
//
// tz (the browser's local timezone) makes "today" reset on the operator's own
// wall clock — he works US hours from India, so all three metrics follow his
// machine's day boundary rather than IST. days defaults to 1; getActivityStats
// clamps it to [1, 31].
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tz = url.searchParams.get("tz") || undefined;
  const daysRaw = Number(url.searchParams.get("days"));
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 1;
  const stats = await getActivityStats(days, tz);
  return NextResponse.json(stats);
}
