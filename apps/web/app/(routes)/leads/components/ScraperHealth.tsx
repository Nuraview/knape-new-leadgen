"use client";

import useSWR from "swr";

import { CookiesUploadButton } from "./CookiesUploadButton";

type Heartbeat = {
  updated_at: string | null;
  cookies_count: number | null;
  cookies_present: boolean | null;
  cookies_min_expiry: string | null;
  cookies_hard_expired: boolean | null;
  cookies_working: boolean | null;
  cookies_signal:
    | "working"
    | "degraded"
    | "no-info"
    | "expired"
    | "no-data"
    | null;
  cookies_client_info_rate: number | null;
  scraper_healthy: boolean | null;
  scraper_version: string | null;
  gemini_enabled: boolean | null;
  keywords: string[] | null;
  current_keyword: string | null;
  last_error: string | null;
} | null;

type Run = {
  id: string;
  query: string;
  status: "running" | "completed" | "failed" | "skipped";
  started_at: string | null;
  finished_at: string | null;
  jobs_expected: number | null;
  jobs_found: number | null;
  jobs_inserted: number | null;
  jobs_updated: number | null;
  error: string | null;
};

type HealthResponse = {
  heartbeat: Heartbeat;
  running: Run[];
  recent: Run[];
  aggregates_24h: {
    completed_24h: number;
    failed_24h: number;
    jobs_found_24h: number;
    jobs_inserted_24h: number;
    jobs_updated_24h: number;
  };
  per_keyword: Run[];
};

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
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function duration(startIso: string | null, endIso: string | null): string {
  if (!startIso) return "";
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const s = Math.max(0, Math.floor((end - new Date(startIso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function Check({
  ok,
  warn,
  ok_false,
  label,
  detail,
}: {
  ok?: boolean;
  warn?: boolean;
  ok_false?: boolean;
  label: string;
  detail?: string;
}) {
  const isBad = ok_false === true || ok === false;
  const icon = isBad ? "✖" : warn ? "⚠" : ok ? "✓" : "·";
  const color = isBad
    ? "text-red-600 dark:text-red-400"
    : warn
      ? "text-amber-600 dark:text-amber-400"
      : ok
        ? "text-green-600 dark:text-green-400"
        : "text-muted-foreground";
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className={`${color} font-bold w-4 inline-block`} aria-hidden>
        {icon}
      </span>
      <span className="font-medium">{label}</span>
      {detail ? (
        <span className="text-muted-foreground text-xs">{detail}</span>
      ) : null}
    </div>
  );
}

export function ScraperHealth() {
  // /api/scraper/health fires 6-7 scrape_runs/heartbeat queries per call
  // (incl. a ~47ms DISTINCT ON). At a fixed 3s this was the single biggest
  // Neon compute consumer. Poll fast only while a scrape is running; back
  // off hard when idle — health diagnostics don't change second-to-second.
  const { data } = useSWR<HealthResponse>("/api/scraper/health", fetcher, {
    refreshInterval: (latest) =>
      latest?.running && latest.running.length > 0 ? 5000 : 30000,
    revalidateOnFocus: true,
  });

  if (!data) {
    return (
      <div className="mb-4 rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
        Loading scraper health…
      </div>
    );
  }

  const hb = data.heartbeat;
  const running = data.running[0]; // at most one at a time
  const heartbeatStale =
    hb?.updated_at
      ? Date.now() - new Date(hb.updated_at).getTime() > 25 * 60 * 1000 // 25 min (covers a full click-walk cycle ~15-23 min; pusher.py also runs a 60s background heartbeat ticker so this is belt-and-suspenders)
      : true;

  // Did the scraper ever report? If no heartbeat yet, show a gentle waiting state.
  const everReported = hb?.updated_at != null;

  // --- Cookie health.
  // Behavioural signal is authoritative: "does Upwork actually return
  // logged-in pages when this scraper makes a request". If yes, the session
  // is alive regardless of what cookie expiration timestamps claim, because
  // many Upwork cookies refresh on use.
  //
  // Hard-expired is now only informational: it counts AUTH cookies (pusher
  // side filters out tracking cookies like __cf_bm / _upw_ses). We only raise
  // a red alert when BOTH hard AND behavioural agree the session is dead.
  const cookieExpiryMs = hb?.cookies_min_expiry
    ? new Date(hb.cookies_min_expiry).getTime()
    : null;
  const cookieDaysUntilExpiry = cookieExpiryMs
    ? (cookieExpiryMs - Date.now()) / (24 * 60 * 60 * 1000)
    : null;
  const cookiesHardExpired = hb?.cookies_hard_expired === true;
  const cookiesSignal = hb?.cookies_signal;
  // The old 'expired' label is now an alias of 'no-info' — both mean
  // "0% client_info in scrapes" which is now interpreted as Upwork
  // layout change, not dead cookies.
  const cookiesBehaviourExpired =
    cookiesSignal === "expired" || cookiesSignal === "no-info";
  const cookiesDegraded = cookiesSignal === "degraded";
  const cookiesWorking = cookiesSignal === "working";
  // Original "behavioural expired" used to gate the red alert at
  // signal=="no-info" (i.e. <15% of pages render the "About the client"
  // sidebar). That threshold was calibrated for an Upwork era when
  // sidebars were near-universal — current natural baseline is ~10%
  // (Upwork suppresses the sidebar for thin/new-buyer profiles). Result:
  // alert fires forever even with fresh cookies + leads + history all
  // working. We now fire ONLY when the rate is genuinely zero/null AND
  // signal says no-info — the truly-broken state. Everything else
  // (10-15%, intermittent, etc.) is the normal world, not a panic.
  const cookiesExpired =
    cookiesBehaviourExpired &&
    (hb?.cookies_client_info_rate == null ||
      hb?.cookies_client_info_rate === 0);
  const cookiesExpiringSoon =
    !cookiesExpired &&
    !cookiesWorking && // don't warn if scrape is live
    cookieDaysUntilExpiry !== null &&
    cookieDaysUntilExpiry < 2;

  const aggr = data.aggregates_24h;
  const totalRuns = aggr.completed_24h + aggr.failed_24h;
  const successRate =
    totalRuns > 0 ? Math.round((aggr.completed_24h / totalRuns) * 100) : null;

  return (
    <div className="mb-4 rounded-lg border bg-muted/20 overflow-hidden">
      {/* --- HEADER: live status --- */}
      <div className="px-4 py-3 border-b bg-background/50">
        {running ? (
          <div className="flex items-center gap-3">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
            <span className="font-medium">Scraping</span>
            <code className="px-1.5 py-0.5 rounded bg-background border text-xs">
              {running.query}
            </code>
            <span className="text-xs text-muted-foreground">
              elapsed {duration(running.started_at, null)}
              {running.jobs_expected ? ` · up to ${running.jobs_expected} jobs` : ""}
            </span>
          </div>
        ) : !everReported ? (
          <div className="flex items-center gap-3">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-zinc-400" />
            <span className="font-medium">Waiting for first heartbeat…</span>
            <span className="text-xs text-muted-foreground">
              Container just started — first tick in &lt; 60s
            </span>
          </div>
        ) : heartbeatStale ? (
          <div className="flex items-center gap-3">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
            <span className="font-medium">Scraper silent</span>
            <span className="text-xs text-muted-foreground">
              Last heartbeat {relTime(hb!.updated_at)} — check the container
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
            <span className="font-medium">Idle</span>
            <span className="text-xs text-muted-foreground">
              Last heartbeat {relTime(hb!.updated_at)} · next keyword in ~30s
            </span>
          </div>
        )}
      </div>

      {/* --- DIAGNOSTICS --- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 border-b">
        <Check
          ok={hb?.scraper_healthy === true}
          warn={hb == null}
          label="Scraper service"
          detail={
            hb?.scraper_version
              ? `v${hb.scraper_version}`
              : hb == null
                ? "no heartbeat yet"
                : "not healthy"
          }
        />
        <Check
          ok={
            cookiesWorking ||
            (!cookiesExpired &&
              !cookiesExpiringSoon &&
              !cookiesDegraded &&
              hb?.cookies_present === true)
          }
          warn={cookiesExpiringSoon || cookiesDegraded}
          ok_false={cookiesExpired}
          label="Upwork cookies"
          detail={(() => {
            if (!hb) return "unknown";
            const parts: string[] = [];
            if (hb.cookies_count != null) parts.push(`${hb.cookies_count} loaded`);
            // Behavioural comes first — it's the authoritative signal.
            if (hb.cookies_client_info_rate != null) {
              const pct = Math.round(hb.cookies_client_info_rate * 100);
              if (cookiesBehaviourExpired) {
                // Honest copy: state the number, don't editorialise.
                // 10% is Upwork's current natural baseline (thin-buyer
                // profiles), not a broken state.
                parts.push(
                  `${pct}% of jobs had the "About the client" sidebar`,
                );
              } else if (cookiesDegraded) {
                parts.push(`only ${pct}% of jobs had client info`);
              } else if (cookiesWorking) {
                parts.push(`${pct}% of jobs had client info`);
              }
            }
            // Hard expiry only appears if behaviour doesn't contradict it.
            if (cookiesHardExpired && !cookiesWorking) {
              parts.push("auth cookies past expiration");
            } else if (
              cookieDaysUntilExpiry !== null &&
              cookieDaysUntilExpiry < 7 &&
              cookieDaysUntilExpiry >= 0 &&
              !cookiesWorking
            ) {
              parts.push(
                cookieDaysUntilExpiry < 1
                  ? "auth cookies expire in <1d"
                  : `auth cookies expire in ${Math.floor(cookieDaysUntilExpiry)}d`,
              );
            }
            return parts.join(" · ") || "unknown";
          })()}
        />
        <Check
          ok={hb?.gemini_enabled === true}
          warn={hb?.gemini_enabled === false}
          label="Gemini enrichment"
          detail={
            hb?.gemini_enabled === true
              ? "on"
              : hb?.gemini_enabled === false
                ? "disabled — set GEMINI_API_KEY"
                : "unknown"
          }
        />
        <Check
          // Looser thresholds — the scraper genuinely has per-job Cloudflare
          // variance, so 70%+ is healthy. Counted over REAL scrape outcomes
          // only (pusher-restart interruptions are excluded server-side).
          ok={successRate != null && successRate >= 70}
          warn={successRate != null && successRate < 70 && successRate >= 40}
          label="Success rate (24h)"
          detail={
            successRate == null
              ? "no runs yet"
              : `${successRate}% · ${aggr.completed_24h}✓ / ${aggr.failed_24h}✗ (excludes pusher restarts)`
          }
        />
      </div>

      {/* --- LIMITED-SIDEBAR NOTICE ------------------------------------
          This used to say "Upwork session expired — upload fresh cookies
          NOW" in red. That was wrong + alarming: the scraper signal that
          fires this (`cookies_signal: "no-info"`) only means the "About
          the client" sidebar selectors aren't matching most pages — it
          does NOT mean the session is dead. The Nuxt-payload extractor
          is still pulling past-hires history (with feedback + names)
          through cleanly on the same leads. So lead inflow continues,
          just with partial sidebar fields. Honest wording + amber (not
          red) to avoid scaring the reviewer mid-shift. */}
      {cookiesExpired ? (
        <div className="px-4 py-3 border-b bg-amber-500/10 border-l-4 border-l-amber-500">
          <div className="flex items-start gap-3">
            <span className="text-amber-600 dark:text-amber-300 text-lg leading-none">
              ⓘ
            </span>
            <div className="flex-1">
              <div className="font-medium text-amber-700 dark:text-amber-200 text-sm">
                Limited client-sidebar data on recent pages
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Most recent scrapes are missing the "About the client"
                sidebar fields (rating / hires / member-since). Past-hires
                history is still extracting via the Nuxt payload, so new
                leads still have feedback names and past-job titles —
                they're just partial, not empty. Possible causes (in
                order): a session refresh is due (try Update cookies
                below), or Upwork shifted the sidebar markup and our
                selectors need a tune-up. Not a panic — leads keep flowing.
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* --- COOKIE MANAGEMENT --- */}
      <div className="px-4 py-3 border-b flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
          Upwork session
        </span>
        <CookiesUploadButton />
        <span className="text-xs text-muted-foreground">
          Export a fresh cookies.json from the browser (Cookie-Editor extension
          → Export → JSON) and drop it in. The scraper picks up the new file on
          its next tick (≤ 30 s).
        </span>
      </div>

      {/* --- 24h AGGREGATES --- */}
      <div className="px-4 py-3 border-b flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">
          Last 24h
        </span>
        <span>
          <strong className="tabular-nums">{aggr.jobs_found_24h}</strong>{" "}
          <span className="text-muted-foreground text-xs">jobs scraped</span>
        </span>
        <span>
          <strong className="tabular-nums text-green-600 dark:text-green-400">
            {aggr.jobs_inserted_24h}
          </strong>{" "}
          <span className="text-muted-foreground text-xs">new leads</span>
        </span>
        <span>
          <strong className="tabular-nums">{aggr.jobs_updated_24h}</strong>{" "}
          <span className="text-muted-foreground text-xs">re-ingested</span>
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          Filter: a lead is "new" only if Gemini found firstName / lastName /
          companyName
        </span>
      </div>

      {/* --- PER-KEYWORD GRID --- */}
      {hb?.keywords && hb.keywords.length > 0 ? (
        <div className="px-4 py-3 border-b">
          <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2 font-medium">
            Keyword rotation
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {hb.keywords.map((kw) => {
              const row = data.per_keyword.find((r) => r.query === kw);
              const isCurrent = hb.current_keyword === kw;
              const isRunningNow = running?.query === kw;
              const badgeClass = isRunningNow
                ? "bg-green-500/20 text-green-700 dark:text-green-300 border-green-500/30"
                : row?.status === "completed"
                  ? "bg-green-500/10 text-green-700 dark:text-green-300 border-transparent"
                  : row?.status === "failed"
                    ? "bg-red-500/10 text-red-700 dark:text-red-300 border-transparent"
                    : "bg-muted text-muted-foreground border-transparent";
              return (
                <div
                  key={kw}
                  className={`rounded border px-3 py-2 text-sm ${
                    isCurrent ? "ring-2 ring-green-500/50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <code className="text-xs">{kw}</code>
                    <span
                      className={`ml-auto text-[10px] px-1.5 py-0.5 rounded border uppercase font-medium ${badgeClass}`}
                    >
                      {isRunningNow ? "running" : (row?.status ?? "pending")}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {isRunningNow ? (
                      <>elapsed {duration(running!.started_at, null)}</>
                    ) : row ? (
                      row.status === "completed" ? (
                        <>
                          {row.jobs_found ?? 0} found · {row.jobs_inserted ?? 0} new · {row.jobs_updated ?? 0} updated
                          <span className="mx-1">·</span>
                          {relTime(row.started_at)}
                        </>
                      ) : row.status === "failed" ? (
                        <span className="text-red-600 dark:text-red-400">
                          {row.error?.slice(0, 80) ?? "failed"}
                          <span className="mx-1 text-muted-foreground">·</span>
                          {relTime(row.started_at)}
                        </span>
                      ) : (
                        relTime(row.started_at)
                      )
                    ) : (
                      "no runs yet"
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* --- RECENT RUNS LIST --- */}
      <div className="px-4 py-3">
        <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2 font-medium">
          Recent runs
        </div>
        {data.recent.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No completed runs yet.
          </div>
        ) : (
          <div className="space-y-1">
            {data.recent.slice(0, 8).map((r) => {
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
                      ? `${r.jobs_found ?? 0} found · ${r.jobs_inserted ?? 0} new · ${r.jobs_updated ?? 0} updated · ${duration(r.started_at, r.finished_at)}`
                      : r.error
                        ? r.error.slice(0, 120)
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
