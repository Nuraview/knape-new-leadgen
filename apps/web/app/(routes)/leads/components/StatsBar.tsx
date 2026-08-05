"use client";

import useSWR from "swr";

type Stats = {
  total: number;
  withCompany: number;
  highlighted: number;
  pendingReminders: number;
  fromUpwork: number;
  latestExtractedAt: string | null;
  leadsInLast15min: number;
  leadsInLastHour: number;
};

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => r.json());

function relTime(iso: string | null): string {
  if (!iso) return "no data yet";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function StatsBar() {
  // 30s is plenty for headline counts — ingestion is minute-scale, and a
  // 10s interval here was a 9-FILTER aggregate over crm_Leads keeping Neon
  // awake. revalidateOnFocus still refreshes the instant you look.
  const { data, isLoading } = useSWR<Stats>("/api/leads/stats", fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  if (isLoading && !data) {
    return (
      <div className="text-xs text-muted-foreground mb-4">Loading stats…</div>
    );
  }
  if (!data) return null;

  const fresh15 = data.leadsInLast15min;
  // If we have data in the last 15 min, pipeline is actively healthy.
  // Otherwise show when the newest lead landed so user knows the state.
  const pipelineLabel = fresh15 > 0 ? "active" : "idle";
  const pipelineColor =
    fresh15 > 0 ? "bg-green-500" : data.total > 0 ? "bg-yellow-500" : "bg-zinc-400";

  return (
    <div className="mb-4 rounded-lg border bg-muted/30 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${pipelineColor} ${
            fresh15 > 0 ? "animate-pulse" : ""
          }`}
          aria-hidden
        />
        <span className="font-medium">Pipeline</span>
        <span className="text-muted-foreground">{pipelineLabel}</span>
      </div>

      <Metric label="Total" value={data.total} />
      <Metric label="With company" value={data.withCompany} />
      <Metric
        label="From Upwork"
        value={data.fromUpwork}
        highlight={data.fromUpwork > 0}
      />
      <Metric
        label="Handled"
        value={data.highlighted}
        muted={data.highlighted === 0}
      />
      <Metric
        label="Reminders pending"
        value={data.pendingReminders}
        muted={data.pendingReminders === 0}
      />

      <div className="ml-auto text-xs text-muted-foreground">
        <span title={data.latestExtractedAt ?? ""}>
          Newest lead: <strong>{relTime(data.latestExtractedAt)}</strong>
        </span>
        <span className="mx-2">·</span>
        <span>Last 15m: {data.leadsInLast15min}</span>
        <span className="mx-2">·</span>
        <span>Last 1h: {data.leadsInLastHour}</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  highlight,
  muted,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline gap-1 ${muted ? "opacity-60" : ""}`}
      title={label}
    >
      <span className={`tabular-nums font-medium ${highlight ? "text-green-600 dark:text-green-400" : ""}`}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
