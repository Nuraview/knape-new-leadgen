/**
 * Leads → Kanban.
 *
 * Ported from apps/web/app/(routes)/leads/components/KanbanBoard.tsx, keeping
 * NuraView's column model rather than inventing one:
 *
 *   - Columns are DAYS, not statuses: Today, Yesterday, then two more,
 *     bucketed by when the lead was scraped.
 *   - "Reminders" collects leads with a reminder due inside the horizon, plus
 *     any whose reminder fired in the last 24h (sticky, so multi-follow-up
 *     cards stay visible after the message goes out).
 *   - "Taken care" is the handled pile: contacted, with no reminder set AFTER
 *     that contact. A handled lead leaves its arrival-day column entirely
 *     rather than sitting in both.
 *
 * Day bucketing is anchored to IST because that is product/server time — using
 * the viewer's local day would put leads in the wrong column depending on who
 * is looking.
 */
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Ban,
  Bell,
  CheckCircle2,
  ExternalLink,
  Eye,
  Linkedin,
  Mail,
  Phone,
  Search,
  Star,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Layout from "@/components/common/layout";
import { LeadDetailPanel } from "@/components/lead/lead-detail-panel";
import PageTitle from "@/components/page-title";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { type Lead, getLeadsView } from "@/fetchers/lead/get-leads-view";
import {
  setLeadHighlighted,
  setLeadIrrelevant,
} from "@/fetchers/lead/mutate-lead";
import { cn } from "@/lib/cn";
import { useDialer } from "@/components/dialer/dialer-provider";
import { getApiUrl } from "@/fetchers/get-api-url";
import { formatRelativeAgo } from "@/lib/dates/short";
import { toast } from "@/lib/toast";

/**
 * Day columns on the FULL board. The focused board shows only the first two.
 *
 * The legacy Kanban makes this a switch, not a deletion — "View all" gives the
 * whole board, "Workspace" strips it to Today / Yesterday / Taken care. VK
 * asked for the focused layout ("we just need today, yesterday and taken
 * care"), but he also said "when I click on full view, I would see all this",
 * so removing the columns outright would have taken away the other half of
 * what he described.
 */
const DAY_WINDOW = 4;
const IST_OFFSET_MIN = 330; // UTC+05:30, no DST

/** YYYY-MM-DD for the IST calendar day containing `d`. */
function istDayKey(d: Date) {
  const shifted = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Noon-UTC anchor for an IST day key — safe to step whole days from. */
function istDayAnchor(key: string) {
  return new Date(`${key}T12:00:00Z`);
}

function primaryLabel(lead: Lead) {
  return (
    lead.company ||
    [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() ||
    lead.jobTitle ||
    "Untitled lead"
  );
}

/**
 * Posting budget out of the scraper payload — the legacy card shows it in
 * green at the top-right and the reviewer scans for it. Same rule as the lead
 * detail: budget_raw first, numeric pair as fallback, null for Upwork's "N/A".
 */
function cardBudget(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const raw = typeof p.budget_raw === "string" ? p.budget_raw.trim() : "";
  if (raw && raw.toUpperCase() !== "N/A") return raw;

  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const min = num(p.budget_min);
  const max = num(p.budget_max);
  const fmt = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (min != null && max != null) return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
  if (min != null) return fmt(min);
  if (max != null) return fmt(max);
  return null;
}

/** Posted/scraped clock time, IST — what the legacy card shows under the flag. */
function cardTime(lead: Lead): string | null {
  const iso = lead.postedAt ?? lead.extractedAt ?? lead.createdAt;
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

/** Legacy rule (KanbanBoard.tsx:170): the manual phoneSecondary slot counts. */
function hasPhone(l: Lead): boolean {
  return Boolean(l.phone?.trim() || l.phoneSecondary?.trim());
}

function LeadCard({
  lead,
  onStar,
  onOpen,
  onMarkIrrelevant,
  onDial,
}: {
  lead: Lead;
  onStar: () => void;
  onOpen: () => void;
  onMarkIrrelevant: () => void;
  onDial: () => void;
}) {
  const primary = primaryLabel(lead);
  const budget = cardBudget(lead.sourcePayload);
  const time = cardTime(lead);
  /*
   * Legacy rendered lead.postedRaw — Upwork's phrase as captured AT SCRAPE TIME
   * ("13 minutes ago"), re-anchored by livePostedAgo. There is no posted_raw
   * column on this schema; there IS a real posted_at timestamp, which is
   * strictly better because it cannot go stale. 14,793 leads carry one.
   */
  const posted = lead.postedAt ? formatRelativeAgo(new Date(lead.postedAt)) : null;
  return (
    // Clicking a card opens the lead, which is what it did in the legacy app.
    // Rendered as a button so it is keyboard reachable; the star and the Upwork
    // link inside it stop propagation so they keep their own behaviour.
    <button
      type="button"
      onClick={onOpen}
      className="relative w-full cursor-pointer rounded-lg border border-border bg-card p-3 pb-7 text-left transition-colors hover:border-border/80 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-label="Toggle handled"
          className="mt-0.5 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onStar();
          }}
        >
          <Star
            className={cn(
              "size-4",
              lead.highlightedAt
                ? "fill-amber-400 text-amber-500"
                : "text-muted-foreground/50 hover:text-muted-foreground",
            )}
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div
              className={cn(
                "min-w-0 flex-1 truncate text-sm font-medium",
                !lead.company && "italic text-muted-foreground",
              )}
            >
              {primary}
            </div>

            {/* Ported from the legacy card (KanbanBoard.tsx:265-357). The badges
                say "this lead already has contact details" at a glance; the two
                icon buttons are the ones VK uses constantly — LinkedIn opens the
                saved profile, the magnifying glass Googles the company. Legacy
                gated these on tall cards only; rendered in both views here. */}
            {/* "You opened this one" (KanbanBoard.tsx:256-264). Per-user and
                stamped on detail open, so the board shows at a glance what has
                already been looked at today. */}
            {lead.viewedAt ? (
              <span
                className="shrink-0 text-muted-foreground"
                title={`You opened this on ${new Date(lead.viewedAt).toLocaleString()}`}
                aria-label="You have opened this lead"
              >
                <Eye className="size-3" />
              </span>
            ) : null}
            {hasPhone(lead) ? (
              <span
                className="shrink-0 text-emerald-600 dark:text-emerald-400"
                title={`Has phone: ${(lead.phone || lead.phoneSecondary || "").trim()}`}
                aria-label="Lead has a phone number"
              >
                <Phone className="size-3" />
              </span>
            ) : null}
            {lead.email ? (
              <span
                className="shrink-0 text-sky-600 dark:text-sky-400"
                title={`Has email: ${lead.email.trim()}`}
                aria-label="Lead has an email address"
              >
                <Mail className="size-3" />
              </span>
            ) : null}
            {lead.linkedinUrl ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(lead.linkedinUrl ?? "", "_blank", "noopener,noreferrer");
                }}
                title="Open LinkedIn profile in a new tab"
                aria-label="Open LinkedIn profile"
                className="shrink-0 text-[#0a66c2] transition-opacity hover:opacity-80"
              >
                <Linkedin className="size-4" />
              </button>
            ) : null}
            {lead.company ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(
                    `https://www.google.com/search?q=${encodeURIComponent(lead.company ?? "")}`,
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
                title="Search this company"
                aria-label="Search this company"
                className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              >
                <Search className="size-3.5" />
              </button>
            ) : null}
            {budget ? (
              <span className="shrink-0 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                {budget}
              </span>
            ) : null}
          </div>
          {lead.jobTitle && lead.jobTitle !== primary ? (
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {lead.jobTitle}
            </div>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {lead.clientLocation ? <span>{lead.clientLocation}</span> : null}
            {time ? <span className="tabular-nums">{time}</span> : null}
            {lead.reminderAt ? (
              <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                <Bell className="size-3" />
                {new Date(lead.reminderAt).toLocaleDateString()}
              </span>
            ) : null}
            {lead.upworkJobUrl ? (
              <a
                href={lead.upworkJobUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 underline"
              >
                <ExternalLink className="size-3" />
                Upwork
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {/* Absolutely positioned so it escapes the card padding and the text
          column's overflow — exactly as legacy does (KanbanBoard.tsx:517-544).
          No confirm dialog on Ban, deliberately: the whole point is one click
          to make an irrelevant lead disappear. */}
      <div className="absolute bottom-1 right-1 flex items-center gap-2">
        {posted ? (
          <span
            className="text-xs text-muted-foreground"
            title={`Posted on Upwork: ${new Date(lead.postedAt ?? "").toLocaleString()}`}
          >
            posted {posted}
          </span>
        ) : null}
        {/* One-click dial straight off the card. VK: "there was an option for
            me to dial from this only." Only shown when there is a number to
            call — an always-visible button that sometimes does nothing is
            worse than no button. */}
        {hasPhone(lead) ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDial();
            }}
            title={`Call ${(lead.phone || lead.phoneSecondary || "").trim()}`}
            aria-label="Call this lead"
            className="text-emerald-600 transition-colors hover:text-emerald-500 dark:text-emerald-400"
          >
            <Phone className="size-5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMarkIrrelevant();
          }}
          title="Mark as irrelevant"
          aria-label="Mark lead as irrelevant"
          className="text-muted-foreground/60 transition-colors hover:text-rose-600 dark:hover:text-rose-400"
        >
          <Ban className="size-5" />
        </button>
      </div>
    </button>
  );
}

function Column({
  title,
  subtitle,
  icon,
  leads,
  emailOnly,
  onEmailOnly,
  onStar,
  onMarkIrrelevant,
  onDial,
  onOpen,
  isLoading,
  total,
  fill,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  leads: Lead[];
  emailOnly?: boolean;
  onEmailOnly?: (value: boolean) => void;
  onStar: (lead: Lead) => void;
  onMarkIrrelevant: (lead: Lead) => void;
  onDial: (lead: Lead) => void;
  onOpen: (lead: Lead) => void;
  isLoading: boolean;
  /** Server-side count for the column, which can exceed the page fetched. */
  total?: number;
  /** Focused board: three columns share the width instead of leaving it dead. */
  fill?: boolean;
}) {
  return (
    <section
      className={cn(
        // Tinted column, white cards. The legacy board does the same thing —
        // it is what makes a card read as an object rather than as a box drawn
        // on the page. bg-muted/40 was ~2% black and effectively invisible.
        "flex min-w-0 flex-col rounded-xl border border-border/60 bg-muted/70",
        // The focused board shows three columns and used to pin each to 20rem,
        // which left most of a wide screen empty next to the legacy board.
        // "View all" keeps fixed widths because it is meant to scroll.
        fill ? "min-w-80 flex-1" : "w-80 shrink-0",
      )}
    >
      <header className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5">
        {icon}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title}</div>
          {subtitle ? (
            <div className="text-xs text-muted-foreground">{subtitle}</div>
          ) : null}
        </div>
        <div className="ms-auto flex items-center gap-2">
          {onEmailOnly ? (
            // Per-column filter, exactly as the legacy board: the reviewer
            // narrows one day to leads that carry an email without touching
            // the others.
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={Boolean(emailOnly)}
                onChange={(e) => onEmailOnly(e.target.checked)}
              />
              email only
            </label>
          ) : null}
          <span
            className="rounded bg-card px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
            title={
              total != null && total > leads.length
                ? `Showing ${leads.length} of ${total}`
                : undefined
            }
          >
            {total ?? leads.length}
          </span>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))
          : leads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                onStar={() => onStar(lead)}
                onMarkIrrelevant={() => onMarkIrrelevant(lead)}
                onDial={() => onDial(lead)}
                onOpen={() => onOpen(lead)}
              />
            ))}
        {!isLoading && leads.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            Nothing here
          </p>
        ) : null}
      </div>
    </section>
  );
}

function RouteComponent() {
  // Which lead the detail panel is showing. Clicking a card used to do nothing
  // at all, which made the board look broken next to the legacy app.
  const [openLead, setOpenLead] = useState<Lead | null>(null);

  /**
   * Board layout, persisted so the choice survives a reload — same as the
   * legacy board, and it defaults to the focused view because that is the one
   * VK works from day to day.
   *
   *   workspace → Today | Yesterday | Taken care
   *   all       → every day column plus Reminders
   */
  const [viewMode, setViewMode] = useState<"all" | "workspace">(() => {
    const saved = localStorage.getItem("leads.kanban.viewMode");
    return saved === "all" ? "all" : "workspace";
  });
  const [companiesOnly, setCompaniesOnly] = useState(
    () => localStorage.getItem("leads.kanban.companiesOnly") === "1",
  );
  const [country, setCountry] = useState("");
  // Per-column "email only", keyed by column so each toggles independently.
  const [emailOnly, setEmailOnly] = useState<Record<string, boolean>>({});

  useEffect(() => {
    localStorage.setItem("leads.kanban.viewMode", viewMode);
  }, [viewMode]);
  useEffect(() => {
    localStorage.setItem("leads.kanban.companiesOnly", companiesOnly ? "1" : "0");
  }, [companiesOnly]);

  /*
   * ONE QUERY PER COLUMN.
   *
   * This board used to make a single request for the whole window and split
   * the rows into day buckets in the browser. That cannot work: the API caps a
   * page at 100 rows and a single day routinely carries several hundred leads,
   * so all 100 rows came back belonging to today and every other column
   * rendered "Nothing here" — Yesterday showed 0 next to the legacy board's
   * 452. Nothing errored; the board was simply wrong.
   *
   * Each column now asks for its own slice and reports its own server-side
   * total, which is the number the legacy column headers show.
   */
  const dayColumns = useMemo(() => {
    const todayKey = istDayKey(new Date());
    const todayAnchor = istDayAnchor(todayKey);
    return Array.from({ length: DAY_WINDOW }, (_, i) => {
      const startMs = todayAnchor.getTime() - i * 86_400_000;
      const date = new Date(startMs);
      return {
        key: istDayKey(date),
        title:
          i === 0
            ? "Today"
            : i === 1
              ? "Yesterday"
              : date.toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                }),
        sub: date.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        // Real IST midnight, NOT the anchor. istDayAnchor deliberately returns
        // NOON UTC so that stepping whole days can never cross a boundary by
        // accident — using it as the column bound instead would query
        // noon-to-noon UTC and put 6.5 hours of leads in the wrong column.
        // IST has no DST, so the fixed +05:30 offset is exact.
        // Half-open [from, to): a lead arriving exactly at midnight lands in
        // exactly one column.
        from: new Date(`${istDayKey(date)}T00:00:00+05:30`).toISOString(),
        to: new Date(
          new Date(`${istDayKey(date)}T00:00:00+05:30`).getTime() + 86_400_000,
        ).toISOString(),
      };
    });
  }, []);

  const visibleDays = viewMode === "workspace" ? dayColumns.slice(0, 2) : dayColumns;

  const dayQueries = useQueries({
    queries: visibleDays.map((day) => ({
      // Filters are part of the KEY and part of the REQUEST. They used to be
      // neither: applied in the browser after the fact, over one page, while
      // the header showed the unfiltered total.
      queryKey: [
        "leads",
        "kanban",
        "day",
        day.key,
        Boolean(emailOnly[day.key]),
        companiesOnly,
        country,
      ],
      queryFn: () =>
        getLeadsView({
          view: "active" as const,
          from: day.from,
          to: day.to,
          contacted: "no" as const,
          hasEmail: Boolean(emailOnly[day.key]),
          companiesOnly,
          country: country || undefined,
          limit: 100,
        }),
      refetchInterval: 30_000,
      staleTime: 15_000,
    })),
  });

  const takenCareQuery = useQuery({
    queryKey: ["leads", "kanban", "takenCare", companiesOnly, country],
    // Legacy offers a "Last 7 days" window on this column; same span here.
    queryFn: () =>
      getLeadsView({
        view: "active",
        contacted: "yes",
        days: 7,
        companiesOnly,
        country: country || undefined,
        limit: 100,
      }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const remindersQuery = useQuery({
    queryKey: ["leads", "kanban", "reminders"],
    queryFn: () =>
      getLeadsView({ view: "active", remindersOnly: true, limit: 100 }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const refetch = () => {
    for (const q of dayQueries) q.refetch();
    takenCareQuery.refetch();
    remindersQuery.refetch();
  };

  // Country options come from whatever is on screen, so the dropdown never
  // offers a country that would filter the board down to nothing.
  const allLoaded = useMemo(
    () => [
      ...dayQueries.flatMap((q) => q.data?.items ?? []),
      ...(takenCareQuery.data?.items ?? []),
    ],
    [dayQueries, takenCareQuery.data],
  );

  /** Countries present on the board, with counts, for the filter dropdown. */
  const countryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of allLoaded) {
      const name = l.clientLocation?.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, n]) => ({ name, n }))
      .sort((a, b) => b.n - a.n);
  }, [allLoaded]);

  /*
   * The server applies the filters now, so the rows arriving here are already
   * the answer. This used to re-filter them in the browser, which is how the
   * body and the header count came from different places and disagreed.
   */
  const applyFilters = (list: Lead[]) => list;

  const { dial, ready } = useDialer();

  async function star(lead: Lead) {
    try {
      await setLeadHighlighted(lead.id, !lead.highlightedAt);
      refetch();
    } catch {
      toast.error("Could not update the lead");
    }
  }

  /*
   * One click, no confirm — legacy behaves the same way (KanbanBoard.tsx:966).
   * The point is to clear the board fast; an "are you sure?" on every junk lead
   * would defeat it, and Restore is one click away in the drawer.
   */
  /*
   * Dial from the board. Saves the contact as "Company - Name" first, exactly
   * as the drawer does, so a call BACK from this number arrives labelled
   * instead of looking like an unknown cold call.
   */
  function dialFromCard(lead: Lead) {
    const number = (lead.phone || lead.phoneSecondary || "").trim();
    if (!number) return;
    if (!ready) {
      toast.error("The dialer is still connecting — try again in a moment");
      return;
    }
    const person = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
    const label = [lead.company?.trim(), person].filter(Boolean).join(" - ");
    if (label) {
      void fetch(getApiUrl("dialer/contacts"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: label, phone: number }),
      }).catch(() => undefined);
    }
    dial(number);
    toast.success(`Calling ${label || number}`);
  }

  async function markIrrelevant(lead: Lead) {
    try {
      await setLeadIrrelevant(lead.id, true);
      toast.success("Marked as not relevant");
      refetch();
    } catch {
      toast.error("Could not update the lead");
    }
  }

  return (
    <Layout>
      <PageTitle title="Leads · Kanban" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Leads · Kanban</h1>
        <Link
          to="/leads"
          className="ms-auto text-sm text-muted-foreground underline hover:text-foreground"
        >
          ← Full view
        </Link>
      </header>

      {/* Toolbar, mirroring the legacy board. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-2.5">
        <div
          className="inline-flex shrink-0 rounded-md border border-border p-0.5 text-sm"
          role="group"
          aria-label="Board view"
        >
          {(["all", "workspace"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              aria-pressed={viewMode === mode}
              className={cn(
                "rounded px-3 py-1 transition-colors",
                viewMode === mode
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {mode === "all" ? "View all" : "Workspace"}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={companiesOnly}
            onChange={(e) => setCompaniesOnly(e.target.checked)}
          />
          Companies only
        </label>

        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          aria-label="Filter leads by client country"
          title="Show only leads whose client is in this country"
          className="rounded border border-border bg-background px-2 py-1 text-sm"
        >
          <option value="">All countries</option>
          {country && !countryOptions.some((c) => c.name === country) ? (
            // Keep a stale pick visible so an empty board reads as
            // "United States (0)" rather than a mysterious blank.
            <option value={country}>{country} (0)</option>
          ) : null}
          {countryOptions.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.n})
            </option>
          ))}
        </select>
      </div>

      {/*
        Focused board: Today, Yesterday and Taken care only.
        VK 2026-07-28: "these are so much information... we just need today,
        yesterday and taken care, not even reminders". The Reminders column and
        the older day columns live on the Full view — this screen is for
        working the day's arrivals, not for auditing the backlog.
      */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {visibleDays.map((day, i) => (
          <Column
            key={day.key}
            title={day.title}
            subtitle={day.sub}
            // The server total, not the length of the page we happened to
            // fetch. The legacy header shows the true count for the day.
            total={dayQueries[i]?.data?.total}
            leads={applyFilters(dayQueries[i]?.data?.items ?? [])}
            emailOnly={Boolean(emailOnly[day.key])}
            onEmailOnly={(v) =>
              setEmailOnly((prev) => ({ ...prev, [day.key]: v }))
            }
            onStar={star}
            onMarkIrrelevant={markIrrelevant}
            onDial={dialFromCard}
            onOpen={setOpenLead}
            isLoading={dayQueries[i]?.isLoading ?? true}
            fill={viewMode === "workspace"}
          />
        ))}

        {viewMode === "all" ? (
          <Column
            title="Reminders"
            subtitle="due soon or just sent"
            icon={<Bell className="size-4 text-amber-500" />}
            total={remindersQuery.data?.total}
            leads={applyFilters(remindersQuery.data?.items ?? [])}
            onStar={star}
            onMarkIrrelevant={markIrrelevant}
            onDial={dialFromCard}
            onOpen={setOpenLead}
            isLoading={remindersQuery.isLoading}
          />
        ) : null}

        <Column
          title="Taken care"
          subtitle="contacted"
          icon={<CheckCircle2 className="size-4 text-emerald-500" />}
          total={takenCareQuery.data?.total}
          leads={applyFilters(takenCareQuery.data?.items ?? [])}
          onStar={star}
          onMarkIrrelevant={markIrrelevant}
            onDial={dialFromCard}
          onOpen={setOpenLead}
          isLoading={takenCareQuery.isLoading}
          fill={viewMode === "workspace"}
        />
      </div>

      {openLead ? (
        <LeadDetailPanel
          leadId={openLead.id}
          onClose={() => setOpenLead(null)}
          onSaved={refetch}
        />
      ) : null}
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/leads_/kanban")({
  component: RouteComponent,
});
