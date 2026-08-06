/**
 * Pager for the cockpit leads list.
 *
 * Ported from the cockpit's own frontend (knape-leadgen
 * frontend/src/components/leads/LeadsPager.tsx) so the two surfaces count and
 * navigate the same way, restyled to this app's tokens.
 *
 * Paging is SERVER-side, as it is over there: cockpit_api.py `_paginate`,
 * DEFAULT_PAGE_SIZE 500, MAX_PAGE_SIZE 2000, and /api/accounts answers
 * { mode, items, total, page, page_size, pages }. Each page is its own request
 * and its own react-query cache entry, so paging back is instant.
 *
 * That matters beyond the render: this list is 5,889 rows and every request
 * crosses the Vercel function → VPS proxy hop. Slicing in the browser fixed the
 * DOM cost but still shipped the whole table each time.
 *
 * `info.page` must come from the RESPONSE, not from the requested page — the
 * server clamps an out-of-range request to the last real page.
 */
import { cn } from "@/lib/cn";

export type LeadsPageInfo = {
  /** 1-based. */
  page: number;
  pageSize: number;
  total: number;
  pages: number;
};

type LeadsPagerProps = {
  info: LeadsPageInfo;
  onPage: (page: number) => void;
  /** Disabled while a fetch is in flight, so a double-click cannot skip a page. */
  busy?: boolean;
  /** "companies" / "people" — what the counts are counting. */
  noun?: string;
};

/**
 * Page numbers to show: always first and last, plus a window around current.
 * `null` marks an elided run, rendered as an ellipsis.
 */
function pageWindow(current: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | null)[] = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(pages - 1, current + 1);
  if (from > 2) out.push(null);
  for (let p = from; p <= to; p++) out.push(p);
  if (to < pages - 1) out.push(null);
  out.push(pages);
  return out;
}

export function LeadsPager({
  info,
  onPage,
  busy = false,
  noun = "companies",
}: LeadsPagerProps) {
  const { page, pages, pageSize, total } = info;
  if (total === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <nav
      aria-label={`${noun} pagination`}
      className="flex flex-wrap items-center justify-between gap-3 py-2"
    >
      <p className="text-sm text-muted-foreground">
        Showing{" "}
        <strong className="font-medium text-foreground tabular-nums">
          {first.toLocaleString()}–{last.toLocaleString()}
        </strong>{" "}
        of{" "}
        <strong className="font-medium text-foreground tabular-nums">
          {total.toLocaleString()}
        </strong>{" "}
        {noun}
        {pages > 1 ? (
          <span className="opacity-70">
            {" "}
            · page {page} of {pages}
          </span>
        ) : null}
      </p>

      {pages > 1 ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPage(page - 1)}
            disabled={busy || page <= 1}
            aria-label="Previous page"
            className="rounded-md border border-border px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
          >
            ← Prev
          </button>

          <ol className="flex items-center gap-1">
            {pageWindow(page, pages).map((p, i) =>
              p === null ? (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: gaps have no identity beyond position
                  key={`gap-${i}`}
                  aria-hidden
                  className="px-1 text-sm text-muted-foreground"
                >
                  …
                </li>
              ) : (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => onPage(p)}
                    disabled={busy || p === page}
                    aria-current={p === page ? "page" : undefined}
                    aria-label={`Page ${p}`}
                    className={cn(
                      "min-w-8 rounded-md border px-2 py-1 text-sm tabular-nums",
                      p === page
                        ? "border-primary bg-primary/10 font-medium text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {p}
                  </button>
                </li>
              ),
            )}
          </ol>

          <button
            type="button"
            onClick={() => onPage(page + 1)}
            disabled={busy || page >= pages}
            aria-label="Next page"
            className="rounded-md border border-border px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
          >
            Next →
          </button>
        </div>
      ) : null}
    </nav>
  );
}
