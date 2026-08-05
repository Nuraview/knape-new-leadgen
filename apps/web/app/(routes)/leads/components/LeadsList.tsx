"use client";

import { useMemo, useState, useEffect } from "react";
import useSWR from "swr";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

import { Input } from "@/components/ui/input";
import { formatRelativeAgo, livePostedAgo } from "@/lib/dates/short";
import { resolveCountry } from "@/lib/leads/country";
import { isAllowedStatus, statusColor } from "@/lib/leads/status-colors";
import { CountryFlag } from "./CountryFlag";
import { LeadDrawer } from "./LeadDrawer";

type LeadRow = {
  id: string;
  company: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  email: string | null;
  upworkJobUrl: string | null;
  extractedAt: string | null;
  createdAt: string | null;
  postedAt: string | null;
  // Raw "posted X ago" string straight from the scrape payload — shown as-is.
  postedRaw: string | null;
  highlightedAt: string | null;
  lastContactedAt: string | null;
  reminderAt: string | null;
  reminderSentAt: string | null;
  leadStatusId: string | null;
  statusName: string | null;
  hasClientInfo: boolean | null;
  hasJobHistory: boolean | null;
  irrelevantAt: string | null;
  irrelevantReason: string | null;
  clientLocation: string | null;
  viewedAt: string | null;
  videoLink: string | null;
};

type Status = { id: string; name: string };

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  });

// Friendly "posted 2 hours ago" wording lives in lib/dates/short.ts so the
// list, kanban, and drawer all render it identically.
const relTime = formatRelativeAgo;

// Primary date format for the row — short, no year. Per client ask
// (Apr 2026): "I don't need year — Upwork leads are like milk." Even
// for cross-year leads, the year is irrelevant context — they're
// already 4+ months old and not actionable.
// Example: "23 Apr 22:17"
function absDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function LeadsList({ statuses }: { statuses: Status[] }) {
  const [companiesOnly, setCompaniesOnly] = useState(false);
  const [highlighted, setHighlighted] = useState<"all" | "yes" | "no">("all");
  // "all" = show everything, "rich" = only rows with real client info,
  // "missing" = only the junk rows (useful when debugging a bad session).
  const [clientInfo, setClientInfo] = useState<"all" | "rich" | "missing">("all");
  // Reminders filter — flip on to see only leads with pending follow-ups.
  // Per call: "let me plan my day better by seeing all my reminders".
  const [remindersOnly, setRemindersOnly] = useState(false);
  // Active vs Irrelevant view. Default = active (the working pipeline).
  // The archive view shows everything the reviewer marked as not-our-service
  // so it can be triaged later — and so it can feed AI training.
  const [view, setView] = useState<"active" | "irrelevant">("active");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

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
    if (highlighted === "yes") params.set("highlighted", "1");
    if (highlighted === "no") params.set("highlighted", "0");
    if (clientInfo === "rich") params.set("has_client_info", "1");
    if (clientInfo === "missing") params.set("has_client_info", "0");
    if (remindersOnly) params.set("reminders", "1");
    if (view === "irrelevant") params.set("irrelevant", "1");
    if (q.trim()) params.set("q", q.trim());
    params.set("limit", "200");
    return `/api/leads?${params.toString()}`;
  }, [companiesOnly, highlighted, clientInfo, remindersOnly, view, q]);

  // Multi-user sync — see KanbanBoard. Relaxed cadence to cut Neon egress
  // (Jul 2026); revalidateOnFocus + optimistic local edits keep the acting
  // reviewer's view instant, the interval only affects background sync.
  const { data, mutate, isLoading } = useSWR<{
    items: LeadRow[];
    total?: number | null;
    addedRecently?: number | null;
  }>(
    key,
    fetcher,
    {
      refreshInterval: 20_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    },
  );

  async function toggleHighlight(id: string, current: string | null) {
    // Optimistic flip.
    await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ highlighted: !current }),
    });
    mutate();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {/* View switch — Active (working pipeline) vs Irrelevant (archive).
            Sits first so the reviewer's eye sees "what list am I looking
            at" before any other filter. */}
        <div className="inline-flex rounded border overflow-hidden text-sm">
          <button
            type="button"
            onClick={() => setView("active")}
            className={`px-3 py-1 ${
              view === "active"
                ? "bg-foreground text-background"
                : "bg-transparent hover:bg-muted"
            }`}
          >
            Active
          </button>
          <button
            type="button"
            onClick={() => setView("irrelevant")}
            className={`px-3 py-1 border-l ${
              view === "irrelevant"
                ? "bg-rose-600 text-white"
                : "bg-transparent hover:bg-muted"
            }`}
            title="Leads marked as not-our-service. Used to triage and (later) train the AI."
          >
            Irrelevant
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
        <select
          className="rounded border bg-transparent px-2 py-1 text-sm"
          value={highlighted}
          onChange={(e) => setHighlighted(e.target.value as any)}
        >
          <option value="all">All</option>
          <option value="no">Not handled</option>
          <option value="yes">Handled</option>
        </select>
        <select
          className="rounded border bg-transparent px-2 py-1 text-sm"
          value={clientInfo}
          onChange={(e) => setClientInfo(e.target.value as any)}
          title="Filter by whether the lead carries logged-in client data (rating, job history, etc). Rows missing it mean the session was probably expired at scrape time."
        >
          <option value="all">All leads</option>
          <option value="rich">Rich (client info)</option>
          <option value="missing">Missing client info</option>
        </select>
        <button
          type="button"
          onClick={() => setRemindersOnly((v) => !v)}
          className={`rounded border px-2 py-1 text-sm transition-colors ${
            remindersOnly
              ? "bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300"
              : "bg-transparent hover:bg-muted"
          }`}
          title="Show only leads with a pending reminder"
        >
          🔔 Reminders{remindersOnly ? " (on)" : ""}
        </button>
        <Input
          placeholder="Search company / title / email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
        />
        {/* No manual refresh button — SWR auto-polls every 30s and
            revalidates when the tab regains focus. The count on the right
            ticks up on its own when new leads arrive. */}
        <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-green-500"
            aria-label="auto-refreshing every 30s"
            title="auto-refreshing every 30s"
          />
          <span>
            {isLoading
              ? "Loading…"
              : `${(data?.total ?? data?.items.length ?? 0).toLocaleString()} leads`}
            {!isLoading && (data?.addedRecently ?? 0) > 0 ? (
              <span className="ml-1.5 rounded-full bg-green-500/15 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                +{data!.addedRecently} new (24h)
              </span>
            ) : null}
          </span>
        </div>
      </div>

      <div className="border rounded divide-y">
        {(data?.items ?? []).map((lead) => {
          const primary =
            lead.company ||
            [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() ||
            lead.jobTitle ||
            "Untitled lead";
          // Status moved out of `secondary` — it's now a colored chip so
          // the reviewer's eye doesn't have to read text to know which
          // bucket the lead is in.
          const secondary = [
            lead.email,
            lead.jobTitle && lead.jobTitle !== primary ? lead.jobTitle : null,
          ]
            .filter(Boolean)
            .join(" · ");
          const colors = statusColor(lead.statusName);
          return (
            <div
              key={lead.id}
              className={`flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-muted/50 border-l-4 ${colors.stripe}`}
              onClick={() => handleOpenDrawer(lead.id)}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleHighlight(lead.id, lead.highlightedAt);
                }}
                className="text-xl leading-none"
                aria-label="Toggle highlight"
              >
                {lead.highlightedAt ? "★" : "☆"}
              </button>
              <div className="flex-1 min-w-0">
                <div className="font-medium flex items-center gap-2 min-w-0">
                  {lead.company ? (
                    <span className="truncate">{primary}</span>
                  ) : (
                    // Italic glyphs render with slight overhang past their
                    // metrics box — `truncate` (overflow: hidden) clips it
                    // unless we leave room. pr-1 gives the italic 'r'/'f'
                    // tails breathing room so names like "Zaheer" render
                    // in full.
                    <span className="truncate pr-1 text-muted-foreground italic">
                      {primary}
                    </span>
                  )}
                  {isAllowedStatus(lead.statusName) ? (
                    <span
                      className={`shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded border ${colors.chip}`}
                    >
                      {lead.statusName}
                    </span>
                  ) : null}
                  {lead.viewedAt ? (
                    <span
                      className="shrink-0 text-sm text-muted-foreground"
                      title={`You opened this on ${new Date(lead.viewedAt).toLocaleString()}`}
                      aria-label="You have opened this lead"
                    >
                      👁
                    </span>
                  ) : null}
                  {lead.hasClientInfo === false && !lead.hasJobHistory ? (
                    <span
                      className="shrink-0 px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-medium rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/20"
                      title="No 'About the client' sidebar AND no past-hires history captured. Lead has only the job posting; client signals are absent."
                    >
                      no client info
                    </span>
                  ) : null}
                </div>
                {secondary ? (
                  <div className="truncate text-xs text-muted-foreground">
                    {secondary}
                  </div>
                ) : null}
                {(() => {
                  // SVG flag + canonical name beats raw scraper text —
                  // a column of flags is scannable at a glance where
                  // "USA / United States / USA / ESP" was just noise.
                  // We use <img> from flagcdn.com because emoji flags
                  // don't render on Windows desktop browsers.
                  const c = resolveCountry(lead.clientLocation);
                  if (!c) return null;
                  return (
                    <div
                      className="truncate text-xs text-muted-foreground flex items-center gap-1.5"
                      title={`Client location: ${c.name}`}
                    >
                      <CountryFlag iso2={c.iso2} name={c.name} />
                      <span className="truncate">{c.name}</span>
                    </div>
                  );
                })()}
                {lead.irrelevantAt ? (
                  <div
                    className="truncate text-xs italic text-rose-600 dark:text-rose-400"
                    title={lead.irrelevantReason ?? "marked irrelevant"}
                  >
                    irrelevant{lead.irrelevantReason ? ` — ${lead.irrelevantReason}` : ""}
                  </div>
                ) : null}
                {/* Video outreach: record a short Cap intro for this lead,
                    then paste the share link in the drawer — the email
                    generator embeds it as a GIF thumbnail card. */}
                <div className="mt-1 flex items-center gap-2">
                  <a
                    href={process.env.NEXT_PUBLIC_CAP_URL ?? "https://cap.nuraview.com"}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    title="Record a short video for this lead (opens Cap)"
                  >
                    🎥 Record
                  </a>
                  {lead.videoLink ? (
                    <a
                      href={lead.videoLink}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                      title="This lead has a recorded video — click to watch"
                    >
                      🎬 Video ready
                    </a>
                  ) : null}
                </div>
              </div>
              {lead.reminderAt && !lead.reminderSentAt ? (
                <span title={`Reminder at ${lead.reminderAt}`}>🔔</span>
              ) : null}
              <a
                href={`/leads/${lead.id}`}
                onClick={(e) => e.stopPropagation()}
                title="Open lead page"
                className="shrink-0 text-muted-foreground hover:text-foreground opacity-40 hover:opacity-100 transition-opacity"
                aria-label="Open lead page"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
              </a>
              <div
                className="text-right whitespace-nowrap"
                title={
                  lead.postedAt
                    ? `Posted on Upwork: ${new Date(lead.postedAt).toString()}\nScraped: ${relTime(lead.extractedAt ?? lead.createdAt)}`
                    : `Scraped: ${new Date(lead.extractedAt ?? lead.createdAt ?? "").toString()} — ${relTime(lead.extractedAt ?? lead.createdAt)}`
                }
              >
                {/* Primary = when the CLIENT posted on Upwork. That's the
                    freshness signal reviewers actually care about. Falls
                    back to extracted_at for older rows missing posted_at. */}
                <div className="text-xs tabular-nums">
                  {absDateTime(lead.postedAt ?? lead.extractedAt ?? lead.createdAt)}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {lead.postedRaw ? (
                    <>
                      posted {livePostedAgo(lead.postedRaw, lead.extractedAt)}
                    </>
                  ) : (
                    relTime(lead.extractedAt ?? lead.createdAt)
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!isLoading && (data?.items ?? []).length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No leads yet. Once the scraper POSTs to /api/ingest/upwork, they
            will appear here.
          </div>
        ) : null}
      </div>

      <LeadDrawer
        leadId={openId}
        statuses={statuses}
        onClose={handleCloseDrawer}
        onChanged={() => mutate()}
      />
    </div>
  );
}
