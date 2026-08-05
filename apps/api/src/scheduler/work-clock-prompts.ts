/**
 * Push the 30-minute "Are you still working?" prompt to a closed tab.
 *
 * The in-app prompt (components/work-clock.tsx) fires on an interval and raises
 * an OS notification — but only while the tab is alive. A backgrounded tab gets
 * throttled and a closed one does nothing at all, so the timer kept running and
 * closeStaleWorkClocks later clawed the hour back. The person did the work of
 * remembering; the software did not help.
 *
 * TARGETED, never broadcast. Asking the whole company whether they are still
 * working because one laptop slept is how a notification channel gets muted,
 * and a muted channel is worse than no channel — see the liveness alarm for the
 * same reasoning.
 *
 * Identity crosses two id spaces: the work clock keys on the APP user id
 * (nanoid text), push subscriptions key on the CRM actor id (uuid). Email is
 * the only thing both sides share, so the join goes through it.
 */
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import db from "../database";
import { time_entry_work as workTable, userTable } from "../database/schema";
import { resolveCrmActorId } from "../lead/crm-actor";
import { sendPushToUser } from "../dialer/push";

/**
 * Nudge once the last confirmation is over 30 minutes old.
 *
 * 32 rather than 30: the in-app prompt owns the happy path, and this exists
 * only for the tab that is not there to fire it. The two minutes stop a push
 * racing a prompt the person is already looking at.
 */
const PROMPT_AFTER = sql`now() - interval '32 minutes'`;

/**
 * Stop nudging once the clock is stale enough that closeStaleWorkClocks will
 * close it (65 min). Past that the answer is not "are you working?" — it is
 * "your clock was closed", and pushing both is noise.
 */
const GIVE_UP_AFTER = sql`now() - interval '65 minutes'`;

export async function pushWorkClockPrompts() {
  const due = await db
    .select({
      userId: workTable.userId,
      lastPromptAt: workTable.lastPromptAt,
      email: userTable.email,
      name: userTable.name,
    })
    .from(workTable)
    .innerJoin(userTable, eq(userTable.id, workTable.userId))
    .where(
      and(
        isNull(workTable.endedAt),
        lt(workTable.lastPromptAt, PROMPT_AFTER),
        sql`${workTable.lastPromptAt} > ${GIVE_UP_AFTER}`,
      ),
    );

  if (due.length === 0) return;

  let sent = 0;
  for (const row of due) {
    const crmUserId = await resolveCrmActorId(row.email);
    // No CRM actor means no subscription can be keyed to them — the in-app
    // prompt still covers this person while their tab is open.
    if (!crmUserId) continue;

    const result = await sendPushToUser(crmUserId, {
      // Not "generic": this type is what makes the service worker attach the
      // "Yes, working" / "Stop clock" buttons, so it can be answered from the
      // notification without opening the app at all.
      type: "work_clock_prompt",
      title: "Still working?",
      body: "Answer here — no need to open the app. 15 minutes is deducted if this goes unanswered.",
      url: "/dashboard",
      tag: "work-clock-prompt",
      timestamp: new Date().toISOString(),
    });
    sent += result.sent;
  }

  if (sent > 0) {
    console.log(`[work-clock] pushed ${sent} prompt(s) to closed tabs`);
  }
}

export default pushWorkClockPrompts;
