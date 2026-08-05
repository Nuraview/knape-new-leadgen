// Compact date formatters used across the leads UI.
//
// Client ask (Apr 2026): "I don't need year — Upwork leads are like milk,
// they expire in 4-5 days." So nothing in this file emits a year. Reminders
// show time, last-contacted is date-only, kanban headers are weekday + day +
// month.
//
// All inputs accept ISO-8601 strings or Date objects. Null/empty/invalid
// returns "—" so call sites don't have to defensively check.
//
// Timezone: HARD-PINNED to Asia/Kolkata. Without an explicit timeZone option
// `toLocaleTimeString` reads the host's local TZ — which is UTC on Vercel
// (server-side renders) but IST in the reviewer's browser. Mixed renders
// produced bugs like "23:04 IST input rendered back as 17:34 in the label"
// because the SSR'd text was UTC. Pinning here is correct because the
// product is operated from India; revisit if/when reviewers in other zones
// join.

const PLACEHOLDER = "—";
const TZ = "Asia/Kolkata";
const LOCALE = "en-US"; // 12-hour format (5:23 PM rather than 17:23)

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// "Wed 29 Apr" — weekday + day + month, no year. Used for kanban column
// subtitles and any display where the user is scanning a sequence of days.
export function formatDayShort(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return PLACEHOLDER;
  return d.toLocaleDateString(LOCALE, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: TZ,
  });
}

// "29 Apr" — day + month only. Used for last-contacted (date-only per
// client request — "I don't need any time, because it's not going to be
// helpful") and any other date-only context.
export function formatDateOnly(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return PLACEHOLDER;
  return d.toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    timeZone: TZ,
  });
}

// "5:23 PM" — time-only. Used inline next to date strings when they need
// to convey "when in the day".
export function formatTimeShort(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return PLACEHOLDER;
  return d.toLocaleTimeString(LOCALE, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  });
}

// "29 Apr · 5:23 PM" — combined date+time without year. Used for reminders
// (per client: "time, day, month. No need of year") and any "scheduled at"
// display where the user needs both day and time.
export function formatDateTimeShort(
  v: string | Date | null | undefined,
): string {
  const d = toDate(v);
  if (!d) return PLACEHOLDER;
  return `${formatDateOnly(d)} · ${formatTimeShort(d)}`;
}

// "2 hours ago" / "3 days ago" / "just now" — friendly relative time for the
// "posted X ago" freshness label (client ask, Jul 2026: show when the job was
// posted like "2-3 hours ago"). Single source for leads list, kanban, drawer.
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

// The scraper stores Upwork's relative "posted X ago" string (e.g. "15 minutes
// ago") captured at SCRAPE time, so it's FROZEN — the bot takes ~15-20 min to
// process a lead, and hours later the CRM still reads "15 minutes ago" (client
// report, Jul 2026). For fine-grained minute/hour buckets we reconstruct the
// absolute post time (scrapedAt − the parsed offset) and re-derive it live from
// now, so the label keeps ticking accurately. Coarser buckets ("yesterday",
// "N days ago", or anything we can't parse) are returned verbatim — the drift
// is immaterial there and the client asked to print those as-is. Returns null
// only when there's genuinely nothing to show.
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
