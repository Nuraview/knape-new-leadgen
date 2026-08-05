/**
 * Public endpoints whose URLs are ALREADY OUT IN THE WORLD.
 *
 * Ported from apps/web/app/api/{reminders/stop,marketing/track/*,videos/embed-html}.
 *
 * These are not "public" as a convenience — they are public because the URL is
 * sitting in an email in somebody's inbox or in a WhatsApp message on somebody's
 * phone, sent weeks ago and unchangeable. They must keep their EXACT paths
 * forever, and they must be mounted before the session middleware because the
 * person clicking them is a prospect, not a logged-in user.
 *
 * That is also why they are grouped in one file rather than scattered into
 * their feature modules: the property they share is "cannot be moved", and it
 * is easy to forget that when tidying a module later.
 */
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import crmDb from "../database/crm";
import { crmLeads } from "../database/crm-schema";

/** 1×1 transparent GIF. */
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

const PIXEL_HEADERS = {
  "Content-Type": "image/gif",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

/** Minimal styled page, matching the legacy dark card. */
function page(title: string, heading: string, body: string, accent: string) {
  return `<!doctype html>
<html><head>
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #09090b; color: #fafafa; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
.card { background-color: #18181b; border: 1px solid #27272a; padding: 2rem; border-radius: 0.75rem; text-align: center; max-width: 400px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5); }
h1 { color: ${accent}; margin-top: 0; font-size: 1.5rem; }
p { color: #a1a1aa; line-height: 1.5; font-size: 0.95rem; }
</style>
</head><body><div class="card"><h1>${heading}</h1><p>${body}</p></div></body></html>`;
}

/** Escape anything interpolated into the HTML above. */
function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const publicEndpoints = new Hono();

/**
 * The 🔕 Stop link at the bottom of every WhatsApp reminder.
 *
 * Deliberately a GET with no confirmation step: it is tapped from a phone
 * notification by someone who wants the nagging to stop NOW. Clearing
 * reminderFollowupPending as well as reminderAt is what actually stops the 2h
 * repeat — clearing only the timestamp would let the next cron cycle reschedule
 * it.
 */
publicEndpoints.get("/reminders/stop", async (c) => {
  const leadId = c.req.query("leadId");

  if (!leadId) {
    return c.html(
      page(
        "Invalid Request",
        "Error",
        "Invalid or missing Lead ID. Please make sure the link is correct.",
        "#f43f5e",
      ),
    );
  }

  try {
    const [lead] = await crmDb
      .select({
        id: crmLeads.id,
        company: crmLeads.company,
        firstName: crmLeads.firstName,
        lastName: crmLeads.lastName,
      })
      .from(crmLeads)
      .where(eq(crmLeads.id, leadId))
      .limit(1);

    if (!lead) {
      return c.html(
        page(
          "Lead Not Found",
          "Not Found",
          "The specified lead could not be found or has been deleted.",
          "#f43f5e",
        ),
      );
    }

    await crmDb
      .update(crmLeads)
      .set({ reminderAt: null, reminderFollowupPending: false })
      .where(eq(crmLeads.id, leadId));

    const displayName =
      lead.company ||
      [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
      "Lead";

    return c.html(
      page(
        "Reminder Stopped",
        "Reminder Stopped",
        `No further reminders will be sent for <strong>${esc(displayName)}</strong>.`,
        "#22c55e",
      ),
    );
  } catch (error) {
    console.error("[reminders/stop]", error);
    return c.html(
      page(
        "Error",
        "Error",
        "Something went wrong stopping this reminder. Please try again.",
        "#f43f5e",
      ),
    );
  }
});

/**
 * Open pixel. ALWAYS returns the GIF, even on error — a tracking failure must
 * never render a broken image in a prospect's email client.
 *
 * openedAt keeps its FIRST value (record.openedAt || now) while openedCount
 * increments, so "when did they first open it" survives re-opens.
 */
publicEndpoints.get("/marketing/track/open", async (c) => {
  try {
    const id = Number.parseInt(c.req.query("id") ?? "", 10);
    if (Number.isFinite(id)) {
      await crmDb.execute(sql`
        UPDATE mkt_emails
           SET status       = 'opened',
               opened_at    = COALESCE(opened_at, now()),
               opened_count = COALESCE(opened_count, 0) + 1
         WHERE id = ${id}
      `);
    }
  } catch (error) {
    console.error("[track/open]", error);
  }

  return c.body(TRANSPARENT_GIF, 200, PIXEL_HEADERS);
});

/**
 * Click redirect. The recipient must land on the destination whatever happens
 * here, so every failure path still redirects; only a missing or unparseable
 * URL can 400.
 */
publicEndpoints.get("/marketing/track/click", async (c) => {
  const redirectUrl = c.req.query("url");

  if (!redirectUrl) {
    return c.json({ error: "Missing required parameters" }, 400);
  }
  try {
    new URL(redirectUrl);
  } catch {
    return c.json({ error: "Invalid redirect URL" }, 400);
  }

  try {
    const id = Number.parseInt(c.req.query("id") ?? "", 10);
    if (Number.isFinite(id)) {
      await crmDb.execute(sql`
        UPDATE mkt_emails
           SET status        = 'clicked',
               clicked_at    = COALESCE(clicked_at, now()),
               clicked_count = COALESCE(clicked_count, 0) + 1
         WHERE id = ${id}
      `);
    }
  } catch (error) {
    console.error("[track/click]", error);
  }

  return c.redirect(redirectUrl, 302);
});

export default publicEndpoints;
