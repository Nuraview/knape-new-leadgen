import { NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { inngest } from "@/inngest/client";
import { db } from "@/lib/db";
import {
  mktContacts as contacts,
  mktEmails as emails,
  mktFolders as folders,
  mktSequenceItems as sequenceItems,
  mktSequences as sequences,
  mktThreadFolders as threadFolders,
  mktThreads as threads,
  mktUsers as users,
} from "@/lib/db";
import {
  wrapTextWithSignature,
  wrapWithSignature,
} from "@/lib/marketing/email-signature";
import { REPLY_TO } from "@/lib/marketing/resend";
import { sendMarketingEmail } from "@/lib/marketing/email-provider";
import { resolveEmailSender } from "@/lib/email-senders";
import { resolveSendingAccountId } from "@/lib/marketing/sending-accounts";
import { verifyEmail } from "@/lib/marketing/reacher";
import { resolveSenderId } from "@/lib/marketing/sender";
import { injectTracking } from "@/lib/marketing/tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const {
      to,
      cc,
      bcc,
      subject,
      firstName,
      personalLine,
      portfolioLink,
      loomLink,
      bodyHtml,
      bodyText,
      includeSignature = true,
      enableFollowup = false,
      followup1Body = "Just following up on my previous email.",
      followup2Body = "Wanted to check if you had a chance to review my previous message.",
      followup3Body = "This is my final follow-up. Would love to hear from you!",
      fromSenderId,
    } = body;

    if (!to || !subject) {
      return NextResponse.json(
        { error: "Missing required fields: to, subject" },
        { status: 400 },
      );
    }

    const senderId = await resolveSenderId();
    // Chosen "from" identity (undefined → A/B random in the provider router).
    const chosen = resolveEmailSender(fromSenderId);

    const hasCustomBody = bodyText && !bodyHtml;
    let htmlContent =
      bodyHtml || (hasCustomBody ? bodyText.replace(/\n/g, "<br>") : undefined);
    let textContent = bodyText || undefined;

    const capEmbedLib = await import("@/lib/videos/cap-embed");

    // Users habitually paste Cap's iframe embed code straight into the body
    // (it can never render in email). Strip those dead blocks and use the
    // video they reference as the video link when none was provided.
    let effectiveLoomLink: string | undefined = loomLink || undefined;
    if (htmlContent) {
      const rescued = capEmbedLib.rescueCapEmbedFromBody(htmlContent);
      if (rescued) {
        htmlContent = rescued.cleaned;
        effectiveLoomLink = effectiveLoomLink || rescued.shareUrl;
      }
    }
    if (textContent) {
      const rescuedText = capEmbedLib.rescueCapEmbedFromBody(textContent);
      if (rescuedText) {
        textContent = rescuedText.cleaned;
        effectiveLoomLink = effectiveLoomLink || rescuedText.shareUrl;
      }
    }
    const isCapLink = Boolean(
      effectiveLoomLink && capEmbedLib.extractCapVideoId(effectiveLoomLink),
    );

    if (!htmlContent) {
      const React = await import("react");
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { EmailTemplate } = await import(
        "@/components/marketing/email-template"
      );
      htmlContent = renderToStaticMarkup(
        React.createElement(EmailTemplate, {
          firstName: firstName || "there",
          personalLine,
          portfolioLink,
          // Cap links become a GIF card below; keep the template's plain
          // "Watch Loom" link only for legacy non-Cap URLs.
          loomLink: isCapLink ? undefined : loomLink,
        }),
      );
    }

    // Cap video → clickable GIF-thumbnail card appended to the body (before
    // signature/unsubscribe so it reads as part of the message). Resolution
    // failures degrade to a plain styled link — never block the send. The
    // card's <a href> gets click-tracking via injectTracking.
    if (isCapLink && effectiveLoomLink && htmlContent) {
      try {
        const embed = await capEmbedLib.resolveCapEmbed(effectiveLoomLink);
        htmlContent = `${htmlContent}${capEmbedLib.renderVideoCardHtml(embed)}`;
        if (textContent) {
          textContent = `${textContent}\n\n${capEmbedLib.renderVideoCardText(embed)}`;
        }
      } catch (embedErr) {
        console.warn("[MarketingSend] Cap embed failed, using plain link", embedErr);
        htmlContent = `${htmlContent}${capEmbedLib.renderVideoLinkFallbackHtml(effectiveLoomLink)}`;
        if (textContent) {
          textContent = `${textContent}\n\n▶ Watch my video: ${effectiveLoomLink}`;
        }
      }
    }

    const recipientEmail = Array.isArray(to) ? to[0] : to;

    if (includeSignature && htmlContent) {
      htmlContent = wrapWithSignature(htmlContent);
    }
    if (includeSignature && textContent) {
      textContent = wrapTextWithSignature(textContent);
    }

    let [recipient] = await db
      .select()
      .from(users)
      .where(eq(users.email, recipientEmail));

    if (!recipient) {
      [recipient] = await db
        .insert(users)
        .values({ email: recipientEmail, firstName: firstName || null })
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
        firstName: firstName || recipient.firstName || null,
        lastName: null,
        company: null,
        tags: ["outreach"],
      });
    }

    const [thread] = await db
      .insert(threads)
      .values({ subject, lastActivityDate: new Date() })
      .returning();

    const [emailRecord] = await db
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

    const trackedHtml = injectTracking(htmlContent, emailRecord.id);

    // Hard gate: never send to a confirmed-dead mailbox (would bounce).
    const verdict = await verifyEmail(recipientEmail);
    if (verdict.reachable === "invalid") {
      await db
        .update(emails)
        .set({ status: "failed", provider: "smtp" })
        .where(eq(emails.id, emailRecord.id));
      return NextResponse.json(
        { error: "Blocked: recipient mailbox does not exist (SMTP verification) — would bounce." },
        { status: 422 },
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
      await db
        .update(emails)
        .set({ status: "failed", provider: sendResult.provider })
        .where(eq(emails.id, emailRecord.id));
      return NextResponse.json({ error: sendResult.error }, { status: 500 });
    }

    await db
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
      `[Send] Email #${emailRecord.id} sent to ${recipientEmail} via ${sendResult.provider} (${sendResult.messageId})`,
    );

    if (enableFollowup && sendResult.messageId) {
      try {
        const [sequence] = await db
          .insert(sequences)
          .values({
            campaign: "Manual Send",
            initiatorUserId: senderId,
            status: "active",
            senderId: fromSenderId ?? null,
          })
          .returning();

        const delays = [
          { step: 1, delayHours: 6, subject, body: followup1Body },
          { step: 2, delayHours: 24, subject, body: followup2Body },
          { step: 3, delayHours: 36, subject, body: followup3Body },
        ];

        for (const item of delays) {
          const scheduledAt = new Date(
            Date.now() + item.delayHours * 60 * 60 * 1000,
          );

          const [seqItem] = await db
            .insert(sequenceItems)
            .values({
              sequenceId: sequence.id,
              contactEmail: recipientEmail,
              stepNumber: item.step,
              subject: item.subject,
              body: item.body,
              scheduledAt: scheduledAt,
              status: "scheduled",
              messageIdHeader: sendResult.messageId,
              parentMessageId: null,
            })
            .returning();

          await inngest.send({
            name: "marketing/followup",
            data: {
              step: item.step,
              sequenceItemId: seqItem.id,
              scheduledAt: scheduledAt.toISOString(),
            },
          });
        }

        console.log(
          `[Send] Created sequence #${sequence.id} for ${recipientEmail}`,
        );
      } catch (err) {
        console.error("[Send] Failed to create sequence:", err);
      }
    }

    return NextResponse.json({
      success: true,
      provider: sendResult.provider,
      messageId: sendResult.messageId,
      threadId: thread.id,
    });
  } catch (error) {
    console.error("Send email error:", error);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 },
    );
  }
}
