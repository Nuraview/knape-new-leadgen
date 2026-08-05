/**
 * Resend delivery events — the source of every open, click and bounce number
 * on the marketing dashboard.
 *
 * Ported from apps/web/app/api/marketing/webhooks/resend. Without it the
 * dashboard's rates freeze at whatever they were when the legacy app stopped
 * receiving, and a bounced address keeps getting mailed — which is how sender
 * reputation dies quietly.
 *
 * Every event is appended to mkt_email_events FIRST, then the summary columns
 * on mkt_emails are updated. The log is the record; the columns are a cache of
 * it. If a status update ever looks wrong, the events table is what settles it.
 */
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import crmDb from "../database/crm";

const resendWebhook = new Hono();

resendWebhook.post("/resend", async (c) => {
  const payload = await c.req.json<{
    type?: string;
    data?: { email_id?: string; to?: string[]; click?: { link?: string } };
  }>().catch(() => null);

  if (!payload?.type) {
    // 400, not 500 — a malformed body is the sender's problem, and a 5xx would
    // make Resend retry something that can never succeed.
    return c.json({ error: "Bad payload" }, 400);
  }

  const type = payload.type;
  const messageId = payload.data?.email_id ?? null;
  if (!messageId) return c.json({ received: true, skipped: "no email_id" });

  const now = new Date();

  await crmDb.execute(
    sql`INSERT INTO mkt_email_events (resend_id, event_type, payload, created_at)
        VALUES (${messageId}, ${type}, ${JSON.stringify(payload)}::jsonb, ${now})`,
  );

  /*
   * Opens and clicks only ever move FORWARD — the first open is the one worth
   * recording, and COALESCE keeps a later duplicate from overwriting it. Resend
   * delivers at least once and reorders, so "last event wins" would be wrong.
   */
  switch (type) {
    case "email.sent":
      await crmDb.execute(
        sql`UPDATE mkt_emails SET status = 'sent',
            sent_date = COALESCE(sent_date, ${now})
            WHERE resend_id = ${messageId}`,
      );
      break;
    case "email.delivered":
      await crmDb.execute(
        sql`UPDATE mkt_emails SET status = 'delivered',
            delivered_at = COALESCE(delivered_at, ${now})
            WHERE resend_id = ${messageId}`,
      );
      break;
    case "email.opened":
      await crmDb.execute(
        sql`UPDATE mkt_emails SET opened_at = COALESCE(opened_at, ${now}),
            opened_count = COALESCE(opened_count, 0) + 1
            WHERE resend_id = ${messageId}`,
      );
      break;
    case "email.clicked":
      await crmDb.execute(
        sql`UPDATE mkt_emails SET clicked_at = COALESCE(clicked_at, ${now}),
            clicked_count = COALESCE(clicked_count, 0) + 1
            WHERE resend_id = ${messageId}`,
      );
      break;
    case "email.bounced":
      await crmDb.execute(
        sql`UPDATE mkt_emails SET status = 'bounced', bounced_at = ${now}
            WHERE resend_id = ${messageId}`,
      );
      /*
       * A bounce is also a STOP instruction. Adding the address to the
       * exclusion list here is what stops the follow-up dispatcher mailing a
       * dead mailbox three more times — the single biggest avoidable hit to
       * sender reputation.
       */
      await crmDb.execute(
        sql`INSERT INTO mkt_sequence_exclusions (email, reason)
            SELECT c.email, 'hard bounce' FROM mkt_emails e
            JOIN mkt_contacts c ON c.id = e.recipient_id
            WHERE e.resend_id = ${messageId}
              AND c.email IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM mkt_sequence_exclusions x WHERE x.email = c.email
              )`,
      );
      break;
    case "email.complained":
      await crmDb.execute(
        sql`UPDATE mkt_emails SET status = 'complained' WHERE resend_id = ${messageId}`,
      );
      // A spam complaint is an unambiguous "never again".
      await crmDb.execute(
        sql`INSERT INTO mkt_sequence_exclusions (email, reason)
            SELECT c.email, 'spam complaint' FROM mkt_emails e
            JOIN mkt_contacts c ON c.id = e.recipient_id
            WHERE e.resend_id = ${messageId}
              AND c.email IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM mkt_sequence_exclusions x WHERE x.email = c.email
              )`,
      );
      break;
    default:
      console.log(`[resend] unhandled event type: ${type}`);
  }

  // Always 200 for a well-formed event. Resend disables endpoints that keep
  // failing, and an unhandled type is not a failure.
  return c.json({ received: true });
});

export default resendWebhook;
