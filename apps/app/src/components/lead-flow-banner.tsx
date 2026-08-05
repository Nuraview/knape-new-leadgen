/**
 * "The leads have stopped" — said out loud, on every page.
 *
 * On 2026-07-29 lead ingestion stopped at 13:46 and nobody knew for two hours.
 * The System Health tab had every signal needed to catch it; it is a tab, and
 * nobody opens a tab to check whether something they expect to work is working.
 *
 * So this is deliberately NOT another panel. It sits above the app, in red, on
 * whatever page you are already looking at, and it names the fix rather than
 * the symptom — because the fix is usually "re-upload the Upwork cookies" and
 * the person who can do that should not have to go and find out.
 *
 * Admins only. An employee working leads can do nothing about expired scraper
 * cookies, and a permanent red bar you cannot act on is one people learn to
 * ignore — including on the day it means something new.
 */
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { getApiUrl } from "@/fetchers/get-api-url";
import { useMyAccess } from "@/hooks/queries/use-my-access";
import useGetConfig from "@/hooks/queries/config/use-get-config";

/** Matches the server watchdog, so the bar and the WhatsApp alert agree. */
const WARN_AFTER_MINUTES = 75;

type Health = {
  heartbeat: {
    cookies_present?: boolean | null;
    cookies_hard_expired?: boolean | null;
    cookies_working?: boolean | null;
  } | null;
  lead_flow: { last_extracted_at: string | null; inserted_30m: number } | null;
};

function advice(h: Health["heartbeat"]): string {
  if (h?.cookies_present === false) return "The Upwork cookies are missing.";
  if (h?.cookies_hard_expired) return "The Upwork cookies have expired.";
  if (h?.cookies_working === false) return "Upwork is rejecting our cookies.";
  return "Upwork may be blocking us or returning no results.";
}

export function LeadFlowBanner() {
  const { data: access } = useMyAccess();
  const { data: config } = useGetConfig();
  const [dismissed, setDismissed] = useState(false);

  /*
   * NuraView-only. This watches the UPWORK scraper — cookie expiry, Upwork
   * blocking us, the ingestion gap — and none of that exists on an instance
   * whose leads come from the lead-gen cockpit (NCES + USAspending + Apify).
   * There, /api/scraper/health describes a scraper the client does not run,
   * and a permanent red bar telling Dan to "re-upload the Upwork cookies" is
   * both meaningless and alarming on his own CRM.
   */
  const usesUpworkScraper = config?.hasLeadgen !== true;
  const isAdmin = access?.crmLevel === "full" && usesUpworkScraper;

  const { data } = useQuery<Health>({
    queryKey: ["lead-flow-banner"],
    queryFn: async () => {
      const r = await fetch(getApiUrl("scraper/health"), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("health unavailable");
      return r.json();
    },
    enabled: isAdmin,
    // Five minutes. The condition changes on the scale of hours, and this must
    // never become a reason the database stays awake.
    refetchInterval: 5 * 60_000,
    retry: false,
  });

  if (!isAdmin || dismissed || !data) return null;

  const last = data.lead_flow?.last_extracted_at ?? null;
  const gapMinutes = last
    ? Math.floor((Date.now() - new Date(last).getTime()) / 60_000)
    : Number.POSITIVE_INFINITY;

  /*
   * Cookies alarm on their own terms. Waiting for the lead gap means the bar
   * appears 75 minutes after the cause is already knowable — and expired
   * cookies are the one failure the reader can fix in two minutes.
   */
  const cookiesBroken =
    data.heartbeat?.cookies_present === false ||
    data.heartbeat?.cookies_hard_expired === true ||
    data.heartbeat?.cookies_working === false;

  if (gapMinutes < WARN_AFTER_MINUTES && !cookiesBroken) return null;

  const howLong = Number.isFinite(gapMinutes)
    ? `${Math.floor(gapMinutes / 60)}h ${gapMinutes % 60}m`
    : "over 24 hours";

  return (
    <div className="flex items-center gap-3 border-b border-red-600/40 bg-red-600 px-4 py-2 text-sm text-white">
      <AlertTriangle className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <strong>
          {gapMinutes >= WARN_AFTER_MINUTES
            ? `No new leads for ${howLong}.`
            : "Upwork cookies need updating."}
        </strong>{" "}
        {advice(data.heartbeat)}{" "}
        <Link
          to="/leads"
          search={{ tab: "health" }}
          className="underline underline-offset-2 hover:no-underline"
        >
          Open System Health to re-upload cookies
        </Link>
      </span>
      {/*
        Dismissable for this page load only — no localStorage. Someone silencing
        it on Monday must not still be silencing it on Thursday, which is how a
        warning quietly becomes decoration.
      */}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 rounded p-1 hover:bg-white/20"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export default LeadFlowBanner;
