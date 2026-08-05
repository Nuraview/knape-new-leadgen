/**
 * Follow-up dispatcher — the thing that actually SENDS the queued steps.
 *
 * The composer writes mkt_sequence_items with status "scheduled" and the
 * dashboard shows them under "Active follow-ups" — but nothing on this stack
 * ever sent them. Legacy dispatched via Inngest sleep-until events, and those
 * were already lost before the migration: the stuck rows found in production
 * were 23–45 days overdue (June 13, July 5). The queue looked alive on the
 * dashboard and was dead underneath, on both stacks.
 *
 * Logic is ported from inngest/functions/marketing/process-followup.ts and the
 * cron sweeper, minus the sleep: this runs from the in-app croner every 5
 * minutes and picks up whatever is due. Same rules — active sequence only, not
 * already sent, exclusion list honoured, reply-threading headers when the step
 * carries the original Message-ID, tracked through mkt_emails so opens and
 * clicks count on the dashboard like any other send.
 *
 * ONE RULE THE LEGACY CODE DID NOT HAVE: a staleness cutoff. A step more than
 * MAX_LATE_HOURS overdue is marked "cancelled", never sent. "Just following
 * up" arriving 45 days after the thread died reads as a broken robot, burns
 * sender reputation, and cannot be unsent — cancelling is recoverable, sending
 * is not. The seven rows stuck from June/July get cancelled by this rule on
 * the first run, visibly, with the reason recorded.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import crmDb from "../database/crm";
import {
  mktSequenceItems,
  mktSequences,
} from "../database/crm-schema";
import {
  EMAIL_SIGNATURE_HTML,
  EMAIL_SIGNATURE_TEXT,
} from "../marketing/lib/email-signature";
import { sendTrackedFollowup } from "../marketing/lib/followup-tracking";
import { rowsOf } from "../database/rows";

const MAX_LATE_HOURS = 72;
/** Per-run cap so a backlog cannot turn one tick into a mail cannon. */
const BATCH_LIMIT = 20;

export async function processMarketingFollowups() {
  const due = await crmDb
    .select({ item: mktSequenceItems, sequence: mktSequences })
    .from(mktSequenceItems)
    .innerJoin(mktSequences, eq(mktSequences.id, mktSequenceItems.sequenceId))
    .where(
      and(
        inArray(mktSequenceItems.status, ["scheduled", "pending"]),
        lte(mktSequenceItems.scheduledAt, new Date()),
      ),
    )
    .limit(BATCH_LIMIT);

  if (due.length === 0) return;

  let sent = 0;
  let cancelled = 0;

  for (const { item, sequence } of due) {
    const mark = (status: string, note?: string) =>
      crmDb
        .update(mktSequenceItems)
        .set({
          status,
          updatedAt: new Date(),
          ...(note ? { parentMessageId: item.parentMessageId } : {}),
        })
        .where(eq(mktSequenceItems.id, item.id));

    // Sequence paused or stopped: leave the row alone so resuming works.
    if (sequence.status !== "active") continue;

    // Staleness cutoff — see the header. Cancelling is recoverable.
    const lateMs = Date.now() - new Date(item.scheduledAt).getTime();
    if (lateMs > MAX_LATE_HOURS * 3600_000) {
      await mark("cancelled");
      cancelled++;
      console.log(
        `[followups] cancelled #${item.id} to ${item.contactEmail} — ${Math.round(lateMs / 86400_000)} days overdue`,
      );
      continue;
    }

    // Exclusion list (unsubscribes and manual stops).
    // rowsOf, not a destructure: node-postgres hands back a QueryResult
    // object, and `const [x] = result` throws "object is not iterable" on it.
    // This path only runs for non-stale rows, which is why it never fired.
    const excluded = rowsOf(
      await crmDb.execute(
        sql`SELECT 1 FROM mkt_sequence_exclusions WHERE email = ${item.contactEmail} LIMIT 1`,
      ),
    );
    if (excluded.length > 0) {
      await mark("cancelled");
      cancelled++;
      continue;
    }

    // Threading: with the original Message-ID the step lands as a reply in the
    // same thread; without one it goes standalone under the original subject.
    const isReply = Boolean(item.messageIdHeader);
    const subject = isReply
      ? `Re: ${item.subject || "Following up"}`
      : item.subject || "Following up";
    let bodyHtml =
      item.bodyHtml ||
      item.body?.replace(/\n/g, "<br>") ||
      "<p>Following up on my previous email.</p>";
    bodyHtml = `${bodyHtml}<br/><br/>${EMAIL_SIGNATURE_HTML}`;
    const bodyText = `${item.body || "Following up on my previous email."}\n\n${EMAIL_SIGNATURE_TEXT}`;

    const r = await sendTrackedFollowup({
      to: item.contactEmail,
      subject,
      bodyHtml,
      bodyText,
      senderId: sequence.initiatorUserId ?? null,
      accountId: sequence.senderId ?? null,
      headers: {
        ...(isReply
          ? {
              "In-Reply-To": item.messageIdHeader as string,
              References: item.messageIdHeader as string,
            }
          : {}),
        "X-Sequence-ID": String(sequence.id),
        "X-Sequence-Step": String(item.stepNumber),
      },
    });

    if (r.error) {
      await mark("failed");
      console.error(`[followups] #${item.id} failed:`, r.error);
      continue;
    }

    await crmDb
      .update(mktSequenceItems)
      .set({
        status: "sent",
        sentAt: new Date(),
        resendId: r.messageId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(mktSequenceItems.id, item.id));
    sent++;
  }

  console.log(
    `[followups] processed ${due.length}: ${sent} sent, ${cancelled} cancelled`,
  );
}

export default processMarketingFollowups;
