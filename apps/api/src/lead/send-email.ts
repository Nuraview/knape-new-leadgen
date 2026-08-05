/**
 * Lead outreach send — POST /lead/:id/send-email.
 *
 * A port of crmx1's apps/web/app/api/leads/[id]/send-email/route.ts, kept
 * step-for-step: this is the button the outreach team lives in, and "close
 * enough" would change what lands in a client's inbox.
 *
 * It is deliberately NOT the marketing composer's /marketing/send. That one
 * sends one email from a blank page. This one is lead-scoped and does four
 * things that route does not:
 *
 *   - falls back to the lead's stored video_link when the dialog sends none,
 *   - marks the lead contacted so the kanban moves the card out of Reminders,
 *   - snapshots subject/body/To/CC onto the lead (the marketing tables carry
 *     no CC and no lead link, so this row is the only per-lead record),
 *   - schedules the AI-written follow-ups with the per-setup cadence the
 *     Email Generator previews:
 *         current → +3h / +6h / +24h, every one a standalone email
 *         updated → +10min / +3h / +9h / +24h, only the first threaded
 *
 * Order of operations is load-bearing and matches the legacy route:
 *   rescue pasted Cap embeds -> video card -> signature -> upsert recipient +
 *   contact -> thread + email row -> inject tracking -> verify -> send ->
 *   record -> mark the lead -> schedule follow-ups
 *
 * The email row exists BEFORE the send because injectTracking needs its id,
 * and the deliverability gate runs after it so a blocked send is still
 * recorded as `failed` instead of vanishing.
 *
 * Follow-ups land in mkt_sequence_items with status "scheduled" and are
 * dispatched by the in-app scheduler (scheduler/marketing-followups.ts).
 * Legacy emitted an Inngest event per step; this stack sweeps the table every
 * five minutes instead, and the DB row was authoritative in both.
 */
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import crmDb from "../database/crm";
import { crmLeads } from "../database/crm-schema";
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
import { resolveEmailSender } from "../marketing/lib/email-senders";
import { sendMarketingEmail } from "../marketing/lib/email-provider";
import { wrapWithSignature } from "../marketing/lib/email-signature";
import { verifyEmail } from "../marketing/lib/reacher";
import { REPLY_TO } from "../marketing/lib/resend";
import { resolveSenderId } from "../marketing/lib/sender";
import { resolveSendingAccountId } from "../marketing/lib/sending-accounts";
import { injectTracking } from "../marketing/lib/tracking";
import {
  extractCapVideoId,
  renderVideoCardHtml,
  renderVideoCardText,
  renderVideoLinkFallbackHtml,
  rescueCapEmbedFromBody,
  resolveCapEmbed,
} from "../videos/cap-embed";

type SendLeadEmailBody = {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  body: string;
  includeSignature?: boolean;
  /** "current" or "updated" — picks the follow-up cadence and threading. */
  mode?: string;
  /** AI-written follow-ups from the generator; each { subject, body }. */
  followups?: { subject?: string; body?: string }[] | null;
  /** Cap share URL. Falls back to the lead's stored video_link. */
  videoLink?: string | null;
  /** email-senders id, e.g. "smtp:varshith@nuraview.us". */
  fromSenderId?: string | null;
};

/** Seconds from the initial send. Must match the labels in the send dialog. */
const UPDATED_FOLLOWUP_DELAYS_SEC = [
  10 * 60,
  3 * 60 * 60,
  9 * 60 * 60,
  24 * 60 * 60,
];
const CURRENT_FOLLOWUP_DELAYS_SEC = [3 * 60 * 60, 6 * 60 * 60, 24 * 60 * 60];

/** Readable plain-text fallback for the text/plain MIME part. */
function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** CC/BCC arrive as comma/semicolon-separated strings or arrays. */
function toAddressList(value: unknown): string[] {
  return (Array.isArray(value) ? value : String(value ?? "").split(/[,;]/))
    .map((address) => String(address).trim())
    .filter(Boolean);
}

const leadSendEmail = new Hono<{
  Variables: { userId: string; userEmail: string };
}>().post("/:id/send-email", async (c) => {
  const leadId = c.req.param("id");
  const body = await c.req.json<SendLeadEmailBody>();

  const {
    to,
    cc,
    bcc,
    subject,
    body: bodyText,
    includeSignature = true,
    mode = "current",
    followups = null,
    videoLink = null,
    fromSenderId = null,
  } = body;

  if (!to || !subject || !bodyText) {
    return c.json({ error: "Missing required fields: to, subject, body" }, 400);
  }

  const ccList = toAddressList(cc);
  const bccList = toAddressList(bcc);

  // Attributed to the signed-in user. Legacy read an ambient Next session here.
  const senderId = await resolveSenderId(c.get("userEmail"));
  const chosen = resolveEmailSender(fromSenderId ?? undefined);
  const recipientEmail = Array.isArray(to) ? to[0] : to;

  if (!recipientEmail) {
    return c.json({ error: "No recipient" }, 400);
  }

  // The body arrives as HTML from CKEditor ("<p>Hi</p>"), so don't double
  // process it. The plain-text path stays for any caller sending raw text.
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(bodyText);
  let htmlContent = looksLikeHtml ? bodyText : bodyText.replace(/\n/g, "<br>");
  const textContent = looksLikeHtml ? htmlToText(bodyText) : bodyText;

  // Video card: the dialog's link, else a Cap iframe rescued out of the body
  // (people paste the embed code; it never renders in email), else the lead's
  // stored video_link.
  let effectiveVideoLink: string | null =
    typeof videoLink === "string" && videoLink.trim() ? videoLink.trim() : null;

  const rescued = rescueCapEmbedFromBody(htmlContent);
  if (rescued) {
    htmlContent = rescued.cleaned;
    effectiveVideoLink = effectiveVideoLink || rescued.shareUrl;
  }

  if (!effectiveVideoLink) {
    const [leadRow] = await crmDb
      .select({ videoLink: crmLeads.videoLink })
      .from(crmLeads)
      .where(eq(crmLeads.id, leadId))
      .limit(1);
    effectiveVideoLink = leadRow?.videoLink?.trim() || null;
  }

  let videoCardText: string | null = null;
  if (effectiveVideoLink && extractCapVideoId(effectiveVideoLink)) {
    try {
      const embed = await resolveCapEmbed(effectiveVideoLink);
      htmlContent = `${htmlContent}${renderVideoCardHtml(embed)}`;
      videoCardText = renderVideoCardText(embed);
    } catch (embedError) {
      console.warn(
        "[LeadEmail] Cap embed failed, using plain link",
        embedError,
      );
      htmlContent = `${htmlContent}${renderVideoLinkFallbackHtml(effectiveVideoLink)}`;
      videoCardText = `▶ Watch my video: ${effectiveVideoLink}`;
    }
  }

  if (includeSignature && htmlContent) {
    htmlContent = wrapWithSignature(htmlContent);
  }

  let [recipient] = await crmDb
    .select()
    .from(users)
    .where(eq(users.email, recipientEmail));

  if (!recipient) {
    [recipient] = await crmDb
      .insert(users)
      .values({ email: recipientEmail, firstName: null })
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
      firstName: null,
      lastName: null,
      company: null,
      tags: ["lead-outreach"],
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
      body: bodyText,
      bodyHtml: "",
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

  // Hard gate: never send to a confirmed-dead mailbox (it would bounce).
  const verdict = await verifyEmail(recipientEmail);
  if (verdict.reachable === "invalid") {
    await crmDb
      .update(emails)
      .set({ status: "failed" })
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
    to: recipientEmail,
    ...(ccList.length ? { cc: ccList } : {}),
    ...(bccList.length ? { bcc: bccList } : {}),
    subject,
    html: trackedHtml,
    text: `${textContent}${videoCardText ? `\n\n${videoCardText}` : ""}`,
    accountId: fromSenderId,
    replyTo: chosen?.replyTo ?? REPLY_TO,
  });

  if (sendResult.error) {
    console.error("[LeadEmail] send error:", sendResult.error);
    await crmDb
      .update(emails)
      .set({ status: "failed", provider: sendResult.provider })
      .where(eq(emails.id, emailRecord.id));
    return c.json({ error: sendResult.error }, 500);
  }

  await crmDb
    .update(emails)
    .set({
      provider: sendResult.provider,
      providerMessageId: sendResult.messageId,
      status: "sent",
      deliveredAt: sendResult.accepted ? new Date() : null,
    })
    .where(eq(emails.id, emailRecord.id));

  // Mark the lead contacted (the kanban moves the card out of Reminders into
  // "Taken care") and snapshot what went out. Best-effort: the mail is already
  // gone, so a failure here must not fail the request and invite a resend.
  try {
    await crmDb
      .update(crmLeads)
      .set({
        lastContactedAt: new Date(),
        sentEmailSubject: subject,
        sentEmailBody: bodyText,
        sentEmailTo: recipientEmail,
        // The normalized list, so it matches what the mail server received
        // rather than the raw "a@x; b@y" the form may have sent.
        sentEmailCc: ccList.length ? ccList.join(", ") : null,
      })
      .where(eq(crmLeads.id, leadId));
  } catch (markError) {
    console.warn("[LeadEmail] failed to mark lead as contacted", markError);
  }

  console.log(
    `[LeadEmail] email #${emailRecord.id} -> ${recipientEmail} via ${sendResult.provider} (${sendResult.messageId})`,
  );

  // Follow-ups: whatever the generator wrote. Delays and threading by setup —
  // "current" threads nothing, "updated" threads only the first.
  const aiFollowups = Array.isArray(followups)
    ? followups.filter(
        (f) => f && typeof f.body === "string" && f.body.trim().length > 0,
      )
    : [];

  const delaysSec =
    mode === "updated"
      ? UPDATED_FOLLOWUP_DELAYS_SEC
      : CURRENT_FOLLOWUP_DELAYS_SEC;

  if (aiFollowups.length > 0 && sendResult.messageId) {
    try {
      const [sequence] = await crmDb
        .insert(sequences)
        .values({
          campaign: "Lead Outreach",
          initiatorUserId: senderId,
          // Persist the identity so follow-ups go out as the same domain.
          senderId: fromSenderId ?? null,
          status: "active",
        })
        .returning();

      if (sequence) {
        for (const [index, followup] of aiFollowups.entries()) {
          const followupBody = String(followup.body ?? "");
          const followupIsHtml = /<[a-z][\s\S]*>/i.test(followupBody);
          const delaySeconds =
            delaysSec[index] ?? delaysSec[delaysSec.length - 1] ?? 24 * 60 * 60;
          // Only "updated" step 1 replies in-thread; everything else is a
          // standalone email keeping the subject verbatim (no "Re:").
          const threaded = mode === "updated" && index === 0;

          await crmDb.insert(sequenceItems).values({
            sequenceId: sequence.id,
            contactEmail: recipientEmail,
            stepNumber: index + 1,
            subject,
            body: followupIsHtml ? htmlToText(followupBody) : followupBody,
            bodyHtml: followupIsHtml
              ? followupBody
              : followupBody.replace(/\n/g, "<br>"),
            scheduledAt: new Date(Date.now() + delaySeconds * 1000),
            // "scheduled", not the column default "pending" — the scheduler
            // selects on this exact value.
            status: "scheduled",
            messageIdHeader: threaded ? sendResult.messageId : null,
            parentMessageId: null,
          });
        }

        console.log(
          `[LeadEmail] sequence #${sequence.id} for ${recipientEmail} (${mode} setup: ${aiFollowups.length} follow-ups)`,
        );
      }
    } catch (error) {
      // Never fail the send over follow-up scheduling.
      console.error("[LeadEmail] failed to create sequence:", error);
    }
  }

  return c.json({
    success: true,
    resendId: sendResult.messageId,
    threadId: thread.id,
  });
});

export default leadSendEmail;
