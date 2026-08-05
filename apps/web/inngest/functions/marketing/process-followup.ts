import { eq } from "drizzle-orm";

import { inngest } from "@/inngest/client";
import {
  db,
  mktSequenceExclusions as sequenceExclusions,
  mktSequenceItems as sequenceItems,
  mktSequences as sequences,
} from "@/lib/db";
import {
  EMAIL_SIGNATURE_HTML,
  EMAIL_SIGNATURE_TEXT,
} from "@/lib/marketing/email-signature";
import { sendTrackedFollowup } from "@/lib/marketing/followup-tracking";

// Self-hosted replacement for the QStash-scheduled follow-up sender.
//
// Was: scheduleFollowUp() → QStash publishJSON with a delay → callback POST to
// /api/marketing/queue/followup. Now: senders emit `marketing/followup` and this
// function sleeps until `scheduledAt`, then runs the exact same send + status
// logic the callback route did. Inngest signs its own calls (INNGEST_SIGNING_KEY),
// so the QStash signature dance is gone.
//
// The cron sweeper (app/api/cron/marketing-followups) stays as the idempotent
// backstop — both skip items already marked "sent".
export const marketingProcessFollowUp = inngest.createFunction(
  {
    id: "marketing-process-follow-up",
    name: "Marketing: Process Follow-up",
    triggers: [{ event: "marketing/followup" }],
  },
  async ({ event, step }) => {
    const { sequenceItemId, step: stepNumber, scheduledAt } = event.data as {
      sequenceItemId: number;
      step: number;
      scheduledAt: string;
    };

    if (!sequenceItemId) {
      return { error: "Missing sequenceItemId" };
    }

    // Wait until the follow-up is due (was QStash's `delay`).
    await step.sleepUntil("wait-for-follow-up-time", new Date(scheduledAt));

    // Re-load inside a step so a replay after the sleep re-reads fresh state
    // (the sequence may have been paused/cancelled while we slept).
    const itemResult = await step.run("load-item", async () => {
      const [row] = await db
        .select({ item: sequenceItems, sequence: sequences })
        .from(sequenceItems)
        .innerJoin(sequences, eq(sequences.id, sequenceItems.sequenceId))
        .where(eq(sequenceItems.id, sequenceItemId));
      return row ?? null;
    });

    if (!itemResult) return { error: "Item not found" };
    const { item, sequence } = itemResult;

    if (sequence.status !== "active") {
      return { skipped: true, reason: "Sequence not active" };
    }
    if (item.status === "sent") {
      return { skipped: true, reason: "Already sent" };
    }

    const excluded = await step.run("check-exclusion", async () => {
      const [row] = await db
        .select()
        .from(sequenceExclusions)
        .where(eq(sequenceExclusions.email, item.contactEmail));
      return Boolean(row);
    });
    if (excluded) return { cancelled: true, reason: "Excluded" };

    // A follow-up replies into the thread only when it carries the Message-ID of
    // the email it's replying to. Otherwise it's sent STANDALONE with the
    // original subject verbatim (no "Re:", no threading headers).
    const isReply = Boolean(item.messageIdHeader);
    const subject = isReply
      ? `Re: ${item.subject || "Following up"}`
      : item.subject || "Following up";
    let bodyHtml =
      item.bodyHtml ||
      item.body?.replace(/\n/g, "<br>") ||
      "<p>Following up on my previous email.</p>";
    bodyHtml = `${bodyHtml}<br/><br/>${EMAIL_SIGNATURE_HTML}`;
    const bodyText = item.body || "Following up on my previous email.";
    const bodyTextWithFooter = `${bodyText}\n\n${EMAIL_SIGNATURE_TEXT}`;

    const r = await step.run("send-followup", async () => {
      return sendTrackedFollowup({
        to: item.contactEmail,
        subject,
        bodyHtml,
        bodyText: bodyTextWithFooter,
        senderId:
          (sequence as { initiatorUserId?: number | null }).initiatorUserId ??
          null,
        accountId: (sequence as { senderId?: string | null }).senderId ?? null,
        headers: {
          ...(isReply
            ? {
                "In-Reply-To": item.messageIdHeader as string,
                References: item.messageIdHeader as string,
              }
            : {}),
          "X-Sequence-ID": String(sequence.id),
          "X-Sequence-Step": String(stepNumber),
        },
      });
    });

    if (r.error) {
      await step.run("mark-failed", async () => {
        await db
          .update(sequenceItems)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(sequenceItems.id, sequenceItemId));
      });
      return { error: r.error };
    }

    await step.run("mark-sent", async () => {
      await db
        .update(sequenceItems)
        .set({
          status: "sent",
          sentAt: new Date(),
          resendId: r.messageId || null,
          updatedAt: new Date(),
        })
        .where(eq(sequenceItems.id, sequenceItemId));
    });

    return { success: true, messageId: r.messageId };
  },
);
