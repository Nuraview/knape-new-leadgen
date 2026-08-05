/**
 * Lead-flow watchdog — shout when the leads stop.
 *
 * WHY THIS EXISTS. On 2026-07-29 Upwork began returning "0 jobs found" for
 * every query and later 403'd outright. Lead ingestion stopped at 13:46 UTC and
 * NOTHING SAID A WORD. The owner discovered it two hours later by looking at the
 * Leads page and noticing the timestamps had stopped moving.
 *
 * Everything needed to catch it already existed: the System Health tab shows
 * last_extracted_at, the cookie expiry, and whether cookies still work. It was
 * all sitting in a tab nobody opens. A dashboard you have to remember to check
 * is not monitoring — it is a monitoring-shaped object.
 *
 * Lead generation IS the business. Silence here costs a day of pipeline, so
 * this errs towards telling someone.
 *
 * WHAT IT SAYS. Not "scraper down". The realistic causes have different fixes
 * and the message names the likely one, because the person reading it on their
 * phone can act on "re-upload the cookies" and cannot act on "an error
 * occurred". Expired cookies are the most common and the most fixable, so when
 * the cookie signals point that way the alert leads with it.
 *
 * HOW IT REACHES ANYONE. WhatsApp is the normal channel and is itself down
 * (session lost 13 July), so this also sends a WEB PUSH, which reaches a
 * browser with no tab open. Both are queued: the WhatsApp copy will deliver
 * whenever the bridge is re-paired, and this alert is deliberately exempt from
 * the outbox TTL because "leads stopped" stays true until someone fixes it.
 */
import { sql } from "drizzle-orm";
import crmDb from "../database/crm";
import { getHealth } from "../scraper";
import { notifyOwners } from "./notify-owners";
import { rowsOf } from "../database/rows";

/** Quiet for this long and something is wrong. */
const WARN_AFTER_MINUTES = 75;

/**
 * Don't repeat more often than this. Long enough not to nag, short enough that
 * an outage starting overnight is still on someone's phone in the morning.
 */
const REALERT_AFTER_HOURS = 4;

/** Marks our own rows in the outbox so the cooldown can find them. */
const ALERT_TAG = "[lead-flow]";

/**
 * Cookies get their OWN alarm, separate from the lead-flow one.
 *
 * Waiting for leads to dry up means finding out 75 minutes after the damage
 * starts. Expired cookies are knowable the moment they expire, they are the
 * most common cause of the scraper going quiet, and re-uploading them is a
 * two-minute job. So this fires on the cookie state itself — before the
 * pipeline stops rather than after.
 */
const COOKIE_TAG = "[cookies]";

/** Warn this far ahead of expiry, so it can be fixed before it bites. */
const COOKIE_EXPIRY_WARN_HOURS = 12;

function ownerJid(): string | null {
  const raw = process.env.WHATSAPP_RECIPIENTS ?? "";
  const first = raw.split(",")[0] ?? "";
  const number = first.slice(first.indexOf(":") + 1).trim();
  if (!number) return null;
  return `${number.replace(/^\+/, "")}@s.whatsapp.net`;
}

/**
 * Name the most likely cause from the signals we already collect.
 *
 * Ordered by what the reader can actually do about it. Cookies first: they
 * expire on a schedule, re-uploading them is a two-minute job anyone can do
 * from the System Health tab, and it is the failure we have hit most.
 */
function diagnose(heartbeat: {
  cookies_present?: boolean | null;
  cookies_hard_expired?: boolean | null;
  cookies_working?: boolean | null;
  cookies_min_expiry?: string | null;
  last_error?: string | null;
}): string {
  if (heartbeat.cookies_present === false) {
    return "The Upwork cookies are MISSING. Upload them in Leads → System Health.";
  }
  if (heartbeat.cookies_hard_expired) {
    return "The Upwork cookies have EXPIRED. Log in to Upwork, export cookies, and upload them in Leads → System Health.";
  }
  if (heartbeat.cookies_working === false) {
    return "The Upwork cookies are being REJECTED. Re-export them from a fresh Upwork login and upload in Leads → System Health.";
  }
  if (heartbeat.last_error) {
    return `Scraper's last error: ${String(heartbeat.last_error).slice(0, 180)}`;
  }
  // Cookies look fine and nothing threw: Upwork is serving empty results or
  // 403s to our egress IP. Say so plainly rather than inventing a cause —
  // pointing at cookies that are actually valid wastes the reader's time.
  return "Cookies look valid, so Upwork is most likely blocking our IP or returning empty results. Re-uploading fresh cookies is still the first thing to try.";
}

/** Has an alert with this tag already gone out recently? */
async function alertedRecently(tag: string): Promise<boolean> {
  const result = await crmDb.execute(sql`
    SELECT 1
      FROM whatsapp_outbox
     WHERE body LIKE ${`${tag}%`}
       AND created_at > now() - (${REALERT_AFTER_HOURS} || ' hours')::interval
     LIMIT 1
  `);
  return rowsOf(result).length > 0;
}

/** Queue to WhatsApp and push in one go. Neither failure blocks the other. */
async function raise(title: string, body: string) {
  const jid = ownerJid();
  if (jid) {
    try {
      await crmDb.execute(
        sql`INSERT INTO whatsapp_outbox (to_jid, body) VALUES (${jid}, ${body})`,
      );
    } catch (error) {
      console.error("[watchdog] WhatsApp alert failed:", error);
    }
  }
  /*
   * The channel that still works while the WhatsApp bridge is unpaired.
   * Admins only — an employee cannot re-upload scraper cookies, and alerting
   * them about it is how a notification channel earns itself a mute.
   */
  await notifyOwners({
    title,
    body: body.split("\n")[0] ?? title,
    url: "/leads?tab=health",
    tag: "lead-flow",
  });
}

/**
 * The cookie alarm. Fires on cookie state alone — expired, rejected, missing,
 * or about to expire — without waiting for the pipeline to go quiet first.
 */
async function checkCookies(heartbeat: Parameters<typeof diagnose>[0]) {
  let problem: string | null = null;

  if (heartbeat.cookies_present === false) {
    problem = "The Upwork cookies are MISSING.";
  } else if (heartbeat.cookies_hard_expired) {
    problem = "The Upwork cookies have EXPIRED.";
  } else if (heartbeat.cookies_working === false) {
    problem = "Upwork is REJECTING our cookies.";
  } else if (heartbeat.cookies_min_expiry) {
    const hoursLeft =
      (new Date(heartbeat.cookies_min_expiry).getTime() - Date.now()) / 3_600_000;
    if (hoursLeft > 0 && hoursLeft < COOKIE_EXPIRY_WARN_HOURS) {
      problem = `The Upwork cookies expire in about ${Math.round(hoursLeft)} hours.`;
    }
  }

  if (!problem) return;
  if (await alertedRecently(COOKIE_TAG)) return;

  const body =
    `${COOKIE_TAG} 🍪 ACTION NEEDED — ${problem}\n\n` +
    "Lead scraping stops without them. Fix: log in to Upwork in your browser, " +
    "export the cookies, and upload them in the CRM under Leads → System Health.";

  await raise(`🍪 Upwork cookies need updating`, body);
  console.warn(`[cookies] ALERT — ${problem}`);
}

export async function checkLeadFlow() {
  const health = await getHealth();
  const hb = (health.heartbeat ?? {}) as Parameters<typeof diagnose>[0];

  // Independent of everything below: cookies are alarming on their own terms.
  await checkCookies(hb);

  const lastIso = health.lead_flow?.last_extracted_at ?? null;
  // No leads at all in 24h is itself the alarm — treat a missing timestamp as
  // maximally stale rather than skipping the check, which would make the
  // watchdog silent in exactly the worst case.
  const gapMinutes = lastIso
    ? Math.floor((Date.now() - new Date(lastIso).getTime()) / 60_000)
    : Number.POSITIVE_INFINITY;

  if (gapMinutes < WARN_AFTER_MINUTES) return;
  if (await alertedRecently(ALERT_TAG)) return;

  const cause = diagnose(hb);
  const howLong = Number.isFinite(gapMinutes)
    ? `${Math.floor(gapMinutes / 60)}h ${gapMinutes % 60}m`
    : "over 24 hours";

  const body =
    `${ALERT_TAG} 🚨 NO NEW LEADS FOR ${howLong}.\n\n` +
    `${cause}\n\n` +
    `Last lead: ${lastIso ? new Date(lastIso).toUTCString() : "none in 24h"}\n` +
    `Scraped in the last 30 min: ${health.lead_flow?.inserted_30m ?? 0}`;

  await raise(`🚨 No new leads for ${howLong}`, body);

  console.warn(`[lead-flow] ALERT — no leads for ${howLong}. ${cause}`);
}

export default checkLeadFlow;
