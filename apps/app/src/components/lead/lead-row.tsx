/**
 * One row of the Leads list.
 *
 * Pulled out of routes/leads.tsx because the row is where the list's problem
 * was: every lead without a company rendered its title in italic
 * muted-foreground, and since most scraped postings carry no company that was
 * the whole page — a wall of grey italics with no anchor to scan by, at which
 * point the eye has nothing to land on and the list reads as one texture.
 *
 * What the row does now:
 *   - the title is ALWAYS solid foreground, never italic. "We don't know the
 *     company" is carried by the leading tile (a briefcase glyph instead of a
 *     letter), not by degrading the one string the user actually reads.
 *   - a coloured monogram tile opens each row, seeded off the lead id, so rows
 *     differ from each other at a glance instead of only by their text.
 *   - read/unread is the real hierarchy: never-opened leads are semibold and
 *     full contrast, ones you have already opened step back. That is the
 *     "what's new since last time" scan the team does.
 *   - metadata (email, country, budget) is one quiet icon-led line at 12px, so
 *     it reads as support rather than competing with the title.
 *   - the per-row Cap and Upwork links are hover/focus-revealed instead of
 *     sitting on every row as an emoji pill.
 */
import {
  Briefcase,
  ExternalLink,
  Eye,
  Mail,
  Star,
  Video,
  Wallet,
} from "lucide-react";
import type { Lead } from "@/fetchers/lead/get-leads-view";
import { cn } from "@/lib/cn";
import { flagUrl, flagUrl2x, resolveCountry } from "@/lib/country";

/**
 * Eight tints, all at the same low saturation so no single row shouts. The
 * point is differentiation between rows, not decoration.
 */
const MONOGRAM_TINTS = [
  "bg-blue-500/12 text-blue-700 ring-blue-500/16 dark:bg-blue-400/12 dark:text-blue-300 dark:ring-blue-400/20",
  "bg-emerald-500/12 text-emerald-700 ring-emerald-500/16 dark:bg-emerald-400/12 dark:text-emerald-300 dark:ring-emerald-400/20",
  "bg-amber-500/14 text-amber-700 ring-amber-500/18 dark:bg-amber-400/12 dark:text-amber-300 dark:ring-amber-400/20",
  "bg-violet-500/12 text-violet-700 ring-violet-500/16 dark:bg-violet-400/12 dark:text-violet-300 dark:ring-violet-400/20",
  "bg-rose-500/12 text-rose-700 ring-rose-500/16 dark:bg-rose-400/12 dark:text-rose-300 dark:ring-rose-400/20",
  "bg-cyan-500/12 text-cyan-700 ring-cyan-500/16 dark:bg-cyan-400/12 dark:text-cyan-300 dark:ring-cyan-400/20",
  "bg-orange-500/12 text-orange-700 ring-orange-500/16 dark:bg-orange-400/12 dark:text-orange-300 dark:ring-orange-400/20",
  "bg-teal-500/12 text-teal-700 ring-teal-500/16 dark:bg-teal-400/12 dark:text-teal-300 dark:ring-teal-400/20",
];

function tintFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return MONOGRAM_TINTS[h % MONOGRAM_TINTS.length];
}

/** Status → colour, mirroring lib/leads/status-colors in the legacy app. */
export function statusChipClass(name: string | null) {
  switch ((name ?? "").toLowerCase()) {
    case "follow-up":
      return "border-amber-500/24 bg-amber-500/12 text-amber-700 dark:text-amber-300";
    case "lost":
      return "border-rose-500/24 bg-rose-500/12 text-rose-700 dark:text-rose-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export function relative(iso: string | null) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function primaryLabel(lead: Lead) {
  return (
    lead.company ||
    [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() ||
    lead.jobTitle ||
    "Untitled lead"
  );
}

/** The name the monogram letter comes from, if we have one at all. */
function identityName(lead: Lead) {
  return (
    lead.company || [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim()
  );
}

function CountryFlag({ iso2, name }: { iso2: string; name: string }) {
  return (
    <img
      src={flagUrl(iso2, 16)}
      srcSet={`${flagUrl(iso2, 16)} 1x, ${flagUrl2x(iso2, 16)} 2x`}
      width={16}
      height={12}
      alt={name}
      loading="lazy"
      decoding="async"
      className="inline-block shrink-0 rounded-[2px] ring-1 ring-black/8 dark:ring-white/12"
      style={{ width: 16, height: 12 }}
    />
  );
}

function LeadTile({ lead }: { lead: Lead }) {
  const identity = identityName(lead);

  // No company and no person: this is a bare job posting. The briefcase says
  // that in one glyph — which is exactly what the old italic grey title was
  // trying to say, at the cost of the title being readable.
  if (!identity) {
    return (
      <span
        aria-hidden
        title="Job posting — no client identity captured"
        className="flex size-9 shrink-0 items-center justify-center rounded-[0.7rem] bg-muted text-muted-foreground ring-1 ring-inset ring-border"
      >
        <Briefcase className="size-4" />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-[0.7rem] font-semibold text-sm uppercase ring-1 ring-inset",
        tintFor(lead.id),
      )}
    >
      {identity.trim().charAt(0)}
    </span>
  );
}

/** Budget off the scrape — the first thing anyone asks about a lead. */
function budgetLabel(lead: Lead) {
  const raw = lead.sourcePayload?.budget_raw?.trim();
  if (!raw || raw.length > 28) return null;
  return raw;
}

export function LeadRow({
  lead,
  selected,
  onOpen,
  onToggleStar,
}: {
  lead: Lead;
  selected: boolean;
  onOpen: () => void;
  onToggleStar: () => void;
}) {
  const primary = primaryLabel(lead);
  const jobTitle =
    lead.jobTitle && lead.jobTitle !== primary ? lead.jobTitle : null;
  const noClientInfo = lead.hasClientInfo === false && !lead.hasJobHistory;
  const country = resolveCountry(lead.clientLocation);
  const when = lead.extractedAt ?? lead.createdAt;
  const read = Boolean(lead.viewedAt);
  const starred = Boolean(lead.highlightedAt);
  const budget = budgetLabel(lead);
  const pendingReminder = Boolean(lead.reminderAt && !lead.reminderSentAt);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group relative flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-start outline-none transition-colors",
        "hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        selected && "bg-accent",
      )}
    >
      {/* Handled leads carry a spine so a starred row is findable while
          scrolling, not only by the star's fill. */}
      {starred ? (
        <span
          aria-hidden
          className="absolute inset-y-1.5 start-0 w-[3px] rounded-e-full bg-amber-400"
        />
      ) : null}

      <button
        type="button"
        aria-label={starred ? "Unmark as handled" : "Mark as handled"}
        aria-pressed={starred}
        title={starred ? "Handled" : "Mark as handled"}
        className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground/40 outline-none transition-colors hover:text-amber-500 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(e) => {
          e.stopPropagation();
          onToggleStar();
        }}
      >
        <Star
          className={cn(
            "size-4 transition-colors",
            starred && "fill-amber-400 text-amber-500",
          )}
        />
      </button>

      <LeadTile lead={lead} />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            title={primary}
            className={cn(
              "truncate text-[0.9375rem] leading-5 tracking-[-0.006em]",
              read
                ? "font-medium text-foreground/70"
                : "font-semibold text-foreground",
            )}
          >
            {primary}
          </span>

          {lead.statusName ? (
            <span
              className={cn(
                "shrink-0 rounded-md border px-1.5 py-px font-medium text-[11px] leading-4",
                statusChipClass(lead.statusName),
              )}
            >
              {lead.statusName}
            </span>
          ) : null}

          {noClientInfo ? (
            <span
              className="shrink-0 rounded-md border border-amber-500/24 bg-amber-500/12 px-1.5 py-px font-medium text-[10px] text-amber-700 uppercase leading-4 tracking-wide dark:text-amber-300"
              title="Only the job posting was captured — no client signals."
            >
              no client info
            </span>
          ) : null}

          {pendingReminder ? (
            <span
              className="shrink-0 rounded-md border border-blue-500/24 bg-blue-500/12 px-1.5 py-px font-medium text-[10px] text-blue-700 uppercase leading-4 tracking-wide dark:text-blue-300"
              title={lead.reminderNote ?? "Reminder set"}
            >
              reminder
            </span>
          ) : null}

          {/* Per-user "I have eyeballed this one", stamped when the detail is
              opened. It follows the title so the unread rows stay flush. */}
          {read ? (
            <Eye
              className="size-3.5 shrink-0 text-muted-foreground/60"
              aria-label="You have opened this lead"
            >
              <title>{`You opened this on ${new Date(lead.viewedAt as string).toLocaleString()}`}</title>
            </Eye>
          ) : null}
        </div>

        {/* One quiet support line. Icons stand in for labels so the eye can
            skip straight to the value it is hunting. */}
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
          {jobTitle ? (
            <span className="min-w-0 max-w-[66ch] truncate text-foreground/60">
              {jobTitle}
            </span>
          ) : null}

          {lead.email ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <Mail className="size-3 shrink-0 opacity-70" />
              <span className="truncate">{lead.email}</span>
            </span>
          ) : null}

          {country ? (
            <span className="inline-flex shrink-0 items-center gap-1.5">
              {country.iso2 ? (
                <CountryFlag iso2={country.iso2} name={country.name} />
              ) : null}
              {country.name}
            </span>
          ) : null}

          {budget ? (
            <span className="inline-flex shrink-0 items-center gap-1 tabular-nums">
              <Wallet className="size-3 opacity-70" />
              {budget}
            </span>
          ) : null}
        </div>
      </div>

      {/* Row actions live on hover/focus. On every row, always visible, they
          were louder than the lead itself. */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <a
          href="https://cap.nuraview.com"
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Record a short video for this lead (opens Cap)"
          aria-label="Record a video for this lead"
          className="rounded-md p-1.5 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Video className="size-4" />
        </a>
        {lead.upworkJobUrl ? (
          <a
            href={lead.upworkJobUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="Open on Upwork"
            aria-label="Open on Upwork"
            className="rounded-md p-1.5 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ExternalLink className="size-4" />
          </a>
        ) : null}
      </div>

      {/* Absolute date over relative age, as in the legacy list: the exact
          timestamp is what gets quoted in outreach, the relative one is what
          makes freshness scannable. Tabular figures so the column lines up. */}
      <div className="w-[108px] shrink-0 text-end tabular-nums">
        <div className="whitespace-nowrap font-medium text-[12px] text-foreground/75 leading-4">
          {when
            ? new Date(when).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—"}
        </div>
        <div className="text-[11px] text-muted-foreground leading-4">
          {relative(when) ?? ""}
        </div>
      </div>
    </div>
  );
}

/** Skeleton shaped like the real row, not a single grey bar. */
export function LeadRowSkeleton() {
  return (
    <div className="flex w-full items-center gap-3 px-4 py-2.5">
      <div className="size-4 shrink-0 rounded bg-muted" />
      <div className="size-9 shrink-0 rounded-[0.7rem] bg-muted" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3.5 w-[42%] rounded bg-muted" />
        <div className="h-2.5 w-[28%] rounded bg-muted/70" />
      </div>
      <div className="h-6 w-[76px] shrink-0 rounded bg-muted/70" />
    </div>
  );
}
