/**
 * System Health — is lead generation actually alive?
 *
 * Ported from apps/web/app/(routes)/leads/components/ScraperHealth.tsx. This is
 * the panel the team opens when leads stop appearing, so the signals it shows
 * and the thresholds it colours them at are carried over rather than redesigned.
 *
 * Polling is adaptive, as it was before: 5s while a scrape is running, 30s
 * otherwise. The endpoint is cached server-side for 10s and shared across
 * viewers, so a fast poll here is cheap.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Cookie,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { getApiUrl } from "@/fetchers/get-api-url";
import { cn } from "@/lib/cn";

type Heartbeat = {
  updated_at: string | null;
  cookies_count: number | null;
  cookies_present: boolean | null;
  cookies_min_expiry: string | null;
  cookies_hard_expired: boolean | null;
  cookies_working: boolean | null;
  cookies_signal: string | null;
  cookies_client_info_rate: number | null;
  scraper_healthy: boolean | null;
  scraper_version: string | null;
  gemini_enabled: boolean | null;
  keywords: string[] | null;
  current_keyword: string | null;
  last_error: string | null;
};

type Run = {
  id: number | string;
  query: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  jobs_expected?: number | null;
  jobs_found?: number | null;
  jobs_inserted?: number | null;
  jobs_updated?: number | null;
  error?: string | null;
};

type Health = {
  heartbeat: Heartbeat | null;
  running: Run[];
  recent: Run[];
  aggregates_24h: {
    completed_24h: number;
    failed_24h: number;
    jobs_found_24h: number;
    jobs_inserted_24h: number;
    jobs_updated_24h: number;
  };
  aggregates_recent_30m: { completed_30m: number; failed_30m: number };
  lead_flow: { last_extracted_at: string | null; inserted_30m: number };
  per_keyword: Run[];
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "unknown";
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "good" | "bad" | "warn";
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
          tone === "bad" && "text-rose-600 dark:text-rose-400",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

function statusTone(status: string): string {
  if (status === "completed") return "text-emerald-600 dark:text-emerald-400";
  if (status === "failed") return "text-rose-600 dark:text-rose-400";
  if (status === "running") return "text-blue-600 dark:text-blue-400";
  return "text-muted-foreground";
}

export function ScraperHealth() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["scraper", "health"],
    queryFn: async (): Promise<Health> => {
      const response = await fetch(getApiUrl("scraper/health"), {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load scraper health");
      return response.json();
    },
    // Fast while a scrape is in flight, slow otherwise. The endpoint is cached
    // for 10s server-side, so the fast poll costs almost nothing.
    refetchInterval: (query) =>
      (query.state.data?.running?.length ?? 0) > 0 ? 5_000 : 30_000,
  });

  const cookies = useQuery({
    queryKey: ["scraper", "cookies"],
    queryFn: async (): Promise<{
      uploaded_at: string | null;
      count: number;
    }> => {
      const response = await fetch(getApiUrl("scraper/cookies"), {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to load cookie status");
      return response.json();
    },
    staleTime: 30_000,
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("That file is not valid JSON");
      }
      const response = await fetch(getApiUrl("scraper/cookies"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json() as Promise<{ count: number }>;
    },
    onSuccess: (result) => {
      toast.success(`Uploaded ${result.count} cookies`);
      queryClient.invalidateQueries({ queryKey: ["scraper", "cookies"] });
      queryClient.invalidateQueries({ queryKey: ["scraper", "health"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Cookie upload failed"),
  });

  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground">Loading health…</p>;
  }

  const hb = data.heartbeat;
  const running = data.running[0];
  const agg = data.aggregates_24h;
  const total24 = agg.completed_24h + agg.failed_24h;
  const successRate = total24 ? Math.round((agg.completed_24h / total24) * 100) : null;

  // The heartbeat is written every cycle. Nothing for 15 minutes means the
  // container is down, not that a scrape is slow.
  const heartbeatStale =
    !hb?.updated_at || Date.now() - new Date(hb.updated_at).getTime() > 15 * 60_000;

  const signal = hb?.cookies_signal ?? "no-data";
  const cookiesBad = signal === "expired" || hb?.cookies_hard_expired === true;
  const cookiesWarn = signal === "degraded" || signal === "no-info";

  return (
    <div className="space-y-5">
      {heartbeatStale ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-500" />
          <div>
            <div className="font-medium">Scraper container looks down</div>
            <div className="text-muted-foreground">
              No heartbeat since {ago(hb?.updated_at ?? null)}. Leads are not
              being collected.
            </div>
          </div>
        </div>
      ) : null}

      {running ? (
        <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm">
          <Loader2 className="size-4 animate-spin text-blue-500" />
          <span>
            Scraping now — <span className="font-medium">{running.query}</span>{" "}
            <span className="text-muted-foreground">
              (started {ago(running.started_at)})
            </span>
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Heartbeat"
          value={ago(hb?.updated_at ?? null)}
          tone={heartbeatStale ? "bad" : "good"}
          hint={hb?.scraper_version ? `v${hb.scraper_version}` : undefined}
        />
        <Stat
          label="Success rate (24h)"
          value={successRate === null ? "—" : `${successRate}%`}
          tone={
            successRate === null
              ? undefined
              : successRate >= 80
                ? "good"
                : successRate >= 50
                  ? "warn"
                  : "bad"
          }
          hint={`${agg.completed_24h} ok / ${agg.failed_24h} failed`}
        />
        <Stat
          label="Leads in (30m)"
          value={data.lead_flow.inserted_30m}
          tone={data.lead_flow.inserted_30m > 0 ? "good" : "warn"}
          hint={`last ${ago(data.lead_flow.last_extracted_at)}`}
        />
        <Stat
          label="Jobs found (24h)"
          value={agg.jobs_found_24h}
          hint={`${agg.jobs_inserted_24h} new · ${agg.jobs_updated_24h} updated`}
        />
      </div>

      {/* Upwork session — the single most common cause of a silent stall. */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Cookie
              className={cn(
                "size-4",
                cookiesBad
                  ? "text-rose-500"
                  : cookiesWarn
                    ? "text-amber-500"
                    : "text-emerald-500",
              )}
            />
            <div>
              <div className="text-sm font-medium">
                Upwork session:{" "}
                <span
                  className={cn(
                    cookiesBad
                      ? "text-rose-600 dark:text-rose-400"
                      : cookiesWarn
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {signal}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {cookies.data?.count ?? hb?.cookies_count ?? 0} cookies ·
                uploaded {ago(cookies.data?.uploaded_at ?? null)}
                {hb?.cookies_client_info_rate != null
                  ? ` · client-info ${Math.round(hb.cookies_client_info_rate * 100)}%`
                  : ""}
              </div>
            </div>
          </div>

          <div>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                upload.mutate(file, { onSettled: () => setUploading(false) });
                e.target.value = "";
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={uploading || upload.isPending}
              onClick={() => fileRef.current?.click()}
            >
              {uploading || upload.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              Upload cookies.json
            </Button>
          </div>
        </div>

        {hb?.last_error ? (
          <p className="mt-3 rounded border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            Last error: {hb.last_error}
          </p>
        ) : null}
      </div>

      {/* Keyword rotation — which searches are producing and which are stuck. */}
      {data.per_keyword.length > 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-2.5 text-sm font-medium">
            Keyword rotation ({data.per_keyword.length})
          </div>
          <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.per_keyword.map((k) => (
              <div
                key={k.query}
                className="flex items-start gap-2 rounded border border-border/60 p-2"
                title={k.error ?? undefined}
              >
                {k.status === "completed" ? (
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                ) : k.status === "failed" ? (
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-500" />
                ) : (
                  <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{k.query}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {ago(k.started_at)}
                    {k.jobs_found != null ? ` · ${k.jobs_found} found` : ""}
                    {k.jobs_inserted ? ` · ${k.jobs_inserted} new` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Recent runs */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-2.5 text-sm font-medium">
          Recent runs
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="px-4 py-2 text-left font-medium">Query</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Found</th>
              <th className="px-4 py-2 text-right font-medium">New</th>
              <th className="px-4 py-2 text-right font-medium">Started</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.map((r) => (
              <tr key={String(r.id)} className="border-t border-border">
                <td className="max-w-0 truncate px-4 py-2" title={r.query}>
                  {r.query}
                </td>
                <td className={cn("px-4 py-2", statusTone(r.status))}>
                  {r.status}
                  {r.error ? (
                    <span
                      className="ml-1 text-muted-foreground"
                      title={r.error}
                    >
                      ⓘ
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.jobs_found ?? "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.jobs_inserted ?? "—"}
                </td>
                <td className="px-4 py-2 text-right text-muted-foreground">
                  {ago(r.started_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ScraperHealth;
