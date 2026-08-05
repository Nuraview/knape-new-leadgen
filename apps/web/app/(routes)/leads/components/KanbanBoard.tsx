"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import { ArrowUpRight, Ban, Linkedin, Search } from "lucide-react";

import { formatDateOnly, formatDayShort, livePostedAgo } from "@/lib/dates/short";
import { resolveCountry } from "@/lib/leads/country";
import { isAllowedStatus, statusColor } from "@/lib/leads/status-colors";
import { CountryFlag } from "./CountryFlag";
import { LeadDrawer } from "./LeadDrawer";

// Day-grouped Kanban — columns are CALENDAR DAYS plus a synthetic
// "Reminders" pseudo-column. Layout per client ask (Apr 2026):
//
//   Today | Yesterday | Reminders | Day-2 | Day-3
//
// Reminders sits at index 2 so the reviewer can pivot from "what came in
// today" to "who I need to call now" without scrolling. Cards in the
// Reminders column may also appear in their own day-bucket — that's
// intentional ("plan my day" vs "see freshness" are two reads of the same
// data).
//
// Why 4 day buckets total? Client framing: "Upwork leads are like milk —
// they go bad in 4 days." Anything older than Day-3 is dropped from the
// view (no "Earlier" overflow column).
//
// Drag-drop is intentionally absent — extracted_at is the Upwork post's
// first-seen time, immutable, so dragging across days would lie about
// when a lead arrived. Click a card to open the detail drawer.

type LeadRow = {
  id: string;
  company: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  phoneSecondary: string | null;
  linkedinUrl: string | null;
  // The lead's Upwork job posting URL. Opened via the ↗ shortcut in the card's
  // top-right corner.
  upworkJobUrl: string | null;
  extractedAt: string | null;
  createdAt: string | null;
  // When the CLIENT posted the job on Upwork — the freshness signal the
  // reviewer cares about (vs extractedAt = when we scraped it). Shown on the
  // Kanban-view card as "posted Xh ago".
  postedAt: string | null;
  // Raw "posted X ago" string straight from the scrape payload (e.g.
  // "1 hour ago"). Populated far more often than the parsed postedAt column, so
  // it's what the card prints below the scraped time. NULL when the scraper had
  // only a junk value.
  postedRaw: string | null;
  highlightedAt: string | null;
  reminderAt: string | null;
  reminderSentAt: string | null;
  reminderFirstSentAt: string | null;
  reminderFollowupPending: boolean | null;
  reminderAccount: string | null;
  lastContactedAt: string | null;
  leadStatusId: string | null;
  statusName: string | null;
  hasClientInfo: boolean | null;
  hasJobHistory: boolean | null;
  clientLocation: string | null;
  viewedAt: string | null;
  // Job budget lifted from source_payload.budget_raw ("$500.00" or an hourly
  // range). NULL when Upwork gave no budget. Shown bottom-right on the card.
  budget: string | null;
};

type Status = { id: string; name: string };

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => r.json());

// Number of calendar-day columns to render (today + N-1 prior days).
// Anything older falls off the board entirely — see header comment.
const DAY_WINDOW = 4;
// Reminders pseudo-column position — inserted between Yesterday and Day-2
// so the reviewer's eye sweeps Today → Yesterday → "what to do now" → older.
const REMINDERS_COLUMN_INDEX = 2;
// Don't surface reminders due more than this far in the future. Reminders
// further out are still on the lead's row (drawer + 🔔 icon) — but they
// don't clutter the today-focused planning view.
const REMINDER_HORIZON_DAYS = 7;

// Day bucketing is pinned to the product timezone (IST), NOT the browser's
// local zone. This is the fix for the client's report that "today/yesterday
// lead counts change when I switch my OS clock between USA and India": a lead
// must land in the same calendar-day column regardless of where (and in which
// timezone) the reviewer's machine happens to be. We mirror the IST pin in
// lib/dates/short.ts so a column's grouping key and its rendered subtitle
// ("29 Apr") can never disagree. extracted_at is an absolute instant, so the
// only thing that ever varied was the host's interpretation of "which day" —
// that's now fixed to IST. Revisit alongside short.ts if reviewers in other
// zones join.
const BUCKET_TZ = "Asia/Kolkata";

// en-CA renders as YYYY-MM-DD, so this yields the IST calendar-day key for
// any instant.
const istDayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUCKET_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// The board's "day" does NOT start at midnight IST — it starts at 6 AM IST
// (client ask Jul 2026). Previously a lead rolled from "Today" into "Yesterday"
// the instant the IST clock passed 00:00; the client wants that roll to happen
// at 06:00 the next morning instead, so a day spans [06:00 today … 06:00
// tomorrow). We model this by shifting every instant back by DAY_START_HOUR_IST
// hours before taking its IST calendar day: subtracting 6h maps that whole
// 6-AM-to-6-AM window onto the single calendar date of its starting morning.
// So a lead extracted at 03:00 IST lands in the *previous* day's column, and
// "Today" only flips to the new date once the clock crosses 06:00 IST.
// istDayAnchor round-trips this cleanly (noon-UTC anchor − 6h = 06:00 UTC =
// 11:30 IST, still the same calendar day), so column headers, subtitles, and
// per-lead buckets all stay in agreement.
const DAY_START_HOUR_IST = 6;

function dayKey(d: Date): string {
  return istDayFmt.format(
    new Date(d.getTime() - DAY_START_HOUR_IST * 60 * 60 * 1000),
  );
}

// Separate calendar-day key pinned to US Eastern, used ONLY by the "Taken
// care" column date filter (client ask Jun 2026: filter the handled pile on
// US time, not the IST product time the rest of the board buckets by). ET, so
// "Today" flips at midnight New York. en-CA → YYYY-MM-DD for lexical compares.
const usDayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dayKeyUS(d: Date): string {
  return usDayFmt.format(d);
}

// Anchor instant for an IST calendar day: noon UTC (= 17:30 IST) of that day.
// Noon keeps us safely inside the day when short.ts re-renders it in IST, and
// lets us step to prior days by subtracting whole 24h spans (IST has no DST).
function istDayAnchor(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

// Duplicate-matching key for a lead: normalized job title + company. Mirrors
// the server rule in /api/leads/dedupe. Title-less leads return "" and are not
// matched against each other.
function normField(v: string | null): string {
  return (v ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}
function dupKey(l: LeadRow): string | null {
  const title = normField(l.jobTitle);
  if (!title) return null;
  return `${title}||${normField(l.company)}`;
}

// Does the lead carry a phone number we could call? Either the primary
// `phone` or the manually-pasted `phoneSecondary` slot counts (client ask
// Jun 2026: the "Taken care" column's phone filter + per-card phone icon).
function hasPhone(l: LeadRow): boolean {
  return Boolean(l.phone?.trim() || l.phoneSecondary?.trim());
}

// Does the lead carry an email address? Drives the per-card mail icon shown in
// the Today / Yesterday / Reminders columns (client ask Jun 2026) — same idea
// as the phone icon, so the reviewer can see at a glance who is reachable by
// email before opening the lead.
function hasEmail(l: LeadRow): boolean {
  return Boolean(l.email?.trim());
}

function cardTitle(l: LeadRow): string {
  return (
    l.company ||
    [l.firstName, l.lastName].filter(Boolean).join(" ").trim() ||
    l.jobTitle ||
    "Untitled"
  );
}

function timeOnly(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // Pinned to IST (same as bucketing + short.ts) so a card shows the same
  // time regardless of the reviewer's host clock — see BUCKET_TZ note above.
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: BUCKET_TZ,
  });
}

function Card({
  lead,
  onOpen,
  onMarkIrrelevant,
  showPhoneBadge,
  showEmailBadge,
  tall,
}: {
  lead: LeadRow;
  onOpen: () => void;
  // Mark this lead irrelevant straight from the card (client ask Jul 2026) —
  // same effect as the drawer's "Mark as irrelevant", so junk can be dismissed
  // without opening it. Sits bottom-right, to the right of the budget. When
  // undefined the button isn't rendered.
  onMarkIrrelevant?: (id: string) => void;
  // Render a small phone icon when the lead has a number. Only switched on
  // for the "Taken care" column (client ask Jun 2026) — other columns keep
  // their existing card chrome.
  showPhoneBadge?: boolean;
  // Render a small mail icon when the lead has an email. Switched on for the
  // Today / Yesterday / Reminders columns (client ask Jun 2026).
  showEmailBadge?: boolean;
  // Roughly double the card's height (client ask Jul 2026). On in the Kanban
  // view, where the wider 3-column board has the room; the compact "View all"
  // board leaves it off. Content stays top-aligned; the extra room drops below.
  tall?: boolean;
}) {
  const colors = statusColor(lead.statusName);
  return (
    <div
      className={`relative rounded border-l-4 border-y border-r bg-background p-3 mb-2 shadow-sm hover:border-foreground/30 hover:shadow transition-colors cursor-pointer ${
        tall ? "min-h-[9rem] text-base" : "text-sm"
      } ${colors.stripe}`}
      onClick={onOpen}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 overflow-hidden">
          <div className="flex items-center gap-2">
            <div
              className={`truncate ${
                tall ? "text-lg font-semibold" : "font-medium"
              }`}
            >
              {lead.company ? (
                cardTitle(lead)
              ) : (
                <span className="italic text-muted-foreground">
                  {cardTitle(lead)}
                </span>
              )}
            </div>
            {lead.viewedAt ? (
              <span
                className="shrink-0 text-xs text-muted-foreground"
                title={`You opened this on ${new Date(lead.viewedAt).toLocaleString()}`}
                aria-label="You have opened this lead"
              >
                👁
              </span>
            ) : null}
            {showPhoneBadge && hasPhone(lead) ? (
              <span
                className="shrink-0 text-emerald-600 dark:text-emerald-400"
                title={`Has phone: ${(lead.phone || lead.phoneSecondary || "").trim()}`}
                aria-label="Lead has a phone number"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </span>
            ) : null}
            {showEmailBadge && hasEmail(lead) ? (
              <span
                className="shrink-0 text-sky-600 dark:text-sky-400"
                title={`Has email: ${(lead.email || "").trim()}`}
                aria-label="Lead has an email address"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </span>
            ) : null}
            {lead.hasClientInfo === false && !lead.hasJobHistory ? (
              <span
                className="shrink-0 px-1 py-0.5 text-[9px] uppercase tracking-wide font-medium rounded bg-amber-500/15 text-amber-700 dark:text-amber-300"
                title="No 'About the client' sidebar AND no past-hires history — lead has only the job posting"
              >
                no info
              </span>
            ) : null}
            {/* Card action icons (Kanban view). Same behaviour as the lead
                drawer: LinkedIn opens the saved profile URL, Search runs a
                Google search of the company. stopPropagation so a click hits
                the icon, not the card's open-drawer handler. */}
            {tall && lead.linkedinUrl ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(
                    lead.linkedinUrl ?? "",
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
                title="Open LinkedIn profile in a new tab"
                aria-label="Open LinkedIn profile"
                className="shrink-0 text-[#0a66c2] transition-opacity hover:opacity-80"
              >
                <Linkedin className="h-4 w-4" />
              </button>
            ) : null}
            {tall && lead.company ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(
                    `https://www.google.com/search?q=${encodeURIComponent(
                      lead.company ?? "",
                    )}`,
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
                title="Search this company"
                aria-label="Search this company"
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              >
                <Search className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {lead.jobTitle && lead.company ? (
            <div
              className={`truncate text-muted-foreground mt-0.5 ${
                tall ? "text-sm" : "text-xs"
              }`}
            >
              {lead.jobTitle}
            </div>
          ) : null}
          {(() => {
            const c = resolveCountry(lead.clientLocation);
            if (!c) return null;
            return (
              <div
                className={`truncate text-muted-foreground mt-0.5 flex items-center gap-1.5 ${
                  tall ? "text-xs" : "text-[11px]"
                }`}
                title={`Client location: ${c.name}`}
              >
                <CountryFlag iso2={c.iso2} name={c.name} />
                <span className="truncate">{c.name}</span>
              </div>
            );
          })()}
          <div
            className={`flex items-center gap-2 mt-1.5 text-muted-foreground ${
              tall ? "text-xs" : "text-[10px]"
            }`}
          >
            <span className="tabular-nums">{timeOnly(lead.extractedAt)}</span>
            {isAllowedStatus(lead.statusName) ? (
              <span className={`px-1 py-0.5 rounded border ${colors.chip}`}>
                {lead.statusName}
              </span>
            ) : null}
            {lead.highlightedAt ? (
              <span title="Handled">★</span>
            ) : null}
            {(() => {
              // Three-state reminder badge per Apr 2026 client ask:
              //   - 🔔 amber: scheduled, hasn't fired yet
              //   - ✓+follow-up: first fired, +6h auto-follow-up scheduled
              //   - ✓ done: fired (and either followed up or cancelled)
              const sent = lead.reminderFirstSentAt != null;
              const pending = !sent && lead.reminderAt != null;
              const followupPending =
                sent &&
                lead.reminderFollowupPending === true &&
                lead.reminderAt != null;
              if (pending) {
                return (
                  <span title={`Reminder at ${lead.reminderAt}`}>🔔</span>
                );
              }
              if (followupPending && lead.reminderAt) {
                const ms = new Date(lead.reminderAt).getTime() - Date.now();
                const hours = Math.max(0, Math.round(ms / 3_600_000));
                return (
                  <span
                    className="text-green-700 dark:text-green-400"
                    title={`Sent — auto follow-up in ~${hours}h`}
                  >
                    ✓ +{hours}h
                  </span>
                );
              }
              if (sent) {
                return (
                  <span
                    className="text-green-700 dark:text-green-400"
                    title="Reminder already sent"
                  >
                    ✓ sent
                  </span>
                );
              }
              return null;
            })()}
            {/* Budget lives in the meta row only in the compact "View all"
                board. In the Kanban (tall) view it moves up to the card's
                top-right corner instead (see below). */}
            {!tall && lead.budget ? (
              <span
                className="ml-auto shrink-0 font-semibold tabular-nums text-emerald-700 dark:text-emerald-400"
                title={`Budget: ${lead.budget}`}
              >
                {lead.budget}
              </span>
            ) : null}
          </div>
          {/* Posted-on-Upwork time. In the compact "View all" board it sits
              inline below the scraped-time row; in the tall Kanban card it moves
              to the bottom-right footer instead (client ask Jul 2026 — see
              below). Uses the live-recomputed raw "posted X ago" string. Hidden
              when the scrape had only a junk value. */}
          {!tall && lead.postedRaw ? (
            <div
              className="truncate text-muted-foreground mt-0.5 text-[10px]"
              title={`Posted on Upwork: ${lead.postedRaw}`}
            >
              posted {livePostedAgo(lead.postedRaw, lead.extractedAt)}
            </div>
          ) : null}
        </div>
        {tall ? (
          /* Kanban view: budget pinned top-right (client ask Jul 2026),
             replacing the old "open lead page" link which was removed here. */
          lead.budget ? (
            <span
              className="shrink-0 text-base font-semibold tabular-nums text-emerald-700 dark:text-emerald-400"
              title={`Budget: ${lead.budget}`}
            >
              {lead.budget}
            </span>
          ) : null
        ) : (
          <a
            href={`/leads/${lead.id}`}
            onClick={(e) => e.stopPropagation()}
            title="Open lead page"
            className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground opacity-30 hover:opacity-100 transition-opacity"
            aria-label="Open lead page"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
        )}
        {/* ↗ shortcut: opens this lead's Upwork job in a new tab (client ask
            Jul 2026). Last item in the top-right row so it sits in the corner;
            stopPropagation so it doesn't also open the drawer. Only renders
            when the lead has an Upwork URL. */}
        {lead.upworkJobUrl ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              window.open(
                lead.upworkJobUrl ?? "",
                "_blank",
                "noopener,noreferrer",
              );
            }}
            title="Open Upwork job in a new tab"
            aria-label="Open Upwork job"
            className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground opacity-40 hover:opacity-100 transition-opacity"
          >
            <ArrowUpRight className={tall ? "h-5 w-5" : "h-3.5 w-3.5"} />
          </button>
        ) : null}
      </div>
      {/* Bottom-right footer, pinned flush to the card's corner (client ask Jul
          2026). Holds — right to left — the "mark irrelevant" control (stays in
          the very corner) and, on the tall Kanban card, the posted-on-Upwork
          time to its left. Absolutely positioned on the card itself so it
          escapes the p-3 padding and the text column's overflow-hidden. */}
      {onMarkIrrelevant || (tall && lead.postedRaw) ? (
        <div className="absolute bottom-1 right-1 flex items-center gap-2">
          {tall && lead.postedRaw ? (
            <span
              className="text-xs text-muted-foreground"
              title={`Posted on Upwork: ${lead.postedRaw}`}
            >
              posted {livePostedAgo(lead.postedRaw, lead.extractedAt)}
            </span>
          ) : null}
          {onMarkIrrelevant ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMarkIrrelevant(lead.id);
              }}
              title="Mark as irrelevant"
              aria-label="Mark lead as irrelevant"
              className={`transition-colors hover:text-rose-600 dark:hover:text-rose-400 ${
                tall ? "text-muted-foreground/60" : "text-muted-foreground/40"
              }`}
            >
              <Ban className={tall ? "h-6 w-6" : "h-3.5 w-3.5"} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Column({
  title,
  sub,
  leads,
  onOpen,
  onMarkIrrelevant,
  highlight,
  reminderColumn,
  takenCareColumn,
  filterControl,
  headerAction,
  showPhoneBadge,
  showEmailBadge,
  widthClass = "w-72",
  tallCards,
}: {
  title: string;
  sub?: string;
  leads: LeadRow[];
  onOpen: (id: string) => void;
  onMarkIrrelevant?: (id: string) => void;
  highlight?: boolean;
  reminderColumn?: boolean;
  takenCareColumn?: boolean;
  filterControl?: React.ReactNode;
  headerAction?: React.ReactNode;
  showPhoneBadge?: boolean;
  showEmailBadge?: boolean;
  // Column width utility class. Defaults to the standard w-72; the Kanban
  // view passes a wider class so its 3 columns get ~2x the room.
  widthClass?: string;
  // Render this column's cards at ~2x height (Kanban view). See Card `tall`.
  tallCards?: boolean;
}) {
  return (
    <div
      className={`${widthClass} shrink-0 rounded border p-3 ${
        takenCareColumn
          ? "bg-emerald-500/5 border-emerald-500/40"
          : highlight
            ? "bg-green-500/5 border-green-500/30"
            : reminderColumn
              ? "bg-amber-500/5 border-amber-500/40"
              : ""
      }`}
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate">
            {reminderColumn ? "🔔 " : ""}
            {takenCareColumn ? "✅ " : ""}
            {title}
          </div>
          {sub ? (
            <div className="text-[10px] text-muted-foreground truncate tabular-nums">
              {sub}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {headerAction}
          <div className="text-xs text-muted-foreground tabular-nums">
            {leads.length}
          </div>
        </div>
      </div>
      {filterControl ? <div className="mb-3">{filterControl}</div> : null}
      <div className="min-h-[40px]">
        {leads.length === 0 ? (
          <div className="text-xs text-muted-foreground italic px-1 py-4 text-center">
            —
          </div>
        ) : (
          leads.map((lead) => (
            <Card
              key={lead.id}
              lead={lead}
              onOpen={() => onOpen(lead.id)}
              onMarkIrrelevant={onMarkIrrelevant}
              showPhoneBadge={showPhoneBadge}
              showEmailBadge={showEmailBadge}
              tall={tallCards}
            />
          ))
        )}
      </div>
    </div>
  );
}

// Filter state that survives reloads, navigation, and the board's own
// auto-refresh + remounts. Client ask (Jun 2026, CEO): sending a mail from a
// card must NOT wipe the Emails-only / Companies-only / phone / window picks
// the reviewer set up — re-applying them every time wastes 10-15s. We hydrate
// from localStorage in a mount effect (not a lazy initializer) so the server
// and first client render agree and there's no hydration mismatch. The
// `hydrated` guard stops the save effect from clobbering stored values with
// the defaults before we've read them. Mirrors the `country` persistence
// already in this component.
function usePersistedState<T>(storageKey: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      // ignore corrupt/unavailable storage — fall back to the default
    }
    setHydrated(true);
  }, [storageKey]);
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // ignore quota/availability errors — persistence is best-effort
    }
  }, [storageKey, hydrated, value]);
  return [value, setValue] as const;
}

export function KanbanBoard({ statuses: _statuses }: { statuses: Status[] }) {
  // Which board layout to show (client ask Jul 2026):
  //   "all"    → the full board: Today | Yesterday | Reminders | Taken care |
  //              Day-2 | Day-3 (the original Kanban, unchanged).
  //   "kanban" → the stripped-down board: Today | Yesterday | Taken care only
  //              (no Reminders, no Day-2/Day-3).
  // Persisted so the reviewer's choice sticks across reloads/navigation.
  const [viewMode, setViewMode] = usePersistedState<"all" | "kanban">(
    "leads.kanban.viewMode",
    "kanban",
  );
  const [companiesOnly, setCompaniesOnly] = usePersistedState(
    "leads.kanban.companiesOnly",
    false,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  // "Taken care" column date filter (client ask Jun 2026): narrow the handled
  // pile to leads contacted within the last N IST calendar days. 7 is the hard
  // ceiling — anything contacted longer ago than the selected window drops off
  // the column entirely (default = full 7-day window).
  const [takenCareDays, setTakenCareDays] = usePersistedState(
    "leads.kanban.takenCareDays",
    7,
  );
  // "Taken care" phone filter (client ask Jun 2026): when on, the handled
  // pile shows only leads that carry a phone number (primary or secondary).
  const [takenCarePhoneOnly, setTakenCarePhoneOnly] = usePersistedState(
    "leads.kanban.takenCarePhoneOnly",
    false,
  );
  // "email only" filter for the Today / Yesterday columns (client ask Jun
  // 2026): when checked, that column shows only leads that carry an email.
  // Keyed by the day bucket key so each column toggles independently, mirroring
  // the per-column "ph.no. only" checkbox in "Taken care".
  const [emailOnlyByDay, setEmailOnlyByDay] = usePersistedState<
    Record<string, boolean>
  >("leads.kanban.emailOnlyByDay", {});
  // Country filter (client ask, May 2026): the reviewer works one country
  // at a time — "it's Armenia / United States, I can't call this guy" — so
  // they want to narrow the board to just the country they're calling
  // today. "" = all countries.
  const [country, setCountry] = useState<string>("");
  // "Remove duplicates" (Today column) in-flight flag.
  const [deduping, setDeduping] = useState(false);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const leadId = searchParams.get("leadId");
    if (leadId) {
      setOpenId(leadId);
    }
  }, [searchParams]);

  const handleOpenDrawer = (id: string) => {
    setOpenId(id);
    const params = new URLSearchParams(window.location.search);
    params.set("leadId", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleCloseDrawer = () => {
    setOpenId(null);
    const params = new URLSearchParams(window.location.search);
    params.delete("leadId");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const key = useMemo(() => {
    const params = new URLSearchParams();
    if (companiesOnly) params.set("companies_only", "1");
    // Fetch the whole day WINDOW, not newest-N. The API caps a plain
    // `limit` at 200, so on a high-volume day all 200 rows were "Today"
    // and Yesterday/older columns showed 0 (and toggling "Companies
    // only" inverted it). `days` switches the API to a bounded date
    // window; +1 day slack covers local-vs-UTC midnight at the edge.
    params.set("days", String(DAY_WINDOW + 1));
    // Must exceed the active-lead count across the whole window or older
    // day-columns get truncated. A busy 4-day window holds ~3k leads, so
    // 1500 silently dropped the oldest two columns — request the API's full
    // windowed ceiling instead. See effectiveMax in /api/leads/route.ts.
    params.set("limit", "8000");
    return `/api/leads?${params.toString()}`;
  }, [companiesOnly]);

  // Multi-user sync. This is the single heaviest DB read in the app — the
  // day-window query pulls up to 8,000 lead rows out of Neon on EVERY poll,
  // so a tight interval was the dominant driver of the data-transfer bill
  // (Jul 2026: it alone blew the Neon egress quota). Poll on a relaxed
  // cadence and lean on revalidateOnFocus so the board still snaps fresh the
  // instant a reviewer looks at it or acts (local edits are already
  // optimistic + mutate()); the only thing the longer interval delays is
  // seeing ANOTHER reviewer's change in the background. SWR does not poll
  // while the tab is hidden, so backgrounded tabs cost nothing.
  const { data, mutate } = useSWR<{ items: LeadRow[] }>(key, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  // Persist the country pick across reloads. The reviewer triages one
  // country over a calling session; re-selecting it on every visit is
  // exactly the manual toil they asked us to remove.
  useEffect(() => {
    const saved = localStorage.getItem("leads.kanban.country");
    if (saved) setCountry(saved);
  }, []);
  useEffect(() => {
    if (country) localStorage.setItem("leads.kanban.country", country);
    else localStorage.removeItem("leads.kanban.country");
  }, [country]);

  // Distinct countries present in the loaded leads, with counts, sorted
  // by name. Built from the FULL result (not the filtered view) so the
  // dropdown keeps offering every country even after one is selected.
  // resolveCountry() collapses the scraper's "USA"/"US"/"United States"
  // soup to one canonical {iso2,name}, so grouping by name is stable.
  const countryOptions = useMemo(() => {
    const counts = new Map<
      string,
      { name: string; iso2: string | null; n: number }
    >();
    for (const lead of data?.items ?? []) {
      const c = resolveCountry(lead.clientLocation);
      if (!c) continue;
      const cur = counts.get(c.name);
      if (cur) cur.n += 1;
      else counts.set(c.name, { name: c.name, iso2: c.iso2, n: 1 });
    }
    return Array.from(counts.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [data]);

  // The leads actually rendered: full set, or just the chosen country.
  // Drives day buckets AND the Reminders column AND the total — a country
  // filter that left foreign reminders on the board would defeat the
  // point ("don't show me people I can't call").
  const visibleItems = useMemo(() => {
    const items = data?.items ?? [];
    if (!country) return items;
    return items.filter(
      (l) => resolveCountry(l.clientLocation)?.name === country,
    );
  }, [data, country]);

  // Tick every minute so columns re-bucket on their own when the clock
  // crosses the 6 AM IST day boundary. Without this, a long-open tab could
  // keep "Today" as the prior day until SWR's diff detects a data change.
  const [minuteTick, setMinuteTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMinuteTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Build day columns: today → today-(N-1). Bucket each lead into its
  // local day based on extracted_at. Leads older than the window are
  // dropped from view entirely (per "milk goes off in 4 days").
  const columns = useMemo(() => {
    // "Today" is the current IST calendar day — server/product time — not the
    // host's local day. todayAnchor is that day's noon-UTC instant; stepping
    // back whole days from it stays correct because IST has no DST.
    const todayAnchor = istDayAnchor(dayKey(new Date()));
    const days: Array<{ date: Date; key: string; title: string; sub: string }> =
      [];
    for (let i = 0; i < DAY_WINDOW; i++) {
      const d = new Date(todayAnchor.getTime() - i * 24 * 60 * 60 * 1000);
      days.push({
        date: d,
        key: dayKey(d),
        // Index is the day-offset (loop steps one IST day at a time), so the
        // label is unambiguous without re-deriving a diff.
        title: i === 0 ? "Today" : i === 1 ? "Yesterday" : formatDayShort(d),
        // No year here — short.ts emits "29 Apr" so the column header stays
        // tight. The weekday is already in the title above.
        sub: formatDateOnly(d),
      });
    }

    // "Taken care" = the lead has been contacted (email sent or call logged
    // → lastContactedAt). A reminder set *after* the last contact means the
    // reviewer re-queued the lead, so it stays in Reminders, not Taken care.
    // Defined up here (ahead of the day-bucketing) so a contacted lead can be
    // kept OUT of its day column — once handled it belongs ONLY in "Taken
    // care", not still sitting in Today/Yesterday (client ask Jun 2026).
    const contactedMs = (l: LeadRow) =>
      l.lastContactedAt ? new Date(l.lastContactedAt).getTime() : null;
    const isTakenCare = (l: LeadRow) => {
      const c = contactedMs(l);
      if (c == null || isNaN(c)) return false;
      const due = l.reminderAt ? new Date(l.reminderAt).getTime() : null;
      if (due != null && !isNaN(due) && due > c) return false;
      return true;
    };

    const buckets = new Map<string, LeadRow[]>();
    for (const d of days) buckets.set(d.key, []);

    for (const lead of visibleItems) {
      // Skip handled leads — they move wholesale into the "Taken care" column
      // and must not also linger in their arrival-day bucket.
      if (isTakenCare(lead)) continue;
      const when = lead.extractedAt ?? lead.createdAt;
      if (!when) continue;
      const d = new Date(when);
      if (isNaN(d.getTime())) continue;
      const k = dayKey(d);
      const b = buckets.get(k);
      if (b) b.push(lead);
      // Out-of-window leads are intentionally dropped.
    }

    // Sort each bucket newest-first (API already returns newest-first for
    // the overall list — this keeps that order per column).
    const sortKey = (l: LeadRow) =>
      new Date(l.extractedAt ?? l.createdAt ?? 0).getTime();
    buckets.forEach((b) =>
      b.sort((a: LeadRow, b: LeadRow) => sortKey(b) - sortKey(a)),
    );

    // Reminders pseudo-columns (one per recipient):
    //   1. Active scheduled reminder due within the horizon, OR
    //   2. A reminder fired within the last 24h (sticky — reviewer wants
    //      visibility into multi-follow-up cards even after the message
    //      went out).
    // Split by lead.reminderAccount so each recipient gets their own column.
    const horizonMs =
      todayAnchor.getTime() + REMINDER_HORIZON_DAYS * 24 * 60 * 60 * 1000;
    const stickyCutoffMs = Date.now() - 24 * 60 * 60 * 1000;

    const reminderSort = (a: LeadRow, b: LeadRow) => {
      const aDue = a.reminderAt ? new Date(a.reminderAt).getTime() : null;
      const bDue = b.reminderAt ? new Date(b.reminderAt).getTime() : null;
      if (aDue != null && bDue != null) return aDue - bDue;
      if (aDue != null) return -1;
      if (bDue != null) return 1;
      const aSent = a.reminderFirstSentAt ? new Date(a.reminderFirstSentAt).getTime() : 0;
      const bSent = b.reminderFirstSentAt ? new Date(b.reminderFirstSentAt).getTime() : 0;
      return bSent - aSent;
    };

    const isReminderItem = (l: LeadRow) => {
      const due = l.reminderAt ? new Date(l.reminderAt).getTime() : null;
      const firstSent = l.reminderFirstSentAt
        ? new Date(l.reminderFirstSentAt).getTime()
        : null;
      return (
        (due != null && !isNaN(due) && due <= horizonMs) ||
        (firstSent != null && !isNaN(firstSent) && firstSent > stickyCutoffMs)
      );
    };

    // Pending reminders (any account) that haven't been handled yet. Once a
    // mail is sent / call logged the lead drops out of here and into Taken care.
    const reminders = visibleItems
      .filter((l) => !isTakenCare(l) && isReminderItem(l))
      .sort(reminderSort);

    // Handled pile — most recently contacted first, then trimmed to the
    // selected date window. The window is measured in US EASTERN calendar days
    // (not the board's IST bucketing): the cutoff is the ET day-key N-1 days
    // back from ET-today, so "Today" = today only, "Last 3 days" = today + 2
    // prior, up to the 7-day ceiling. Anchored at noon-UTC of ET-today (well
    // clear of ET midnight, so DST offset shifts never move the day), then
    // stepped back whole days. Day-keys are YYYY-MM-DD → lexical >= compares
    // calendar days correctly.
    const usTodayAnchor = new Date(`${dayKeyUS(new Date())}T12:00:00Z`);
    const takenCareCutoffKey = dayKeyUS(
      new Date(
        usTodayAnchor.getTime() -
          (takenCareDays - 1) * 24 * 60 * 60 * 1000,
      ),
    );
    const takenCare = visibleItems
      .filter(isTakenCare)
      .filter((l) => {
        if (!l.lastContactedAt) return false;
        const d = new Date(l.lastContactedAt);
        if (isNaN(d.getTime())) return false;
        return dayKeyUS(d) >= takenCareCutoffKey;
      })
      .filter((l) => (takenCarePhoneOnly ? hasPhone(l) : true))
      .sort((a, b) => (contactedMs(b) ?? 0) - (contactedMs(a) ?? 0));

    return { days, buckets, reminders, takenCare };
    // minuteTick drives the midnight re-bucket; safe to depend on even
    // though it isn't read inside — React just re-runs the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, minuteTick, takenCareDays, takenCarePhoneOnly]);

  // Mark a lead irrelevant straight from its Kanban card (client ask Jul 2026)
  // — same PATCH the drawer's "Mark as irrelevant" fires. The board's default
  // fetch filters out irrelevant leads, so on the next revalidation the card
  // drops off the board on its own. No confirm prompt (client ask Jul 2026):
  // the reviewer wants a single click to dismiss junk — it's still reversible
  // via the drawer's Restore, and a toast reports what happened.
  async function handleMarkIrrelevant(id: string) {
    try {
      const res = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ irrelevant: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      toast.success("Marked irrelevant");
      mutate();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to mark irrelevant",
      );
    }
  }

  // Delete duplicate leads from the Today column, matching on title + company.
  // Keeps one lead per group (server picks the keeper — contacted > reminder >
  // newest). We count victims here only for the confirm prompt; the server
  // re-computes and returns the real count.
  async function handleRemoveDuplicates(todayLeads: LeadRow[]) {
    const counts = new Map<string, number>();
    for (const l of todayLeads) {
      const k = dupKey(l);
      if (!k) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    let victimCount = 0;
    for (const n of Array.from(counts.values())) if (n > 1) victimCount += n - 1;

    if (victimCount === 0) {
      toast.info("No duplicates found in Today.");
      return;
    }
    if (
      !window.confirm(
        `Found ${victimCount} duplicate lead${victimCount === 1 ? "" : "s"} in Today (same title + company). Delete the duplicates, keeping one of each?`
      )
    ) {
      return;
    }

    setDeduping(true);
    try {
      const res = await fetch("/api/leads/dedupe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: todayLeads.map((l) => l.id) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove duplicates");
      toast.success(
        `Removed ${data.deleted} duplicate${data.deleted === 1 ? "" : "s"} from Today.`
      );
      mutate();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Failed to remove duplicates"
      );
    } finally {
      setDeduping(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-3">
        {/* View switcher (client ask Jul 2026): "View all" = the full board,
            "Kanban" = the stripped-down Today / Yesterday / Taken care board. */}
        <div
          className="inline-flex shrink-0 rounded-md border p-0.5 text-sm"
          role="group"
          aria-label="Board view"
        >
          <button
            type="button"
            onClick={() => setViewMode("all")}
            aria-pressed={viewMode === "all"}
            className={`rounded px-3 py-1 transition-colors ${
              viewMode === "all"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            View all
          </button>
          <button
            type="button"
            onClick={() => setViewMode("kanban")}
            aria-pressed={viewMode === "kanban"}
            className={`rounded px-3 py-1 transition-colors ${
              viewMode === "kanban"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Workspace
          </button>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={companiesOnly}
            onChange={(e) => setCompaniesOnly(e.target.checked)}
          />
          Companies only
        </label>
        <div className="flex items-center gap-2">
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="text-sm border rounded px-2 py-1 bg-background"
            aria-label="Filter leads by client country"
            title="Show only leads whose client is in this country"
          >
            <option value="">All countries</option>
            {/* Keep a stale saved pick visible so an empty board reads as
                "United States (0)" rather than a mysterious blank. */}
            {country && !countryOptions.some((c) => c.name === country) ? (
              <option value={country}>{country} (0)</option>
            ) : null}
            {countryOptions.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.n})
              </option>
            ))}
          </select>
          {country ? (
            <button
              type="button"
              onClick={() => setCountry("")}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {(() => {
          // Column width: the Kanban view shows only 3 columns, so give each
          // ~2x the standard width (client ask Jul 2026). "View all" keeps the
          // compact w-72 since it packs 6 columns across.
          const columnWidthClass =
            viewMode === "kanban" ? "w-[36rem]" : "w-72";
          // Double the card height in the Kanban view (client ask Jul 2026).
          const tallCards = viewMode === "kanban";

          // Reminders + "Taken care" columns, built once and composed
          // differently per view below. Reminders = leads still to chase;
          // Taken care = leads already contacted (mail sent / call logged).
          const remindersColumn = (
            <Column
              key="__reminders"
              widthClass={columnWidthClass}
              tallCards={tallCards}
              title="Reminders"
              sub={
                columns.reminders.length === 0
                  ? "no pending"
                  : `next ${REMINDER_HORIZON_DAYS}d`
              }
              leads={columns.reminders}
              onOpen={handleOpenDrawer}
              onMarkIrrelevant={handleMarkIrrelevant}
              reminderColumn
              showEmailBadge
            />
          );
          const takenCareColumn = (
            <Column
              key="__taken_care"
              widthClass={columnWidthClass}
              tallCards={tallCards}
              title="Taken care"
              sub={
                columns.takenCare.length === 0
                  ? "nothing yet"
                  : `${columns.takenCare.length} handled`
              }
              leads={columns.takenCare}
              onOpen={handleOpenDrawer}
              onMarkIrrelevant={handleMarkIrrelevant}
              takenCareColumn
              showPhoneBadge
              headerAction={
                <label
                  className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none"
                  title="Show only handled leads that have a phone number"
                >
                  <input
                    type="checkbox"
                    className="h-3 w-3"
                    checked={takenCarePhoneOnly}
                    onChange={(e) => setTakenCarePhoneOnly(e.target.checked)}
                  />
                  ph.no. only
                </label>
              }
              filterControl={
                <select
                  value={takenCareDays}
                  onChange={(e) => setTakenCareDays(Number(e.target.value))}
                  className="w-full text-xs border border-emerald-500/40 rounded px-2 py-1 bg-background"
                  aria-label="Filter handled leads by how recently they were contacted"
                  title="Show leads contacted within this window (max 7 days)"
                >
                  <option value={1}>Today</option>
                  <option value={2}>Last 2 days</option>
                  <option value={3}>Last 3 days</option>
                  <option value={4}>Last 4 days</option>
                  <option value={5}>Last 5 days</option>
                  <option value={6}>Last 6 days</option>
                  <option value={7}>Last 7 days</option>
                </select>
              }
            />
          );

          // One day column (Today / Yesterday / Day-N). i 0/1 (Today &
          // Yesterday) get the "email only" toggle + mail badge; Today also
          // gets the Dedupe button when Companies-only is on.
          const renderDay = (
            d: { date: Date; key: string; title: string; sub: string },
            i: number,
          ) => {
            const dayLeads = columns.buckets.get(d.key) ?? [];
            const emailColumn = i === 0 || i === 1;
            const emailOnly = emailColumn && !!emailOnlyByDay[d.key];
            const shownLeads = emailOnly
              ? dayLeads.filter(hasEmail)
              : dayLeads;
            const dedupeButton =
              i === 0 && companiesOnly ? (
                <button
                  type="button"
                  onClick={() => handleRemoveDuplicates(dayLeads)}
                  disabled={deduping || dayLeads.length === 0}
                  title="Delete duplicate leads in Today (same title + company), keeping one of each"
                  className="text-[11px] rounded border px-1.5 py-0.5 text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deduping ? "Removing…" : "Dedupe"}
                </button>
              ) : null;
            return (
              <Column
                key={d.key}
                widthClass={columnWidthClass}
                tallCards={tallCards}
                title={d.title}
                sub={d.sub}
                leads={shownLeads}
                onOpen={handleOpenDrawer}
                onMarkIrrelevant={handleMarkIrrelevant}
                highlight={i === 0}
                showEmailBadge={emailColumn}
                headerAction={
                  emailColumn ? (
                    <div className="flex items-center gap-2">
                      <label
                        className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer select-none"
                        title="Show only leads that have an email address"
                      >
                        <input
                          type="checkbox"
                          className="h-3 w-3"
                          checked={!!emailOnlyByDay[d.key]}
                          onChange={(e) =>
                            setEmailOnlyByDay((prev) => ({
                              ...prev,
                              [d.key]: e.target.checked,
                            }))
                          }
                        />
                        email only
                      </label>
                      {dedupeButton}
                    </div>
                  ) : (
                    dedupeButton ?? undefined
                  )
                }
              />
            );
          };

          // "Kanban" view: the stripped-down board — Today, Yesterday, Taken
          // care only. No Reminders and no Day-2/Day-3.
          if (viewMode === "kanban") {
            return [
              ...columns.days.slice(0, 2).map((d, i) => renderDay(d, i)),
              takenCareColumn,
            ];
          }

          // "View all" — the full board:
          //   Today | Yesterday | Reminders | Taken care | Day-2 | Day-3.
          // Reminders + Taken care are spliced in at REMINDERS_COLUMN_INDEX.
          const rendered: React.ReactNode[] = [];
          columns.days.forEach((d, i) => {
            if (i === REMINDERS_COLUMN_INDEX) {
              rendered.push(remindersColumn);
              rendered.push(takenCareColumn);
            }
            rendered.push(renderDay(d, i));
          });
          if (REMINDERS_COLUMN_INDEX >= columns.days.length) {
            rendered.push(remindersColumn);
            rendered.push(takenCareColumn);
          }
          return rendered;
        })()}
      </div>

      <LeadDrawer
        leadId={openId}
        statuses={_statuses}
        onClose={handleCloseDrawer}
        onChanged={() => mutate()}
      />
    </div>
  );
}
