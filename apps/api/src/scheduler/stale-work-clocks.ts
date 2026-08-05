/**
 * Work-clock accountability (client meeting 2026-07-29).
 *
 * WHAT THIS USED TO DO: close an entry whose owner stopped answering, crediting
 * up to the last confirmed prompt. Honest but toothless — a shut laptop cost
 * you the tail of the session and nothing more, and `prompt_misses` was written
 * 0 and never incremented, so `MAX_PROMPT_MISSES` was exported and never read.
 *
 * WHAT VK ASKED FOR: the prompt fires every 25 minutes and you have 5 minutes
 * to answer. Miss it and you lose 15 — the 5-minute grace you were given plus a
 * 10-minute penalty — and the clock PAUSES until you come back and restart it.
 * He gets a WhatsApp when that happens; disputes are settled by talking to him.
 *
 * WHY PAUSE RATHER THAN CLOSE: closing ends the day. Pausing says "you were
 * away", keeps the session open, and makes restarting a deliberate act. That
 * distinction matters to whoever reads the timesheet afterwards.
 *
 * The penalty is capped at what was actually accrued — an entry that has run
 * seven minutes cannot be docked fifteen and go negative. Under-crediting is a
 * conversation; a negative timesheet is a bug report.
 */
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import crmDb from "../database/crm";
import { rowsOf } from "../database/rows";
import { notifyOwners } from "./notify-owners";
import { resolveCrmActorId } from "../lead/crm-actor";
import { sendPushToUser } from "../dialer/push";
import db from "../database";
import {
  timeEntryTable,
  userTable,
  time_entry_work as workTable,
} from "../database/schema";

/** Prompt cadence on the client (work-clock.tsx PROMPT_INTERVAL_MS). */
const PROMPT_MINUTES = 25;
/** How long they get to answer before it counts as away. */
const GRACE_MINUTES = 5;
/** Docked on top of the grace — VK: "10 minutes plus just five minutes". */
const PENALTY_MINUTES = 10;

const TOTAL_DEDUCTION_SECONDS = (GRACE_MINUTES + PENALTY_MINUTES) * 60;

/*
 * ESCALATION. A flat penalty is a price list: miss the prompt, pay 15 minutes,
 * repeat all day. Repeat offences cost more, so ignoring it stops being a
 * viable strategy while a single genuine miss stays cheap.
 *
 *   1st in a session   15 min   (5 grace + 10)
 *   2nd                25 min
 *   3rd and beyond     40 min
 */
function deductionFor(misses: number): number {
  if (misses <= 0) return TOTAL_DEDUCTION_SECONDS;
  if (misses === 1) return 25 * 60;
  return 40 * 60;
}

/*
 * HARD CEILING on what one session can bank without a confirmation.
 *
 * Accrual previously stopped whenever the cron happened to notice, so the
 * credit depended on scheduler timing rather than on a rule. Now a session can
 * never credit more than one prompt window plus the grace beyond its last
 * confirmed answer — no client behaviour, pause timing or cron delay can
 * exceed it.
 */
const MAX_UNCONFIRMED_SECONDS = (PROMPT_MINUTES + GRACE_MINUTES) * 60;

/**
 * Unanswered once the prompt window plus the grace has elapsed since the last
 * confirmation. Derived from the constants above rather than hard-coded, so
 * changing the cadence moves this with it.
 */
const UNANSWERED_AFTER = sql`now() - (${PROMPT_MINUTES + GRACE_MINUTES} || ' minutes')::interval`;

/** Tell the owner. Never throws — a failed alert must not abort the penalty. */
async function notifyOwner(who: string, minutes: number, sawPrompt: boolean) {
  const raw = process.env.WHATSAPP_RECIPIENTS ?? "";
  // "VK:+9195…,AbdulMateen:+9193…" — the owner is the first entry.
  const first = raw.split(",")[0] ?? "";
  const number = first.slice(first.indexOf(":") + 1).trim();
  if (!number) return;

  const jid = `${number.replace(/^\+/, "")}@s.whatsapp.net`;
  const body = sawPrompt
    ? `${who}'s work clock was paused — no answer to the "are you working?" prompt. ${minutes} minutes deducted.`
    : `${who}'s work clock was paused. The prompt never reached their browser (tab closed), so NO time was deducted.`;

  try {
    await crmDb.execute(
      sql`INSERT INTO whatsapp_outbox (to_jid, body) VALUES (${jid}, ${body})`,
    );
  } catch (error) {
    console.error("[work-clock] WhatsApp alert failed:", error);
  }

  /*
   * And push it. WhatsApp has been the only channel here, and it has been
   * unpaired since 13 July — so every one of these alerts since then reached
   * nobody. Push goes to admins ONLY: the team should not be told when a
   * colleague's clock pauses.
   */
  if (tabOpenButNoPrompt) {
    await notifyOwners({
      title: `⚠️ Prompt never displayed for ${who}`,
      body:
        `${who}'s tab was open but the app never displayed the due "are you working?" prompt, ` +
        "so no time was deducted. Either the client failed to show it or it was suppressed — worth a look.",
      url: "/team",
      tag: "work-clock-owner",
    });
  }

  await notifyOwners({
    title: sawPrompt
      ? `⏸ ${who}'s clock paused — ${minutes}m deducted`
      : `⏸ ${who}'s clock paused (no deduction)`,
    body,
    url: "/team",
    tag: "work-clock-owner",
  });
}

/*
 * THE PENALTY REQUIRES EVIDENCE THE PROMPT WAS SEEN.
 *
 * 2026-07-29: people were docked 15 minutes for not answering a prompt that was
 * never shown to them. The prompt only fires while the CRM tab is open — close
 * the tab, or leave it backgrounded where the browser throttles timers, and no
 * prompt appears. The server did not know that and docked them anyway.
 *
 * Punishing someone for our delivery failure is worse than not enforcing at
 * all: it is money out of their pocket for a bug they cannot see, and it
 * destroys trust in every number the system reports.
 *
 * So the rule is now: dock ONLY when the client told us it actually displayed
 * a prompt (promptShownAt) and the person then did not answer it. No evidence
 * of delivery, no penalty — the clock still pauses so nothing over-accrues,
 * but nobody loses time they worked.
 *
 * WORK_CLOCK_PENALTY_ENABLED=false disables deductions entirely without a
 * deploy, which is the switch to reach for if this is ever wrong again.
 */
function penaltiesEnabled(): boolean {
  return process.env.WORK_CLOCK_PENALTY_ENABLED !== "false";
}

/**
 * Could we actually have reached this person while their tab sat unattended?
 *
 * The prompt only renders in an OPEN, FOREGROUND tab. Web push is the only way
 * it reaches someone who stepped away — so with no push subscription there is
 * no channel, and "you ignored the prompt" is not a claim we can make.
 *
 * This is the rule that would have prevented the whole 2026-07-29 mess: push was
 * undeliverable to everyone (the hook was mounted on one page, and every
 * subscription was bound to a dead VAPID key), yet penalties were handed out all
 * day. Mateen, Muadh and Javed still had no subscription at all. Charging
 * someone for our delivery failure is worse than not enforcing — it is money out
 * of their pocket for a bug they cannot see.
 *
 * Fails CLOSED on error: if we cannot prove a channel existed, no penalty.
 */
async function isReachable(email: string | null): Promise<boolean> {
  if (!email) return false;
  try {
    const crmUserId = await resolveCrmActorId(email);
    if (!crmUserId) return false;
    const rows = rowsOf(
      await crmDb.execute(
        sql`SELECT 1 FROM dialer_push_subscriptions
             WHERE user_id = ${crmUserId} LIMIT 1`,
      ),
    );
    return rows.length > 0;
  } catch (error) {
    console.error("[work-clock] reachability check failed:", error);
    return false;
  }
}

export async function closeStaleWorkClocks() {
  const stale = await db
    .select({
      id: workTable.id,
      userId: workTable.userId,
      startedAt: workTable.startedAt,
      lastPromptAt: workTable.lastPromptAt,
      promptMisses: workTable.promptMisses,
      penaltySeconds: workTable.penaltySeconds,
      promptShownAt: workTable.promptShownAt,
      lastSeenAt: workTable.lastSeenAt,
      currentTaskId: workTable.currentTaskId,
      name: userTable.name,
      email: userTable.email,
    })
    .from(workTable)
    .innerJoin(userTable, eq(userTable.id, workTable.userId))
    .where(
      and(
        isNull(workTable.endedAt),
        // Already paused: not accruing, so there is nothing further to dock.
        isNull(workTable.pausedAt),
        lt(workTable.lastPromptAt, UNANSWERED_AFTER),
      ),
    );

  if (stale.length === 0) return;

  const now = new Date();

  for (const row of stale) {
    // Never before the start: a row whose lastPromptAt somehow predates its own
    // start would otherwise produce a negative duration.
    const anchor =
      row.lastPromptAt && row.lastPromptAt > row.startedAt
        ? row.lastPromptAt
        : row.startedAt;

    const accrued = Math.max(
      0,
      Math.floor((now.getTime() - new Date(row.startedAt).getTime()) / 1000),
    );
    /*
     * Was a prompt actually PUT IN FRONT OF THEM since their last confirmation?
     * promptShownAt is written by the client at the moment it renders the card.
     * If it is missing or older than the last answer, the person never saw one
     * — that is our failure to deliver, not theirs to ignore.
     */
    /*
     * A DEDUCTION REQUIRES PROOF THE PROMPT WAS ON SCREEN. Nothing else counts.
     *
     * This briefly accepted a fresh lastSeenAt as a substitute, reasoning that an
     * open, heartbeating tab must have rendered the prompt. That reasoning was
     * wrong, and it cost people real money on 2026-07-30: the client's prompt
     * timer was anchored to component mount, deploy-triggered auto-reload
     * restarted it ten times that day, and prompt_shown_at was NULL on EVERY row
     * in production — not one prompt had ever been displayed. The heartbeat was
     * true the whole time, so the server docked people for ignoring prompts that
     * our own reload had suppressed.
     *
     * A heartbeat proves the TAB IS OPEN. It does not prove a prompt rendered,
     * and conflating the two turns any client-side prompt bug into a silent wage
     * deduction. Only the client can attest to what it drew, so only
     * promptShownAt gates the penalty.
     */
    const promptWindowStart = row.lastPromptAt ?? row.startedAt;
    const sawPrompt =
      row.promptShownAt != null && row.promptShownAt > promptWindowStart;

    /*
     * The abuse case this leaves open — suppress /prompt-shown and never be
     * charged — is handled by REPORTING rather than by charging. An open tab that
     * never displayed a due prompt is either our bug or their tampering; both are
     * worth the owner's attention, and neither is worth quietly taking money for
     * on a guess.
     */
    const tabOpenButNoPrompt =
      !sawPrompt &&
      row.lastSeenAt != null &&
      row.lastSeenAt.getTime() >
        new Date(promptWindowStart).getTime() + PROMPT_MINUTES * 60_000;

    /*
     * Both conditions must hold: the app was demonstrably in front of them, AND
     * a notification channel existed to catch them if it was not.
     */
    const reachable = await isReachable(row.email);

    const deduction =
      penaltiesEnabled() && sawPrompt && reachable
        ? Math.min(
            deductionFor(row.promptMisses),
            Math.max(0, accrued - row.penaltySeconds),
          )
        : 0;

    // Close the per-task entry at the last confirmed point so a task does not
    // keep billing through the pause, and so the day total and the per-task
    // breakdown cannot disagree.
    const [openTask] = await db
      .select({ id: timeEntryTable.id, startTime: timeEntryTable.startTime })
      .from(timeEntryTable)
      .where(
        and(
          eq(timeEntryTable.userId, row.userId),
          isNull(timeEntryTable.endTime),
        ),
      )
      .limit(1);

    if (openTask) {
      const taskEnd = anchor > openTask.startTime ? anchor : openTask.startTime;
      await db
        .update(timeEntryTable)
        .set({
          endTime: taskEnd,
          duration: Math.max(
            0,
            Math.round(
              (taskEnd.getTime() - new Date(openTask.startTime).getTime()) / 1000,
            ),
          ),
        })
        .where(eq(timeEntryTable.id, openTask.id));
    }

    /*
     * Cap the pause point. Crediting to "whenever the cron ran" let a late tick
     * hand out minutes nobody worked; capping to the last confirmation plus one
     * window makes the credit a property of the rules, not of scheduler luck.
     */
    const ceiling = new Date(
      new Date(promptWindowStart).getTime() + MAX_UNCONFIRMED_SECONDS * 1000,
    );
    const pausePoint = now < ceiling ? now : ceiling;

    await db
      .update(workTable)
      .set({
        pausedAt: pausePoint,
        penaltySeconds: row.penaltySeconds + deduction,
        promptMisses: row.promptMisses + 1,
        endedReason: "prompt_unanswered_paused",
        currentTaskId: null,
      })
      .where(eq(workTable.id, row.id));

    /*
     * TELL THE PERSON THEIR CLOCK STOPPED, with a Resume button on it.
     *
     * Until now only the owner heard about a pause. The employee found out by
     * happening to look at the sidebar — which for anyone away from the tab means
     * finding out much later, having earned nothing in between. VK: they should
     * not have to go into the app to resume.
     *
     * The work_clock_paused type is what makes the service worker attach the
     * Resume action, and the worker completes it without a window.
     */
    const crmUserId = await resolveCrmActorId(row.email).catch(() => null);
    if (crmUserId) {
      await sendPushToUser(crmUserId, {
        type: "work_clock_paused",
        title: "⏸ Your work clock is paused",
        body: deduction > 0
          ? `${Math.round(deduction / 60)} minutes were deducted. Resume from here — no need to open the app.`
          : "No time was deducted. Resume from here — no need to open the app.",
        url: "/dashboard",
        tag: "work-clock-paused",
        timestamp: new Date().toISOString(),
      }).catch((error) => {
        console.error("[work-clock] paused push failed:", error);
      });
    }

    // Say WHICH it was, so the owner can tell "ignored a prompt" from "we
    // never managed to show one".
    await notifyOwner(
      row.name || row.email || "An employee",
      Math.round(deduction / 60),
      sawPrompt,
    );

    console.log(
      `[work-clock] paused ${row.email} — ${
        !reachable
          ? "NO deduction: no push subscription, so we had no way to reach them"
          : sawPrompt
            ? `prompt unanswered, ${Math.round(deduction / 60)}m deducted`
            : tabOpenButNoPrompt
              ? "NO deduction: tab was open but the client never displayed a due prompt (client fault or tampering — reported, not charged)"
              : "prompt was never displayed, NO deduction"
      }`,
    );
  }
}

export default closeStaleWorkClocks;
