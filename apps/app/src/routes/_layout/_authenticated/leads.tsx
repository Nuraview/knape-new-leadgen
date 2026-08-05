/**
 * Leads.
 *
 * The FLOW is NuraView's, deliberately unchanged from
 * apps/web/app/(routes)/leads: the Leads / System Health tabs, the
 * Active|Irrelevant switch, Companies-only, the handled and client-info
 * selects, the Reminders toggle, the live count with its "+N new (24h)" badge,
 * the star toggle on each row, and the drawer that opens on row click.
 *
 * Only the LOOK is new — spacing, type, borders and controls follow the
 * Plane/Kaneo visual language. Rebuilding the flow around Plane's work-item
 * model was the wrong call: the team's muscle memory lives in these filters.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { fetchMyAccess, landingPathFor } from "@/lib/landing-path";
import { Bell, Building2, Inbox, LayoutGrid, Search } from "lucide-react";
import { useMemo, useState } from "react";
import Layout from "@/components/common/layout";
import { LeadDetailPanel } from "@/components/lead/lead-detail-panel";
import { LeadRow, LeadRowSkeleton } from "@/components/lead/lead-row";
import { ScraperHealth } from "@/components/lead/scraper-health";
import PageTitle from "@/components/page-title";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import { type Lead, getLeadsView } from "@/fetchers/lead/get-leads-view";
import { setLeadHighlighted } from "@/fetchers/lead/mutate-lead";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

/**
 * A filter that is ON has to be visible from across the room — the old bar
 * used a raw checkbox and two unstyled native selects, so "companies only" and
 * "reminders" looked identical whether they were applied or not. One accent
 * (the theme's info blue) means on, everywhere on this page.
 */
function FilterChip({
  active,
  onClick,
  icon: Icon,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Bell;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 font-medium text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-info/32 bg-info/10 text-info-foreground"
          : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground dark:bg-input/32",
      )}
    >
      <Icon className="size-3.5" />
      {children}
    </button>
  );
}

/** Day bucket key + label for the sticky group headers. */
function dayBucket(iso: string | null) {
  if (!iso) return { key: "unknown", label: "No date" };
  const d = new Date(iso);
  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const today = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (sameDay(d, today)) return { key, label: "Today" };
  if (sameDay(d, yesterday)) return { key, label: "Yesterday" };
  return {
    key,
    label: d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }),
  };
}

function groupByDay(items: Lead[]) {
  const groups: { key: string; label: string; leads: Lead[] }[] = [];
  for (const lead of items) {
    const { key, label } = dayBucket(lead.extractedAt ?? lead.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.leads.push(lead);
    else groups.push({ key, label, leads: [lead] });
  }
  return groups;
}

function LeadsList() {
  const [view, setView] = useState<"active" | "irrelevant">("active");
  const [companiesOnly, setCompaniesOnly] = useState(false);
  const [highlighted, setHighlighted] = useState<"all" | "yes" | "no">("all");
  const [clientInfo, setClientInfo] = useState<"all" | "rich" | "missing">("all");
  const [remindersOnly, setRemindersOnly] = useState(false);
  const [q, setQ] = useState("");
  // Debounced for the QUERY KEY only — the input stays instant. Typing used to
  // fire a request per keystroke and re-render the whole table under the caret.
  const debouncedQ = useDebouncedValue(q);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: [
      "leads",
      { view, companiesOnly, highlighted, clientInfo, remindersOnly, q: debouncedQ },
    ],
    queryFn: () =>
      getLeadsView({
        view,
        companiesOnly,
        highlighted,
        clientInfo,
        remindersOnly,
        q: debouncedQ || undefined,
        limit: 50,
      }),
    // The legacy list auto-polls every 30s so the count ticks up while the
    // scraper runs; keeping that means nobody has to hit refresh.
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const openLead = data?.items.find((l) => l.id === openId) ?? null;

  async function toggleStar(lead: Lead) {
    try {
      await setLeadHighlighted(lead.id, !lead.highlightedAt);
      refetch();
    } catch {
      toast.error("Could not update the lead");
    }
  }

  // Rows arrive newest-first, so a single pass buckets them into day groups.
  const groups = useMemo(() => groupByDay(data?.items ?? []), [data?.items]);

  const HANDLED_LABELS: Record<string, string> = {
    all: "All",
    no: "Not handled",
    yes: "Handled",
  };
  const CLIENT_INFO_LABELS: Record<string, string> = {
    all: "All leads",
    rich: "Rich client info",
    missing: "Missing client info",
  };

  return (
    /*
     * The list sits on a card, on the page's tinted background. It used to be
     * rows drawn straight onto the page with hairline separators, which is
     * what made the whole view read as one flat grey sheet: nothing was an
     * object, so nothing had an edge.
     */
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-3 pb-4">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        {/* filter bar — same controls, same order as the legacy list */}
        <div className="flex flex-wrap items-center gap-2 border-border border-b bg-card px-3 py-2.5">
          {/* Active | Irrelevant — a real segmented control: the selected half
              is a raised surface, not a black slab that reads as a button. */}
          <div className="inline-flex h-8 shrink-0 items-center rounded-lg bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setView("active")}
              aria-pressed={view === "active"}
              className={cn(
                "h-7 rounded-[7px] px-3 font-medium text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                view === "active"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => setView("irrelevant")}
              aria-pressed={view === "irrelevant"}
              title="Leads marked as not-our-service."
              className={cn(
                "h-7 rounded-[7px] px-3 font-medium text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                view === "irrelevant"
                  ? "bg-destructive/12 text-destructive-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Irrelevant
            </button>
          </div>

          <FilterChip
            active={companiesOnly}
            onClick={() => setCompaniesOnly((v) => !v)}
            icon={Building2}
            title="Only leads that carry a company name"
          >
            Companies only
          </FilterChip>

          <FilterChip
            active={remindersOnly}
            onClick={() => setRemindersOnly((v) => !v)}
            icon={Bell}
            title="Show only leads with a pending reminder"
          >
            Reminders
          </FilterChip>

          <Select
            value={highlighted}
            onValueChange={(v: string | null) =>
              setHighlighted((v ?? "all") as typeof highlighted)
            }
          >
            <SelectTrigger size="sm" className="h-8 w-[132px] text-xs">
              <SelectValue>{(v: string) => HANDLED_LABELS[v]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="no">Not handled</SelectItem>
              <SelectItem value="yes">Handled</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={clientInfo}
            onValueChange={(v: string | null) =>
              setClientInfo((v ?? "all") as typeof clientInfo)
            }
          >
            <SelectTrigger
              size="sm"
              className="h-8 w-[164px] text-xs"
              title="Whether the lead carries logged-in client data (rating, job history)."
            >
              <SelectValue>{(v: string) => CLIENT_INFO_LABELS[v]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All leads</SelectItem>
              <SelectItem value="rich">Rich (client info)</SelectItem>
              <SelectItem value="missing">Missing client info</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative shrink-0">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search leads…"
              title="Search company, title or email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 w-60 ps-8 text-xs"
            />
          </div>

          {/* The count is the page's one live number, so it gets the only
              tabular figures in the bar and full foreground contrast. */}
          <div className="ms-auto flex shrink-0 items-center gap-2 ps-2">
            <span
              className="relative flex size-2"
              title="Auto-refreshing every 30 seconds"
            >
              <span className="absolute inline-flex size-full animate-pulse rounded-full bg-emerald-500/50" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs">
              {isLoading ? (
                <span className="text-muted-foreground">Loading…</span>
              ) : (
                <>
                  <span className="font-semibold text-foreground tabular-nums">
                    {(data?.total ?? 0).toLocaleString()}
                  </span>{" "}
                  <span className="text-muted-foreground">leads</span>
                </>
              )}
            </span>
            {!isLoading && (data?.addedRecently ?? 0) > 0 ? (
              <span className="rounded-md border border-emerald-500/24 bg-emerald-500/12 px-1.5 py-0.5 font-medium text-[11px] text-emerald-700 tabular-nums dark:text-emerald-300">
                +{data?.addedRecently} in 24h
              </span>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && (
            <div className="animate-pulse divide-y divide-border/50">
              {Array.from({ length: 12 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
                <LeadRowSkeleton key={i} />
              ))}
            </div>
          )}

          {/* Day groups. 50 rows of "Jul 29, 07:12 PM" in the right gutter is
              not a timeline anyone reads; a sticky day header is. */}
          {groups.map((group) => (
            <div key={group.key}>
              <div className="sticky top-0 z-10 flex items-center gap-2 border-border/60 border-b bg-card/85 px-4 py-1.5 backdrop-blur-sm">
                <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.08em]">
                  {group.label}
                </span>
                <span className="text-[11px] text-muted-foreground/60 tabular-nums">
                  {group.leads.length}
                </span>
              </div>

              <div className="divide-y divide-border/50">
                {group.leads.map((lead) => (
                  <LeadRow
                    key={lead.id}
                    lead={lead}
                    selected={openId === lead.id}
                    onOpen={() => setOpenId(lead.id)}
                    onToggleStar={() => toggleStar(lead)}
                  />
                ))}
              </div>
            </div>
          ))}

          {!isLoading && data?.items.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
              <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Inbox className="size-5" />
              </span>
              <p className="font-medium text-foreground text-sm">
                No leads match these filters
              </p>
              <p className="max-w-xs text-muted-foreground text-xs">
                Clear the search box, or switch the handled and client-info
                filters back to their "All" setting.
              </p>
            </div>
          )}
        </div>
      </section>

      {openLead ? (
        // Same panel the kanban opens, so a row and a card behave identically.
        // This replaced a five-row read-only summary that could not edit
        // anything the legacy drawer could.
        <LeadDetailPanel
          leadId={openLead.id}
          onClose={() => setOpenId(null)}
          onSaved={() => refetch()}
        />
      ) : null}
    </div>
  );
}

function RouteComponent() {
  const { tab } = Route.useSearch();
  return (
    <Layout>
      <PageTitle title="Leads" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-border border-b px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="font-heading font-semibold text-xl tracking-[-0.015em]">
          Leads
        </h1>
        {/* An underlined-text link was the only affordance out to the board.
            It now reads as the control it is. */}
        <Link
          to="/leads/kanban"
          className="ms-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 font-medium text-muted-foreground text-xs outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:bg-input/32"
        >
          <LayoutGrid className="size-3.5" />
          Kanban
        </Link>
      </header>

      {/*
        `key` forces a remount when ?tab changes. defaultValue alone is read
        once, so navigating to ?tab=health from a page already showing Leads
        would change the URL and nothing else.
      */}
      <Tabs
        key={tab}
        defaultValue={tab}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="mx-5 mt-3 w-fit">
          <TabsTab value="leads">Leads</TabsTab>
          <TabsTab value="health">System Health</TabsTab>
        </TabsList>

        <TabsPanel value="leads" className="flex min-h-0 flex-1 flex-col">
          <LeadsList />
        </TabsPanel>

        <TabsPanel value="health" className="overflow-y-auto p-5">
          <ScraperHealth />
        </TabsPanel>
      </Tabs>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/leads")({
  /*
   * ?tab=health deep-links to System Health. The lead-flow alert points here,
   * and an alert whose link drops you on the default tab makes the reader hunt
   * for the thing you just told them was broken.
   */
  validateSearch: (raw: Record<string, unknown>) => ({
    tab: raw.tab === "health" ? ("health" as const) : ("leads" as const),
  }),
  // The full leads list is `full` CRM only. A kanban-only account that types
  // this URL is sent to the board rather than shown an error — the server
  // refuses the extra endpoints this page calls either way.
  beforeLoad: async () => {
    const access = await fetchMyAccess().catch(() => null);
    if (access?.crmLevel !== "full") {
      throw redirect({ to: landingPathFor(access ?? { crmLevel: "none" }) });
    }
  },
  component: RouteComponent,
});
