import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { crmLeads } from "@/drizzle/schema";
import {
  mktContacts as contacts,
  mktEmails as emails,
  mktFolders as folders,
  mktSequenceItems as sequenceItems,
  mktSequences as sequences,
  mktUsers as users,
  mktThreadFolders as threadFolders,
  mktThreads as threads,
} from "@/lib/db";
import {
  wrapTextWithSignature,
  wrapWithSignature,
} from "@/lib/marketing/email-signature";
import { sendMarketingEmail } from "@/lib/marketing/email-provider";
import { resolveSendingAccountId } from "@/lib/marketing/sending-accounts";
import { verifyEmail } from "@/lib/marketing/reacher";
import { resolveSenderId } from "@/lib/marketing/sender";
import { injectTracking } from "@/lib/marketing/tracking";
import { inngest } from "@/inngest/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Strip HTML to a readable plain-text fallback for the text/plain MIME part.
function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { id: leadId } = await params;

  try {
    const body = await request.json();
    const {
      to,
      cc,
      bcc,
      subject,
      body: bodyText,
      includeSignature = true,
      // Both setups now send AI-written follow-ups only (the old hardcoded
      // default bodies were removed). The generator returns email1 (initial)
      // plus follow-ups that arrive here as the `followups` array:
      //  - "current" → email1 + email2..email4, scheduled at +6h / +24h / +36h,
      //    every follow-up threaded as a reply into the initial email.
      //  - "updated" → email1 + email2..email5, scheduled at +10 min / +3h /
      //    +9h / +24h; email2 replies in-thread, the rest go out standalone.
      mode = "current",
      // AI-written follow-ups (each { subject, body }; body may be HTML from
      // CKEditor).
      followups = null,
      // Cap share URL → embedded as a GIF thumbnail card. Falls back to the
      // lead's stored video_link when the caller doesn't send one.
      videoLink = null,
      // Which sending domain/identity to send as (email-senders id, e.g.
      // "smtp:varshith@nuraview.us"). Missing → default (creative-hive). The
      // scheduled follow-ups inherit this via the sequence's sender_id.
      fromSenderId = null,
    } = body;

    if (!to || !subject || !bodyText) {
      return NextResponse.json(
        { error: "Missing required fields: to, subject, body" },
        { status: 400 }
      );
    }

    // CC/BCC arrive as comma/semicolon-separated strings (or arrays). Normalize
    // to clean string arrays; drop blanks so Resend doesn't reject empties.
    const toAddressList = (value: unknown): string[] =>
      (Array.isArray(value) ? value : String(value ?? "").split(/[,;]/))
        .map((addr) => String(addr).trim())
        .filter(Boolean);

    const ccList = toAddressList(cc);
    const bccList = toAddressList(bcc);

    const senderId = await resolveSenderId();
    const recipientEmail = Array.isArray(to) ? to[0] : to;

    // The body arrives as HTML from CKEditor (e.g. "<p>Hi</p>"). Detect that
    // so we don't double-process it — a plain-text fallback path stays for
    // any caller that still sends raw text with newlines.
    const looksLikeHtml = /<[a-z][\s\S]*>/i.test(bodyText);
    let htmlContent = looksLikeHtml
      ? bodyText
      : bodyText.replace(/\n/g, "<br>");

    // Plain-text MIME part: strip tags from the HTML so email clients that
    // render text/plain don't show literal "<p>"/"<strong>" markup.
    const textContent = looksLikeHtml
      ? bodyText
          .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/gi, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
      : bodyText;

    // Video card: explicit videoLink from the dialog, else Cap iframe embed
    // code rescued from the body (users paste it; it never renders in email),
    // else the lead's stored video_link. Appended before signature/unsubscribe
    // so it reads as part of the message body. Failures degrade to a plain
    // link — never block the send.
    const capEmbedLib = await import("@/lib/videos/cap-embed");
    let effectiveVideoLink: string | null =
      typeof videoLink === "string" && videoLink.trim() ? videoLink.trim() : null;
    {
      const rescued = capEmbedLib.rescueCapEmbedFromBody(htmlContent);
      if (rescued) {
        htmlContent = rescued.cleaned;
        effectiveVideoLink = effectiveVideoLink || rescued.shareUrl;
      }
    }
    if (!effectiveVideoLink) {
      const [leadRow] = await db
        .select({ videoLink: crmLeads.videoLink })
        .from(crmLeads)
        .where(eq(crmLeads.id, leadId))
        .limit(1);
      effectiveVideoLink = leadRow?.videoLink?.trim() || null;
    }
    let videoCardText: string | null = null;
    if (effectiveVideoLink) {
      if (capEmbedLib.extractCapVideoId(effectiveVideoLink)) {
        try {
          const embed = await capEmbedLib.resolveCapEmbed(effectiveVideoLink);
          htmlContent = `${htmlContent}${capEmbedLib.renderVideoCardHtml(embed)}`;
          videoCardText = capEmbedLib.renderVideoCardText(embed);
        } catch (embedErr) {
          console.warn("[LeadEmail] Cap embed failed, using plain link", embedErr);
          htmlContent = `${htmlContent}${capEmbedLib.renderVideoLinkFallbackHtml(effectiveVideoLink)}`;
          videoCardText = `▶ Watch my video: ${effectiveVideoLink}`;
        }
      }
    }

    if (includeSignature && htmlContent) {
      htmlContent = wrapWithSignature(htmlContent);
    }

    // Get or create user
    let [recipient] = await db
      .select()
      .from(users)
      .where(eq(users.email, recipientEmail));

    if (!recipient) {
      [recipient] = await db
        .insert(users)
        .values({ email: recipientEmail, firstName: null })
        .returning();
    }

    // Ensure a contact exists for this recipient
    const [existingContact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.email, recipientEmail))
      .limit(1);

    if (!existingContact) {
      await db.insert(contacts).values({
        email: recipientEmail,
        firstName: null,
        lastName: null,
        company: null,
        tags: ["lead-outreach"],
      });
    }

    // Create thread
    const [thread] = await db
      .insert(threads)
      .values({ subject, lastActivityDate: new Date() })
      .returning();

    // Create email record
    const [emailRecord] = await db
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

    // Add to sent folder
    const [sentFolder] = await db
      .select()
      .from(folders)
      .where(eq(folders.name, "Sent"));

    if (sentFolder) {
      await db.insert(threadFolders).values({
        threadId: thread.id,
        folderId: sentFolder.id,
      });
    }

    // Inject tracking
    const trackedHtml = injectTracking(htmlContent, emailRecord.id);

    // Hard gate: never send to a confirmed-dead mailbox (would bounce).
    const verdict = await verifyEmail(recipientEmail);
    if (verdict.reachable === "invalid") {
      await db.update(emails).set({ status: "failed" }).where(eq(emails.id, emailRecord.id));
      return NextResponse.json(
        { error: "Blocked: recipient mailbox does not exist (SMTP verification) — would bounce." },
        { status: 422 },
      );
    }

    // Send via SMTP as the picked domain (default creative-hive) — Resend removed.
    const sendRes = await sendMarketingEmail({
      to: recipientEmail,
      ...(ccList.length ? { cc: ccList } : {}),
      ...(bccList.length ? { bcc: bccList } : {}),
      subject,
      html: trackedHtml,
      text: `${textContent}${videoCardText ? `\n\n${videoCardText}` : ""}`,
      accountId: fromSenderId,
    });

    if (sendRes.error) {
      console.error("SMTP send error:", sendRes.error);
      await db
        .update(emails)
        .set({ status: "failed" })
        .where(eq(emails.id, emailRecord.id));
      return NextResponse.json({ error: sendRes.error }, { status: 500 });
    }

    // Update email record (delivered = accepted by mail server).
    await db
      .update(emails)
      .set({
        provider: "smtp",
        providerMessageId: sendRes.messageId,
        status: "sent",
        deliveredAt: sendRes.accepted ? new Date() : null,
      })
      .where(eq(emails.id, emailRecord.id));

    // Mark the CRM lead as contacted so the Kanban moves the card out of the
    // Reminders column and into "Taken care", and snapshot the email that went
    // out (subject/body + To/CC) so the Taken care card can show it — the
    // generated_email_* draft is cleared on send and the marketing tables hold
    // no CC and no lead link, so this is the only per-lead record. Best-effort:
    // a failure here must not fail the (already successful) send.
    try {
      await db
        .update(crmLeads)
        .set({
          lastContactedAt: new Date().toISOString(),
          sentEmailSubject: subject,
          sentEmailBody: bodyText,
          sentEmailTo: recipientEmail,
          // Store the normalized list (comma-joined) so it matches what Resend
          // actually received, not the raw "a@x; b@y" the form may have sent.
          sentEmailCc: ccList.length ? ccList.join(", ") : null,
        })
        .where(eq(crmLeads.id, leadId));
    } catch (markErr) {
      console.warn("[LeadEmail] failed to mark lead as contacted", markErr);
    }

    console.log(
      `[LeadEmail] Email #${emailRecord.id} sent to ${recipientEmail} (resendId: ${sendRes.messageId})`
    );

    // Schedule follow-ups. Both setups now schedule AI-written follow-ups only
    // (the old hardcoded default bodies were removed) — whatever the generator
    // returned in `followups`. They are still follow-ups either way (tracked +
    // unsubscribe footer). Delays + threading differ by setup:
    //  - "current": +3h / +6h / +24h; EVERY follow-up is a standalone email
    //    (never threaded) keeping the same subject verbatim.
    //  - "updated": +10 min / +3h / +9h / +24h; only email2 replies in-thread,
    //    email3/email4/email5 go out standalone with the same subject.
    const aiFollowups: { subject?: string; body?: string }[] = Array.isArray(
      followups,
    )
      ? followups.filter(
          (f) => f && typeof f.body === "string" && f.body.trim().length > 0,
        )
      : [];
    const hasFollowups = aiFollowups.length > 0;
    // Per-step delays (seconds from the initial send), by setup.
    const FOLLOWUP_DELAYS_SEC =
      mode === "updated"
        ? [10 * 60, 3 * 60 * 60, 9 * 60 * 60, 24 * 60 * 60]
        : [3 * 60 * 60, 6 * 60 * 60, 24 * 60 * 60];

    if (hasFollowups && sendRes.messageId) {
      try {
        const [sequence] = await db
          .insert(sequences)
          .values({
            campaign: "Lead Outreach",
            initiatorUserId: senderId,
            // Persist the chosen sending identity so follow-ups send as the same
            // domain as the initial email (read back in queue/followup route).
            senderId: fromSenderId ?? null,
            status: "active",
          })
          .returning();

        type FollowupStep = {
          step: number;
          delaySeconds: number;
          subject: string;
          body: string;
          bodyHtml?: string | null;
          // The Message-ID this step replies to. Set → the follow-up sender
          // threads it (In-Reply-To/References) and prefixes "Re:". Null → it
          // goes out as a standalone email keeping the original subject as-is.
          messageIdHeader: string | null;
        };
        const delays: FollowupStep[] = [];

        // Every follow-up carries the SAME subject as the initial email. Threading:
        //  - "current": nothing is threaded — all follow-ups are standalone
        //    emails keeping the subject verbatim (no "Re:").
        //  - "updated": only email2 (i===0) replies into the thread; email3+ go
        //    out standalone keeping the subject verbatim (no "Re:").
        aiFollowups.forEach((f, i) => {
          const fBody = String(f.body ?? "");
          const fLooksLikeHtml = /<[a-z][\s\S]*>/i.test(fBody);
          const delaySeconds =
            FOLLOWUP_DELAYS_SEC[i] ??
            FOLLOWUP_DELAYS_SEC[FOLLOWUP_DELAYS_SEC.length - 1];
          const threaded = mode === "updated" && i === 0;
          delays.push({
            step: i + 1,
            delaySeconds,
            subject,
            body: fLooksLikeHtml ? htmlToText(fBody) : fBody,
            bodyHtml: fLooksLikeHtml ? fBody : fBody.replace(/\n/g, "<br>"),
            messageIdHeader: threaded ? sendRes.messageId : null,
          });
        });

        for (const item of delays) {
          const scheduledAt = new Date(Date.now() + item.delaySeconds * 1000);

          const [seqItem] = await db
            .insert(sequenceItems)
            .values({
              sequenceId: sequence.id,
              contactEmail: recipientEmail,
              stepNumber: item.step,
              subject: item.subject,
              body: item.body,
              bodyHtml: item.bodyHtml ?? null,
              scheduledAt: scheduledAt,
              status: "scheduled",
              messageIdHeader: item.messageIdHeader,
              parentMessageId: null,
            })
            .returning();

          // Hand the delayed send to self-hosted Inngest (sleeps until
          // scheduledAt, then sends). The DB row is authoritative either way —
          // if the event fails to emit, the marketing-followups cron sweeps it.
          try {
            await inngest.send({
              name: "marketing/followup",
              data: {
                step: item.step,
                sequenceItemId: seqItem.id,
                scheduledAt: scheduledAt.toISOString(),
              },
            });
          } catch (inngestErr) {
            console.warn("[LeadEmail] Inngest emit failed, follow-up saved to DB only (cron will sweep)");
          }
        }

        console.log(
          `[LeadEmail] Created sequence #${sequence.id} for ${recipientEmail}` +
            ` (${mode} setup: ${aiFollowups.length} follow-ups @ ${FOLLOWUP_DELAYS_SEC.map(
              (s) => `${Math.round(s / 3600)}h`,
            ).join("/")})`
        );
      } catch (err) {
        console.error("[LeadEmail] Failed to create sequence:", err);
        // Don't fail the email send if follow-ups fail
      }
    }

    return NextResponse.json({
      success: true,
      resendId: sendRes.messageId,
      threadId: thread.id,
    });
  } catch (error) {
    console.error("Send email error:", error);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}
