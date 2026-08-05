// Shared alert-deriving logic used by the global banner, the toast
// notifier, and the tab dot. Keeping one source of truth prevents the three
// UI surfaces from showing conflicting severities.

export type AlertLevel = "none" | "info" | "warn" | "critical";

export type HealthLite = {
  heartbeat: {
    updated_at: string | null;
    scraper_healthy: boolean | null;
    // "no-info" is the new label replacing "expired" — see pusher comment.
    // We still accept "expired" in the type for older heartbeats that
    // haven't rolled over yet.
    cookies_signal:
      | "working"
      | "degraded"
      | "no-info"
      | "expired"
      | "no-data"
      | null;
    // Behavioural rate (fraction of jobs with the "About the client"
    // sidebar). Used to gate the no-info alert at TRULY zero — at the
    // current ~10% Upwork baseline a non-zero rate is the normal world.
    cookies_client_info_rate?: number | null;
  } | null;
  aggregates_24h: {
    completed_24h: number;
    failed_24h: number;
  };
  // 30-min window — what the banner actually trips on. The 24h numbers stay
  // for the dashboard panel but they're a poor signal for "is the pipeline
  // working RIGHT NOW" — after an outage they linger for hours falsely
  // alarming long after the system has recovered.
  aggregates_recent_30m?: {
    completed_30m: number;
    failed_30m: number;
  };
  // Ground-truth lead inflow — gates the "lead flow compromised" critical
  // alert. If leads are still being inserted, the pipeline is by definition
  // not compromised even when many scrape attempts fail.
  lead_flow?: {
    last_extracted_at: string | null;
    inserted_30m: number;
  };
};

export type Alert = {
  level: AlertLevel;
  reason: string;
  code: string; // stable key so the toaster can dedupe across polls
};

export function deriveScraperAlert(
  data: HealthLite | undefined | null,
): Alert {
  if (!data) return { level: "none", reason: "", code: "none" };
  const hb = data.heartbeat;

  // No heartbeat at all yet — benign; container just booted.
  if (!hb?.updated_at) return { level: "none", reason: "", code: "none" };

  // Heartbeat stale for > 10 min = container dead.
  const ageMs = Date.now() - new Date(hb.updated_at).getTime();
  if (ageMs > 10 * 60 * 1000) {
    return {
      level: "critical",
      reason: "Scraper heartbeat stale (>10 min) — container likely down",
      code: "heartbeat-stale",
    };
  }

  // NOTE: we previously treated `cookies_signal === "expired"` as critical
  // and nagged reviewers to upload fresh cookies. That fired false alarms
  // whenever Upwork changed their page layout and stopped returning the
  // `client_info` block — which happened in late Apr 2026. We now surface
  // that as a warn-level scraper-selector problem instead; if the
  // scraper_healthy heartbeat is true and cookies are loaded, we trust
  // that the session is alive.
  // A heartbeat still on the old "expired" label (from a not-yet-updated
  // pusher) gets downgraded here too so it stops nagging.

  // Banner reflects the LAST 30 MIN of activity, not the rolling 24h.
  // Rationale: a long outage poisons the 24h ratio for hours after recovery
  // — we watched the pipeline yelling "7% success" while it was actively
  // ingesting fresh leads, because thousands of dead-container failures from
  // the prior 41h still dominated the denominator. The 30-min view shows
  // the user what's true RIGHT NOW.
  //
  // Old 24h numbers are still on the System Health dashboard for context,
  // they just don't drive the alarm.
  const recent = data.aggregates_recent_30m;
  if (recent) {
    const total = recent.completed_30m + recent.failed_30m;
    // Need at least 4 samples in the window before alerting — protects
    // against a single bad cycle right after restart from popping the
    // banner. With 6 keywords and ~10s sleep this threshold is reached
    // within a couple minutes of activity.
    if (total >= 4) {
      const rate = recent.completed_30m / total;

      // Ground truth: are leads actually arriving? If yes, "lead flow
      // compromised" is wrong by definition — surface as warn instead so
      // the user knows attempts are flaky without yelling that the
      // pipeline is dead. We'd been crying wolf when ~99% of scrape
      // attempts hit Cloudflare/captcha but the 1% that succeed kept
      // producing a usable stream of leads.
      const lastLeadAt = data.lead_flow?.last_extracted_at;
      const inserted30m = data.lead_flow?.inserted_30m ?? 0;
      const leadsFlowing =
        inserted30m > 0 ||
        (lastLeadAt != null &&
          Date.now() - new Date(lastLeadAt).getTime() < 15 * 60 * 1000);

      if (rate < 0.4) {
        if (leadsFlowing) {
          return {
            level: "warn",
            reason: `Scrape success rate ${Math.round(rate * 100)}% (last 30 min) — many attempts failing but leads still arriving`,
            code: "success-rate-degraded",
          };
        }
        return {
          level: "critical",
          reason: `Scraper success rate ${Math.round(rate * 100)}% (last 30 min) — lead flow compromised`,
          code: "success-rate-critical",
        };
      }
      if (rate < 0.7) {
        return {
          level: "warn",
          reason: `Success rate ${Math.round(rate * 100)}% (last 30 min) — watch for degradation`,
          code: "success-rate-warn",
        };
      }
    }
  }

  if (hb.cookies_signal === "degraded") {
    return {
      level: "warn",
      reason: "Partial session — only some scrapes returning client info",
      code: "cookies-degraded",
    };
  }

  if (
    (hb.cookies_signal === "no-info" || hb.cookies_signal === "expired") &&
    (hb.cookies_client_info_rate == null ||
      hb.cookies_client_info_rate === 0)
  ) {
    // Only fire when truly zero pages render the "About the client"
    // sidebar — the genuinely-broken state. At Upwork's current natural
    // baseline (~10% of pages render it for thin/new-buyer profiles)
    // the toast was firing forever even though our selectors work on
    // pages that DO have the markers (data-qa="client-hires",
    // "client-hours", "Payment method verified", etc. — verified in
    // saved /tmp/scraped_job_page.html snapshots).
    return {
      level: "warn",
      reason:
        "No page is returning client_info — either cookies actually expired or scraper selectors broke. Check cookies first; if still 0%, selectors need updating.",
      code: "client-info-missing",
    };
  }

  if (hb.scraper_healthy === false) {
    return {
      level: "warn",
      reason: "Scraper service reports unhealthy",
      code: "scraper-unhealthy",
    };
  }

  return { level: "none", reason: "", code: "none" };
}
