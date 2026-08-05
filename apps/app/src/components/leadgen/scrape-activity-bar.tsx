/**
 * Live scraper state, on the page people actually look at.
 *
 * There was a monitor already — on Live Lead Finder. Nobody goes to Live Lead
 * Finder. The question being asked over and over was "is the scraping active,
 * what is it finding right now", asked from the Leads page, which showed a
 * count and nothing else. A dashboard you have to know to navigate to is not a
 * dashboard; this sits on top of the list itself.
 *
 * Compact by default: one line saying what is happening. Expands to the recent
 * event feed, because "it says running" and "here is the school it just found"
 * are different questions and the second one is what builds any confidence that
 * the first is true.
 *
 * Polls faster while a run is in flight and slowly when idle — the endpoint is
 * a proxied cross-network call and this component is mounted on the busiest
 * page in the app.
 */
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, Radar } from "lucide-react";
import { useState } from "react";
import { leadgen } from "@/fetchers/leadgen/client";
import { humaniseEvent } from "@/lib/leadgen/stage-labels";

type PipelineEvent = {
  ts?: number;
  level?: string;
  message?: string;
  stage?: string;
};

type PipelineStatus = {
  running?: boolean;
  stage?: string | null;
  started_at?: number | null;
  events?: PipelineEvent[];
  schedule?: {
    enabled?: boolean;
    next_run_at?: number | null;
    last_run_at?: number | null;
    enrich_running?: boolean;
  } | null;
  yield?: { today?: number; total?: number; contacts?: number } | null;
};

function ago(ts?: number | null): string {
  if (!ts) return "never";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function until(ts?: number | null): string {
  if (!ts) return "not scheduled";
  const s = Math.floor(ts - Date.now() / 1000);
  if (s <= 0) return "due now";
  if (s < 3600) return `in ${Math.floor(s / 60)}m`;
  return `in ${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const LEVEL_CLASS: Record<string, string> = {
  success: "text-emerald-500",
  warn: "text-amber-500",
  error: "text-red-500",
  credit: "text-amber-500",
};

export function ScrapeActivityBar() {
  const [open, setOpen] = useState(false);

  const { data } = useQuery<PipelineStatus>({
    queryKey: ["leadgen", "pipeline-status"],
    queryFn: () => leadgen.get<PipelineStatus>("/api/pipeline/status"),
    refetchInterval: (q) =>
      (q.state.data as PipelineStatus | undefined)?.running ? 5_000 : 30_000,
    staleTime: 4_000,
  });

  const running = data?.running === true;
  const sched = data?.schedule ?? null;
  const y = data?.yield ?? null;
  const events = data?.events ?? [];
  const latest = events[events.length - 1];
  const enriching = sched?.enrich_running === true;

  return (
    <div
      className={`rounded-lg border ${
        running
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-border bg-card/50"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 p-2.5 text-left text-sm"
      >
        {running ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-emerald-500" />
        ) : (
          <Radar
            className={`size-4 shrink-0 ${
              sched?.enabled ? "text-sky-500" : "text-muted-foreground"
            }`}
          />
        )}

        <span className="font-medium">
          {running
            ? "Scraping now"
            : enriching
              ? "Finding contacts"
              : sched?.enabled
                ? "Scraper on"
                : "Scraper off"}
        </span>

        {/*
          The live line. Without it "running" is a claim; with it you can watch
          it move through USAspending, then NCES, then scoring, then the save.
        */}
        {latest?.message ? (
          <span
            className={`min-w-0 flex-1 truncate text-xs ${
              LEVEL_CLASS[latest.level ?? ""] ?? "text-muted-foreground"
            }`}
          >
            {(() => {
              const h = humaniseEvent(latest);
              return `${h.label ? `${h.label} · ` : ""}${h.text}`;
            })()}
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            {sched?.enabled
              ? `next run ${until(sched.next_run_at)}`
              : "switch it on in Pipeline settings"}
          </span>
        )}

        <span className="ms-auto flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
          <span>
            found today{" "}
            <strong
              className={`tabular-nums ${
                (y?.today ?? 0) > 0 ? "text-emerald-500" : "text-foreground"
              }`}
            >
              {y?.today ?? 0}
            </strong>
          </span>
          <span className="hidden sm:inline">
            contacts{" "}
            <strong className="tabular-nums text-foreground">
              {y?.contacts ?? 0}
            </strong>
          </span>
          <span className="hidden md:inline">last run {ago(sched?.last_run_at)}</span>
          {open ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
      </button>

      {open ? (
        <div className="border-t border-border/60 p-2.5">
          {!events.length ? (
            <p className="text-xs text-muted-foreground">
              No pipeline activity recorded yet.
            </p>
          ) : (
            <ul className="max-h-56 space-y-1 overflow-y-auto font-mono text-[11px]">
              {[...events].reverse().map((e, i) => (
                <li
                  key={`${e.ts ?? i}-${i}`}
                  className={LEVEL_CLASS[e.level ?? ""] ?? "text-muted-foreground"}
                >
                  <span className="opacity-60">
                    {e.ts
                      ? new Date(e.ts * 1000).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : ""}
                  </span>{" "}
                  {(() => {
                    const h = humaniseEvent(e);
                    return `${h.label ? `${h.label} — ` : ""}${h.text}`;
                  })()}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default ScrapeActivityBar;
