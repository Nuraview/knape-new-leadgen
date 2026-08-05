/**
 * Marketing send — the composer's POST target.
 *
 * Ported from apps/web/app/api/marketing/send/route.ts (327 lines). The order
 * of operations is load-bearing and is kept exactly as the legacy route had it:
 *
 *   rescue pasted Cap embeds -> render body -> append the video card ->
 *   append signature -> upsert recipient + contact -> create thread + email row
 *   -> inject tracking -> verify deliverability -> send -> record the result
 *
 * Two of those are easy to get wrong by reordering:
 *
 *   - The email row is created BEFORE sending, because injectTracking needs its
 *     id to build the pixel and click URLs. Send-then-record would produce mail
 *     with no tracking in it at all.
 *   - Deliverability is checked AFTER the row exists so a blocked send is still
 *     recorded as `failed` rather than vanishing. A send that leaves no trace is
 *     indistinguishable from one that never happened.
 *
 * Follow-ups are scheduled into mkt_sequence_items with status "scheduled" and
 * dispatched by the in-app scheduler. Legacy fired an Inngest event per step;
 * Inngest is not on this stack yet, and the scheduler already runs guarded
 * five-minute jobs.
 */
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import crmDb from "../database/crm";
import {
  mktContacts as contacts,
  mktEmails as emails,
  mktFolders as folders,
  mktSequenceItems as sequenceItems,
  mktSequences as sequences,
  mktThreadFolders as threadFolders,
  mktThreads as threads,
  mktUsers as users,
} from "../database/crm-schema";
import {
  extractCapVideoId,
  renderVideoCardHtml,
  renderVideoCardText,
  renderVideoLinkFallbackHtml,
  rescueCapEmbedFromBody,
  resolveCapEmbed,
} from "../videos/cap-embed";
import { resolveEmailSender } from "./lib/email-senders";
import { sendMarketingEmail } from "./lib/email-provider";
import {
  wrapTextWithSignature,
  wrapWithSignature,
} from "./lib/email-signature";
import { verifyEmail } from "./lib/reacher";
import { REPLY_TO } from "./lib/resend";
import { resolveSenderId } from "./lib/sender";
import { resolveSendingAccountId } from "./lib/sending-accounts";
import { injectTracking } from "./lib/tracking";

type SendBody = {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  firstName?: string;
  bodyHtml?: string;
  bodyText?: string;
  loomLink?: string;
  includeSignature?: boolean;
  enableFollowup?: boolean;
  followup1Body?: string;
  followup2Body?: string;
  followup3Body?: string;
  fromSenderId?: string;
};

/** Same cadence the legacy route used: +6h, +24h, +36h. */
const FOLLOWUP_DELAYS_HOURS = [6, 24, 36];

const send = new Hono<{ Variables: { userId: string; userEmail: string } }>().post(
  "/",
  async (c) => {
    const body = await c.req.json<SendBody>();
    const {
      to,
      cc,
      bcc,
      subject,
      firstName,
      bodyHtml,
      bodyText,
      loomLink,
      includeSignature = true,
      enableFollowup = false,
      followup1Body = "Just following up on my previous email.",
      followup2Body =
        "Wanted to check if you had a chance to review my previous message.",
      followup3Body = "This is my final follow-up. Would love to hear from you!",
      fromSenderId,
    } = body;

    if (!to || !subject) {
      return c.json({ error: "Missing required fields: to, subject" }, 400);
    }

    // Attributed to the signed-in user, not a hardcoded id. Legacy reached for
    // an ambient Next session here; Hono has the identity on the context.
    const senderId = await resolveSenderId(c.get("userEmail"));
    const chosen = resolveEmailSender(fromSenderId);

    const hasCustomBody = bodyText && !bodyHtml;
    let htmlContent =
      bodyHtml || (hasCustomBody ? bodyText.replace(/\n/g, "<br>") : undefined);
    let textContent = bodyText || undefined;

    // People paste Cap's iframe embed code straight into the body. It can never
    // render in a mail client, so strip the dead block and treat the video it
    // referenced as the video link when none was given.
    let effectiveLoomLink: string | undefined = loomLink || undefined;
    if (htmlContent) {
      const rescued = rescueCapEmbedFromBody(htmlContent);
      if (rescued) {
        htmlContent = rescued.cleaned;
        effectiveLoomLink = effectiveLoomLink || rescued.shareUrl;
      }
    }
    if (textContent) {
      const rescuedText = rescueCapEmbedFromBody(textContent);
      if (rescuedText) {
        textContent = rescuedText.cleaned;
        effectiveLoomLink = effectiveLoomLink || rescuedText.shareUrl;
      }
    }

    if (!htmlContent) {
      return c.json({ error: "The message body is empty" }, 400);
    }

    const isCapLink = Boolean(
      effectiveLoomLink && extractCapVideoId(effectiveLoomLink),
    );

    // Cap video -> clickable GIF card, appended before the signature so it
    // reads as part of the message. Resolution failure degrades to a styled
    // link and never blocks the send.
    if (isCapLink && effectiveLoomLink) {
      try {
        const embed = await resolveCapEmbed(effectiveLoomLink);
        htmlContent = `${htmlContent}${renderVideoCardHtml(embed)}`;
        if (textContent) {
          textContent = `${textContent}\n\n${renderVideoCardText(embed)}`;
        }
      } catch (embedErr) {
        console.warn("[send] Cap embed failed, using a plain link", embedErr);
        htmlContent = `${htmlContent}${renderVideoLinkFallbackHtml(effectiveLoomLink)}`;
        if (textContent) {
          textContent = `${textContent}\n\n▶ Watch my video: ${effectiveLoomLink}`;
        }
      }
    }

    const recipientEmail = Array.isArray(to) ? to[0] : to;
    if (!recipientEmail) {
      return c.json({ error: "No recipient" }, 400);
    }

    if (includeSignature) {
      htmlContent = wrapWithSignature(htmlContent);
      if (textContent) textContent = wrapTextWithSignature(textContent);
    }

    let [recipient] = await crmDb
      .select()
      .from(users)
      .where(eq(users.email, recipientEmail));

    if (!recipient) {
      [recipient] = await crmDb
        .insert(users)
        .values({ email: recipientEmail, firstName: firstName || null })
        .returning();
    }
    if (!recipient) {
      return c.json({ error: "Could not resolve the recipient" }, 500);
    }

    const [existingContact] = await crmDb
      .select()
      .from(contacts)
      .where(eq(contacts.email, recipientEmail))
      .limit(1);

    if (!existingContact) {
      await crmDb.insert(contacts).values({
        email: recipientEmail,
        firstName: firstName || recipient.firstName || null,
        lastName: null,
        company: null,
        tags: ["outreach"],
      });
    }

    const [thread] = await crmDb
      .insert(threads)
      .values({ subject, lastActivityDate: new Date() })
      .returning();
    if (!thread) {
      return c.json({ error: "Could not create the thread" }, 500);
    }

    const [emailRecord] = await crmDb
      .insert(emails)
      .values({
        threadId: thread.id,
        senderId,
        recipientId: recipient.id,
        subject,
        body: bodyText || bodyHtml || "",
        bodyHtml: bodyHtml || "",
        sentDate: new Date(),
        resendId: null,
        fromAccountId: resolveSendingAccountId(fromSenderId),
        status: "queued",
      })
      .returning();
    if (!emailRecord) {
      return c.json({ error: "Could not create the email record" }, 500);
    }

    const [sentFolder] = await crmDb
      .select()
      .from(folders)
      .where(eq(folders.name, "Sent"));

    if (sentFolder) {
      await crmDb
        .insert(threadFolders)
        .values({ threadId: thread.id, folderId: sentFolder.id });
    }

    const trackedHtml = injectTracking(htmlContent, emailRecord.id);

    // Hard gate: never send to a mailbox SMTP verification says does not exist.
    const verdict = await verifyEmail(recipientEmail);
    if (verdict.reachable === "invalid") {
      await crmDb
        .update(emails)
        .set({ status: "failed", provider: "smtp" })
        .where(eq(emails.id, emailRecord.id));
      return c.json(
        {
          error:
            "Blocked: recipient mailbox does not exist (SMTP verification) — would bounce.",
        },
        422,
      );
    }

    const sendResult = await sendMarketingEmail({
      to,
      cc,
      bcc,
      accountId: fromSenderId,
      replyTo: chosen?.replyTo ?? REPLY_TO,
      subject,
      html: trackedHtml,
      text: textContent || undefined,
    });

    if (sendResult.error) {
      console.error(`[${sendResult.provider}] send error:`, sendResult.error);
      await crmDb
        .update(emails)
        .set({ status: "failed", provider: sendResult.provider })
        .where(eq(emails.id, emailRecord.id));
      return c.json({ error: sendResult.error }, 500);
    }

    await crmDb
      .update(emails)
      .set({
        resendId: sendResult.provider === "resend" ? sendResult.messageId : null,
        provider: sendResult.provider,
        providerMessageId: sendResult.messageId,
        status: "sent",
        deliveredAt: sendResult.accepted ? new Date() : null,
      })
      .where(eq(emails.id, emailRecord.id));

    console.log(
      `[send] email #${emailRecord.id} -> ${recipientEmail} via ${sendResult.provider} (${sendResult.messageId})`,
    );

    if (enableFollowup && sendResult.messageId) {
      // Never let a follow-up failure fail the send. The mail is already out;
      // reporting an error now would invite a duplicate send.
      try {
        const [sequence] = await crmDb
          .insert(sequences)
          .values({
            campaign: "Manual Send",
            initiatorUserId: senderId,
            status: "active",
            senderId: fromSenderId ?? null,
          })
          .returning();

        if (sequence) {
          const bodies = [followup1Body, followup2Body, followup3Body];
          for (let i = 0; i < FOLLOWUP_DELAYS_HOURS.length; i++) {
            const hours = FOLLOWUP_DELAYS_HOURS[i] ?? 24;
            await crmDb.insert(sequenceItems).values({
              sequenceId: sequence.id,
              contactEmail: recipientEmail,
              stepNumber: i + 1,
              subject,
              body: bodies[i] ?? "",
              scheduledAt: new Date(Date.now() + hours * 60 * 60 * 1000),
              // "scheduled", not the column default "pending". The scheduler
              // selects on this exact value — a mismatch here is how the
              // follow-ups list once read 0 against the legacy app's 9.
              status: "scheduled",
              messageIdHeader: sendResult.messageId,
              parentMessageId: null,
            });
          }
        }
      } catch (err) {
        console.error("[send] could not schedule follow-ups:", err);
      }
    }

    return c.json({
      success: true,
      provider: sendResult.provider,
      messageId: sendResult.messageId,
      threadId: thread.id,
    });
  },
);

export default send;
