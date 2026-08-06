/**
 * Leads — Dan's actual pipeline, from the lead-gen cockpit.
 *
 * The other Leads page in this app reads `crm_Leads`, which is NuraView's
 * Upwork table. On a client instance that table is empty, so the page renders
 * "0 leads" while the real pipeline — 1333 accounts and 1633 contacts sourced
 * from the NCES school universe joined against USAspending grant data — sits in
 * the cockpit, unreachable. This is that pipeline.
 *
 * Ported from the cockpit's Leads view, keeping the parts that carry meaning:
 *
 *   - the ACCOUNTS / PEOPLE toggle, because a school and a named Athletic
 *     Director are two different things to act on.
 *   - the ICP score, which is the whole reason a row is in the list.
 *   - the scrape-date chips (Today / Yesterday / Day before / Full list). VK,
 *     2026-08-03: "Full list should show today, yesterday, should have day
 *     before yesterday." There is no day-view endpoint; the cockpit stamps
 *     every account with `data_batch`, the ISO date of the run that found it,
 *     and the chips are built from the counts at /api/pipeline/batches.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, ExternalLink, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";
import type {
  Account,
  AccountsResponse,
  BatchOption,
  Person,
} from "@/fetchers/leadgen/types";
import { ScrapeActivityBar } from "@/components/leadgen/scrape-activity-bar";
import { LeadsPager } from "@/components/leadgen/leads-pager";
import { Spinner } from "@/components/ui/spinner";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { buildDayChips } from "@/lib/leadgen/day-batches";

/**
 * Leads per page.
 *
 * 500, the same figure as the cockpit's own frontend (its PAGE_SIZE constant),
 * so a page here holds the same rows as a page there and the two are talked
 * about interchangeably.
 */
const PAGE_SIZE = 500;

function scoreTone(score: number | undefined): string {
  const s = score ?? 0;
  if (s >= 8) return "bg-emerald-500/15 text-emerald-500";
  if (s >= 6) return "bg-amber-500/15 text-amber-500";
  return "bg-muted text-muted-foreground";
}

function RouteComponent() {
  const [mode, setMode] = useState<"accounts" | "people">("accounts");
  const [batch, setBatch] = useState("");
  const [q, setQ] = useState("");
  /*
   * Paging is SERVER-side: the cockpit slices and answers
   * { mode, items, total, page, page_size, pages }. This used to cap the render
   * at 60 with a "show more" button over the full 5,889-row response — which
   * fixed the render but still shipped every row, and gave no way to reach row
   * 4,000. See components/leadgen/leads-pager.tsx.
   *
   * `page` here is only what we ASK for. What gets rendered is the page the
   * server says it served, because it clamps an out-of-range request.
   */
  const [page, setPage] = useState(1);
  /** The scrolling region, so a page turn can return to the top of the list. */
  const listRef = useRef<HTMLDivElement>(null);

  const batches = useQuery({
    queryKey: ["leadgen", "batches"],
    queryFn: () =>
      leadgen.get<BatchOption[] | { items: BatchOption[] }>(
        "/api/pipeline/batches",
      ),
    // Batch counts move once per scrape run, not per page view.
    staleTime: 5 * 60_000,
  });

  const list = useQuery({
    // `page` is part of the key: each page is its own request and its own
    // cache entry, so paging back is instant and does not refetch.
    queryKey: ["leadgen", "accounts", mode, batch, q, page],
    queryFn: () =>
      leadgen.get<AccountsResponse>("/api/accounts", {
        mode,
        data_batch: batch,
        q,
        page: String(page),
        page_size: String(PAGE_SIZE),
      }),
    // The list is a proxied cross-network call; refetching it on every
    // remount made switching tabs feel broken.
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const chips = useMemo(() => {
    /*
     * The endpoint answers { items: [...] }, not a bare array.
     *
     * This read it as an array, so the guard below always fell through to []
     * and EVERY chip rendered 0 — including "Full list", next to a header
     * saying 1,333 leads. The counts were never wrong; they were never read.
     */
    const raw = batches.data;
    const rows = Array.isArray(raw) ? raw : (raw?.items ?? []);

    // `new Date()` per render is fine here and deliberate: a tab left open past
    // midnight must relabel, not keep calling yesterday "Today".
    /*
     * "Full list" sums the batch counts rather than making a second
     * /api/summary request — the buckets come from one GROUP BY and are
     * disjoint, so the sum IS the total. Every lead currently sits in the
     * "Unlabeled" bucket because the scraper had never run, which is exactly
     * the 1,333 the header shows.
     */
    return buildDayChips(rows, new Date());
  }, [batches.data]);

  /* One page of rows, already sliced by the cockpit. */
  const items = list.data?.items ?? [];
  const isPeople = list.data?.mode === "people";
  /** Rows across ALL pages — what the header count and the pager report. */
  const total = list.data?.total ?? 0;

  /*
   * Read the envelope, do not recompute it. The server clamps an out-of-range
   * page, so trusting local `page` would draw a pager pointing at page 8 while
   * page 5 is on screen.
   */
  const pageInfo = {
    page: list.data?.page ?? page,
    pageSize: list.data?.page_size ?? PAGE_SIZE,
    total,
    pages: list.data?.pages ?? 1,
  };

  /*
   * `isFetching`, not `isLoading`. placeholderData keeps the previous list on
   * screen while a new mode/batch/search is in flight, so isLoading is false
   * for every fetch after the first — the case the overlay exists for. Delayed,
   * so a cache-warm switch never flashes it.
   */
  const showOverlay = useDelayedLoading(list.isFetching);

  const pager = (
    <LeadsPager
      info={pageInfo}
      onPage={(next) => {
        setPage(next);
        // A page turn that leaves the reader halfway down the previous page
        // reads as a broken jump. The list region is the scroller, not window.
        listRef.current?.scrollTo({ top: 0 });
      }}
      busy={list.isFetching}
      noun={isPeople ? "people" : "companies"}
    />
  );

  return (
    <Layout>
      <PageTitle title="Leads" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Leads</h1>
        <span className="text-sm text-muted-foreground">
          {list.isLoading
            ? ""
            : `${total.toLocaleString()} lead${total === 1 ? "" : "s"}`}
        </span>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          {/* Accounts vs people. */}
          <div className="flex rounded-md border border-border p-0.5">
            {(
              [
                ["accounts", "Companies", Building2],
                ["people", "People", Users],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setPage(1);
                }}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-sm ${
                  mode === value
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Scrape-date chips. */}
          <div className="flex flex-wrap gap-1">
            {chips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => {
                  setBatch(chip.value);
                  setPage(1);
                }}
                className={`rounded-md border px-2.5 py-1 text-sm ${
                  batch === chip.value
                    ? "border-primary bg-primary/10 font-medium text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {chip.label}
                <span className="ms-1.5 tabular-nums opacity-70">
                  {chip.count}
                </span>
              </button>
            ))}
          </div>

          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search leads…"
            className="ms-auto h-9 w-64 rounded-md border border-border bg-background px-3 text-sm"
          />
        </div>

        <div ref={listRef} className="flex-1 overflow-auto p-5">
          {/*
            Live scraper state, above the list.

            There was already a monitor on Live Lead Finder and nobody opens
            Live Lead Finder — "is the scraping active, what is it finding right
            now" was being asked from THIS page, which showed a count and
            nothing else. A dashboard you have to know to navigate to is not a
            dashboard.
          */}
          <div className="mb-4">
            <ScrapeActivityBar />
          </div>

          {/*
            The list region, and the loading overlay that covers it.

            `relative` so the overlay pins to the LIST rather than the viewport:
            the filter bar and the scrape monitor above stay readable and
            clickable while a fetch is in flight, which is the behaviour the
            cockpit's own frontend has (its .leads-list-region /
            .leads-list-overlay pair). pointer-events-none so the overlay never
            swallows a click meant for the rows underneath.
          */}
          <div className="relative min-h-32" aria-busy={list.isFetching}>
            {showOverlay ? (
              <div
                className="pointer-events-none absolute inset-0 z-10 flex items-start justify-center bg-background/80 pt-12 backdrop-blur-[2px]"
                role="status"
                aria-live="polite"
              >
                <div className="flex flex-col items-center gap-3.5 text-center">
                  <Spinner className="size-11 text-primary" />
                  <p className="text-[15px] font-semibold text-muted-foreground">
                    Loading data…
                  </p>
                </div>
              </div>
            ) : null}

            {!list.isLoading && !list.error && items.length ? pager : null}

            {list.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
            ) : list.error ? (
              <p className="text-sm text-red-500">{String(list.error as Error)}</p>
            ) : !items.length ? (
              <p className="text-sm text-muted-foreground">
                No leads match these filters.
              </p>
            ) : isPeople ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      {["Name", "Title", "Email", "Company", "Score"].map((h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(items as Person[]).map((p) => (
                      <tr key={p.id} className="border-t border-border">
                        {/*
                          A person row that cannot reach its school is a dead end:
                          the name, title and address are here, and everything
                          else about the lead is one page away with no route to it.
                        */}
                        <td className="px-3 py-2 font-medium">
                          {p.account_id ? (
                            <Link
                              to="/pipeline/$accountId"
                              params={{ accountId: String(p.account_id) }}
                              className="underline underline-offset-2 hover:text-primary"
                            >
                              {p.person_name || "—"}
                            </Link>
                          ) : (
                            p.person_name || "—"
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {p.job_title || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {p.email ? (
                            <a
                              href={`mailto:${p.email}`}
                              className="underline underline-offset-2"
                            >
                              {p.email}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">
                              no address
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{p.company}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs tabular-nums ${scoreTone(p.score)}`}
                          >
                            {p.score?.toFixed(1) ?? "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="space-y-2">
                {(items as Account[]).map((a) => (
                  /*
                   * Link, not <a href>. A raw href in a router-driven SPA does a
                   * full document load: the whole bundle is re-fetched, every
                   * cached query is thrown away, and the list scroll position
                   * goes with it. Clicking a lead should be instant.
                   */
                  <Link
                    key={a.id}
                    to="/pipeline/$accountId"
                    params={{ accountId: String(a.id) }}
                    className="block rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/50"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{a.company}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs tabular-nums ${scoreTone(a.score)}`}
                      >
                        ICP {a.score?.toFixed(1) ?? "—"}
                      </span>
                      {a.location ? (
                        <span className="text-xs text-muted-foreground">
                          {a.location}
                        </span>
                      ) : null}
                      {a.headcount ? (
                        <span className="text-xs text-muted-foreground">
                          {a.headcount} students
                        </span>
                      ) : null}
                      {/*
                        A button, not a nested anchor. An <a> inside an <a> is
                        invalid HTML and browsers resolve it inconsistently — the
                        card navigation would fire alongside the outward link, so
                        clicking "website" could open the school AND leave the
                        list at the same time.
                      */}
                      {a.website ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const url = a.website?.startsWith("http")
                              ? a.website
                              : `https://${a.website}`;
                            window.open(url, "_blank", "noopener,noreferrer");
                          }}
                          className="ms-auto flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          website <ExternalLink className="size-3" />
                        </button>
                      ) : null}
                    </div>

                    {a.signal_evidence ? (
                      <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                        {a.signal_evidence}
                      </p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                      {a.signal_category ? (
                        <span className="rounded bg-muted px-1.5 py-0.5">
                          {a.signal_category}
                        </span>
                      ) : null}
                      {typeof a.contacts_count === "number" ? (
                        <span>
                          {a.contacts_count} contacts
                          {typeof a.emails_count === "number"
                            ? ` · ${a.emails_count} with email`
                            : ""}
                        </span>
                      ) : null}
                      {a.data_batch ? <span>found {a.data_batch}</span> : null}
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/*
              Pager below the list as well as above it. Reaching the end of 500
              rows and having to scroll all the way back up to turn the page is
              the complaint that "show more" was hiding.
            */}
            {!list.isLoading && !list.error && items.length ? pager : null}
          </div>
        </div>
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/pipeline")({
  component: RouteComponent,
});
