/**
 * Date helpers copied verbatim from apps/web/lib/dates/short.ts.
 *
 * livePostedAgo is the one the Kanban card needs: Upwork reports "13 minutes
 * ago" AT SCRAPE TIME, so replaying that string later would claim a two-day-old
 * posting is 13 minutes old. It re-anchors the relative phrase to when we
 * actually scraped it. Anything it cannot parse (days, "yesterday") is passed
 * through unchanged rather than guessed at.
 */

const PLACEHOLDER = "—";

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export function formatRelativeAgo(
  v: string | Date | null | undefined,
): string {
  const d = toDate(v);
  if (!d) return PLACEHOLDER;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "1 hour ago" : `${h} hours ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return days === 1 ? "1 day ago" : `${days} days ago`;
  const w = Math.floor(days / 7);
  return w === 1 ? "1 week ago" : `${w} weeks ago`;
}

export function livePostedAgo(
  postedRaw: string | null | undefined,
  scrapedAt: string | Date | null | undefined,
): string | null {
  const raw = postedRaw?.trim();
  if (!raw) return null;
  // Matches "13 minutes ago", "1 hour ago", "a minute ago", "an hour ago".
  const match = raw.match(/^(a|an|\d+)\s+(minute|min|hour|hr)s?\s+ago$/i);
  const scraped = toDate(scrapedAt);
  if (!match || !scraped) return raw; // days / yesterday / unparseable → as-is
  const qty = /^an?$/i.test(match[1]) ? 1 : parseInt(match[1], 10);
  if (!Number.isFinite(qty)) return raw;
  const unitMs = /^h/i.test(match[2]) ? 3_600_000 : 60_000;
  const posted = scraped.getTime() - qty * unitMs;
  return formatRelativeAgo(new Date(posted));
}
