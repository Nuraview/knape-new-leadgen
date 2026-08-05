import { eq } from "drizzle-orm";
import db from "../../database/crm";
import { mktEmails as emails, mktUsers as users } from "../../database/crm-schema";
import { injectTracking } from "./tracking";
import { sendMarketingEmail } from "./email-provider";
import { resolveSendingAccountId } from "./sending-accounts";

/**
 * Send a follow-up email AS A TRACKED mkt_emails record so its opens/clicks are
 * tracked (pixel + link-redirect keyed on the row id) and it counts in the
 * dashboard — same as initial sends. Always via Mailu SMTP (creative-hive).
 */
export async function sendTrackedFollowup(opts: {
  to: string;
  subject: string;
  bodyHtml: string; // already includes signature; NOT yet tracked
  bodyText?: string;
  headers?: Record<string, string>;
  senderId?: number | null;
  threadId?: number | null;
  /** Sending identity id (email-senders id) — the follow-up sends as this domain. */
  accountId?: string | null;
}): Promise<{ ok: boolean; messageId: string | null; error?: string }> {
  let [recipient] = await db.select().from(users).where(eq(users.email, opts.to));
  if (!recipient) {
    [recipient] = await db.insert(users).values({ email: opts.to }).returning();
  }
  if (!recipient) {
    return { ok: false, messageId: null, error: "could not resolve recipient" };
  }

  const [row] = await db
    .insert(emails)
    .values({
      threadId: opts.threadId ?? null,
      senderId: opts.senderId ?? null,
      recipientId: recipient.id,
      subject: opts.subject,
      body: opts.bodyText ?? "",
      bodyHtml: opts.bodyHtml,
      sentDate: new Date(),
      provider: "smtp",
      fromAccountId: resolveSendingAccountId(opts.accountId),
      status: "queued",
    })
    .returning();
  if (!row) {
    return { ok: false, messageId: null, error: "could not record the email" };
  }

  const tracked = injectTracking(opts.bodyHtml, row.id);
  const res = await sendMarketingEmail({
    to: opts.to,
    subject: opts.subject,
    html: tracked,
    text: opts.bodyText,
    headers: opts.headers,
    accountId: opts.accountId ?? null,
  });

  await db
    .update(emails)
    .set({
      status: res.error ? "failed" : "sent",
      provider: "smtp",
      providerMessageId: res.messageId,
      deliveredAt: res.accepted ? new Date() : null,
    })
    .where(eq(emails.id, row.id));

  return { ok: !res.error, messageId: res.messageId, error: res.error };
}
