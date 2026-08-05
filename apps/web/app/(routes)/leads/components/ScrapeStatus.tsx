"use client";

import useSWR from "swr";

type Run = {
  bucket: "running" | "recent";
  id: string;
  tick_id: string;
  query: string;
  status: "running" | "completed" | "failed" | "skipped";
  started_at: string;
  finished_at: string | null;
  jobs_expected: number | null;
  jobs_found: number | null;
  jobs_inserted: number | null;
  jobs_updated: number | null;
  error: string | null;
};

type Response = { running: Run[]; recent: Run[] };

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => r.json());

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function elapsed(startedIso: string): string {
  const diff = Date.now() - new Date(startedIso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function ScrapeStatus() {
  // Adaptive cadence: poll fast (5s) only while a scrape is actually
  // running — that's the only time the numbers move. When idle, back off
  // to 30s. Fixed 3s polling here pinned Neon compute on 24/7 (the DB
  // never got 5min idle to auto-suspend) for data that changes once a
  // minute at most.
  const { data } = useSWR<Response>("/api/leads/scrape-status", fetcher, {
    refreshInterval: (latest) =>
      latest?.running && latest.running.length > 0 ? 5000 : 30000,
    revalidateOnFocus: true,
  });

  if (!data) {
    return (
      <div className="mb-4 rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        Loading scraper status…
      </div>
    );
  }

  const running = data.running ?? [];
  const recent = data.recent ?? [];

  if (running.length === 0 && recent.length === 0) {
    return (
      <div className="mb-4 rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        Scraper has not reported any runs yet. First tick takes 30–60s after
        container boot. Check back shortly.
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg border bg-muted/20 overflow-hidden">
      {running.length > 0 ? (
        <div className="px-4 py-3 border-b bg-green-500/10">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="font-medium text-sm">
              Scraping now ({running.length} {running.length === 1 ? "query" : "queries"})
            </span>
          </div>
          <div className="space-y-1">
            {running.map((r) => (
              <div key={r.id} className="flex items-center gap-3 text-sm">
                <code className="px-1.5 py-0.5 rounded bg-background border text-xs">
                  {r.query}
                </code>
                <span className="text-muted-foreground">
                  started {elapsed(r.started_at)} ago
                  {r.jobs_expected != null ? ` · up to ${r.jobs_expected} jobs` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="px-4 py-3">
        <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
          Recent scrape runs
        </div>
        {recent.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No completed runs yet.
          </div>
        ) : (
          <div className="space-y-1">
            {recent.slice(0, 8).map((r) => {
              const badge =
                r.status === "completed"
                  ? "bg-green-500/15 text-green-700 dark:text-green-300"
                  : r.status === "failed"
                    ? "bg-red-500/15 text-red-700 dark:text-red-300"
                    : "bg-zinc-500/15 text-zinc-600";
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-3 text-sm"
                  title={r.error ?? undefined}
                >
                  <span
                    className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${badge}`}
                  >
                    {r.status}
                  </span>
                  <code className="px-1.5 py-0.5 rounded bg-background border text-xs">
                    {r.query}
                  </code>
                  <span className="text-muted-foreground text-xs">
                    {r.status === "completed"
                      ? `${r.jobs_found ?? 0} found · ${r.jobs_inserted ?? 0} new · ${r.jobs_updated ?? 0} updated`
                      : r.error
                        ? r.error.slice(0, 80)
                        : ""}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {relTime(r.started_at)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
