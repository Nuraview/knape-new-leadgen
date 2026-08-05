/**
 * Voluntary work-time tracking (client meeting 2026-07-28).
 *
 * An employee clocks in and out themselves. Every 30 minutes the browser asks
 * "Are you working?"; answering No stops the timer, and not answering at all
 * eventually stops it too. The point of the prompt is that a forgotten timer
 * should not quietly bill eight hours — not to police anybody.
 *
 * Explicitly NOT WebWork-style monitoring. No screenshots, no mouse/keyboard
 * idle detection. VK raised that and then set it aside as "maybe in the
 * future"; building it now because it was mentioned would be a meaningful
 * change to how staff are watched, off the back of a passing remark.
 *
 * Hours are visible to the person who logged them and to admins. Everyone
 * else sees nothing.
 */
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  projectMemberTable,
  projectTable,
  taskTable,
  timeEntryTable,
  time_entry_work as workTable,
  userAccessTable,
} from "../database/schema";
import {
  canAccessProjects,
  getUserWorkspaceRole,
} from "../utils/require-crm-access";
import { notifyOwnerWhatsapp } from "../notification/whatsapp";
import { userTable } from "../database/schema";

/**
 * Clock events go to the OWNER's WhatsApp (meeting 2026-07-30, VK: "the
 * moment you start the clock, I would like to get a message that Afham has
 * started… Shantanu has paused the clock"). Pause alerts already come from
 * the watchdog; start/resume/stop are the user-driven ones and belong here.
 * Fire-and-forget: a WhatsApp hiccup must never fail the clock action.
 */
function notifyClockEvent(userId: string, line: (who: string) => string) {
  void (async () => {
    const [u] = await db
      .select({ name: userTable.name, email: userTable.email })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    await notifyOwnerWhatsapp(
      line(u?.name || u?.email || "Someone"),
      "nuraview-app:work-clock",
    );
  })().catch(() => {});
}

/**
 * How long an unanswered prompt may sit before we assume the person walked
 * away. Two missed prompts is roughly an hour, which is long enough to survive
 * a lunch break or a meeting in another tab.
 */
const MAX_PROMPT_MISSES = 2;

async function isAdmin(userId: string): Promise<boolean> {
  const role = await getUserWorkspaceRole(userId);
  return role === "owner" || role === "admin";
}

/** The open entry for a user, if any. */
async function openEntry(userId: string) {
  const [row] = await db
    .select()
    .from(workTable)
    .where(and(eq(workTable.userId, userId), isNull(workTable.endedAt)))
    .orderBy(desc(workTable.startedAt))
    .limit(1);
  return row ?? null;
}

/**
 * Close the open per-task entry, if any.
 *
 * `time_entry` is Kaneo's own table, with `duration` in SECONDS alongside the
 * timestamps. Both are written so the existing task-level readers (which sort
 * on duration) keep working without needing to recompute from the pair.
 */
async function closeOpenTaskEntry(userId: string, at: Date) {
  const [open] = await db
    .select()
    .from(timeEntryTable)
    .where(
      and(eq(timeEntryTable.userId, userId), isNull(timeEntryTable.endTime)),
    )
    .orderBy(desc(timeEntryTable.startTime))
    .limit(1);

  if (!open) return null;

  const seconds = Math.max(
    0,
    Math.round((at.getTime() - new Date(open.startTime).getTime()) / 1000),
  );

  await db
    .update(timeEntryTable)
    .set({ endTime: at, duration: seconds })
    .where(eq(timeEntryTable.id, open.id));

  return open.id;
}

const timeTracking = new Hono<{
  Variables: { userId: string; userEmail: string };
}>()
  /** Am I on the clock, and for how long today? */
  .get("/me", async (c) => {
    const userId = c.get("userId");
    const open = await openEntry(userId);

    /*
     * Heartbeat. The work clock polls this every 60 seconds, so a recent
     * lastSeenAt proves the TAB WAS OPEN — which means the prompt was rendered.
     *
     * This is server-observed, and that is the point. The penalty used to hang
     * on the client POSTing /prompt-shown, which anyone could block to buy
     * permanent immunity. You cannot suppress this one without also stopping
     * the polling that makes you look present, so the cheat and the tell are
     * the same action.
     */
    if (open) {
      await db
        .update(workTable)
        .set({ lastSeenAt: new Date() })
        .where(eq(workTable.id, open.id));
    }

    /*
     * "Today" is the TEAM's day, and an entry contributes its OVERLAP with it.
     *
     * This used to be `started_at >= date_trunc('day', now())` — entries
     * STARTED since UTC midnight. Two failures, both real:
     *
     *   1. UTC midnight is 5:30 AM IST — the middle of the team's working
     *      night. VK's running session (started 18:08 UTC, still open the next
     *      morning) stopped matching the filter the moment the date rolled
     *      over, and his sidebar read "0h 00m" while the DB held an open,
     *      heartbeating entry. "The clock is showing zero" — it was never
     *      stopped; the SUM just refused to see it.
     *
     *   2. Even with a better zone, filtering on started_at attributes zero of
     *      an overnight session to the day it ran into.
     *
     * So: bucket by wall-clock midnight in WORK_TZ, and count each entry's
     * intersection with today. GREATEST(0, …) keeps a penalised row from going
     * negative and eating time earned by other rows.
     */
    const tzRaw = process.env.WORK_TZ || process.env.LOCAL_TZ || "Asia/Kolkata";
    const dayStart = sql`(date_trunc('day', now() AT TIME ZONE ${tzRaw}) AT TIME ZONE ${tzRaw})`;

    const [today] = await db
      .select({
        // A PAUSED entry stops accruing at pausedAt, and the accountability
        // penalty comes off the total — same rules as before, applied to the
        // in-window slice.
        seconds: sql<number>`COALESCE(SUM(GREATEST(0,
          EXTRACT(EPOCH FROM (
            COALESCE(${workTable.endedAt}, ${workTable.pausedAt}, now())
            - GREATEST(${workTable.startedAt}, ${dayStart})
          ))::int
          - ${workTable.penaltySeconds}
        )), 0)`,
      })
      .from(workTable)
      .where(
        and(
          eq(workTable.userId, userId),
          // Overlaps today: still open, or ended after local midnight.
          gte(
            sql`COALESCE(${workTable.endedAt}, ${workTable.pausedAt}, now())`,
            dayStart,
          ),
        ),
      );

    // The task the clock is attributed to right now, resolved to a title so
    // the sidebar does not need a second round-trip to render it.
    let currentTask: { id: string; title: string } | null = null;
    if (open?.currentTaskId) {
      const [row] = await db
        .select({ id: taskTable.id, title: taskTable.title })
        .from(taskTable)
        .where(eq(taskTable.id, open.currentTaskId))
        .limit(1);
      currentTask = row ?? null;
    }

    return c.json({
      // Paused is NOT running: the clock is not accruing, and the UI must
      // offer "resume" rather than pretend it is still counting.
      running: Boolean(open) && !open?.pausedAt,
      paused: Boolean(open?.pausedAt),
      pausedAt: open?.pausedAt ?? null,
      penaltySeconds: open?.penaltySeconds ?? 0,
      entryId: open?.id ?? null,
      startedAt: open?.startedAt ?? null,
      lastPromptAt: open?.lastPromptAt ?? null,
      secondsToday: Number(today?.seconds ?? 0),
      currentTask,
    });
  })
  /** Clock in. Idempotent — returns the existing entry rather than stacking. */
  .post("/start", async (c) => {
    const userId = c.get("userId");

    const existing = await openEntry(userId);
    if (existing) {
      /*
       * Resuming a paused clock: CLOSE the paused row at its pause point and
       * open a fresh one, never un-pause in place.
       *
       * Un-pausing in place (pausedAt = NULL on the same row) is how VK's
       * overnight zombie happened: every duration formula reads
       * COALESCE(ended_at, paused_at, now()) − started_at, so the moment the
       * pause is cleared the entire paused stretch retroactively becomes
       * "worked". The watchdog paused him twice while he slept with the tab
       * open; one Resume click in the morning converted the whole night into
       * 12+ on-the-clock hours and the Employees page said 16.
       *
       * Closing at pausedAt freezes the pre-pause history exactly as the
       * watchdog left it — penalties included, deliberately NOT refunded —
       * and the new row accrues only from now.
       */
      if (existing.pausedAt) {
        await db
          .update(workTable)
          .set({ endedAt: existing.pausedAt })
          .where(eq(workTable.id, existing.id));

        const [resumedRow] = await db
          .insert(workTable)
          .values({
            userId,
            startedAt: new Date(),
            lastPromptAt: new Date(),
            // The escalation ladder follows the person through the day, not
            // the row — otherwise every pause resets the price of ignoring
            // the next prompt back to the cheap tier.
            promptMisses: existing.promptMisses,
          })
          .returning({ id: workTable.id });

        notifyClockEvent(userId, (who) => `▶️ ${who} resumed their work clock.`);
        return c.json({
          entryId: resumedRow?.id ?? null,
          alreadyRunning: true,
          resumed: true,
        });
      }
      return c.json({ entryId: existing.id, alreadyRunning: true });
    }

    const now = new Date();

    // Someone with a pinned task never has to pick it — the whole point is
    // that their day is one repeating job.
    const [pin] = await db
      .select({ pinnedTaskId: userAccessTable.pinnedTaskId })
      .from(userAccessTable)
      .where(eq(userAccessTable.userId, userId))
      .limit(1);

    const [created] = await db
      .insert(workTable)
      .values({
        userId,
        startedAt: now,
        lastPromptAt: now,
        currentTaskId: pin?.pinnedTaskId ?? null,
      })
      .returning({ id: workTable.id });

    notifyClockEvent(userId, (who) => `▶️ ${who} started their work clock.`);
    return c.json({ entryId: created?.id ?? null, alreadyRunning: false });
  })
  /** Clock out. `reason` records whether they stopped or the prompt did. */
  /**
   * The browser reports that this user has BLOCKED notifications.
   *
   * Blocking kills the "are you working?" delivery channel that the whole
   * accountability model rests on, so it is not a quiet preference: the open
   * clock (if any) is paused — WITHOUT penalty, this is prevention not
   * punishment — and the owner is told on WhatsApp. The client refuses to
   * start the clock at all in this state, so the pause here only covers
   * "blocked it while already running".
   */
  .post("/notifications-blocked", async (c) => {
    const userId = c.get("userId");
    const open = await openEntry(userId);

    if (open && !open.pausedAt) {
      await closeOpenTaskEntry(userId, new Date());
      await db
        .update(workTable)
        .set({
          pausedAt: new Date(),
          endedReason: "notifications_blocked",
          currentTaskId: null,
        })
        .where(eq(workTable.id, open.id));
    }

    notifyClockEvent(
      userId,
      (who) =>
        `🚫 ${who} has BLOCKED browser notifications on the dashboard. Work-clock prompts cannot reach them${open && !open.pausedAt ? " — their clock was paused (no penalty)" : ", and the clock will not start until they re-enable them"}.`,
    );

    return c.json({ paused: Boolean(open && !open.pausedAt) });
  })
  .post("/stop", async (c) => {
    const userId = c.get("userId");
    const body = await c.req
      .json<{ reason?: string }>()
      .catch(() => ({}) as { reason?: string });

    const open = await openEntry(userId);
    if (!open) return c.json({ stopped: false, reason: "not running" });

    const now = new Date();
    // Close the task entry first. If this threw after the work row was already
    // closed, the task entry would stay open forever and every later rollup
    // would count it as still running.
    await closeOpenTaskEntry(userId, now);

    await db
      .update(workTable)
      .set({
        endedAt: now,
        endedReason: body.reason ?? "manual",
        currentTaskId: null,
      })
      .where(eq(workTable.id, open.id));

    notifyClockEvent(userId, (who) => `⏹ ${who} stopped their work clock.`);
    return c.json({ stopped: true, entryId: open.id });
  })
  /**
   * Point the running clock at a task (or at nothing).
   *
   * Switching is close-then-open, in that order: two open `time_entry` rows for
   * one person would double-count every rollup that sums them.
   *
   * Auto-starts the work clock if it is not running, because "I started working
   * on this task" and "I am working" are the same statement, and making someone
   * press two buttons to say it once is how attribution gets skipped.
   */
  .post("/task", async (c) => {
    const userId = c.get("userId");
    const body = await c.req
      .json<{ taskId?: string | null }>()
      .catch(() => ({}) as { taskId?: string | null });

    const taskId = body.taskId ?? null;
    const now = new Date();

    if (taskId) {
      const [task] = await db
        .select({ id: taskTable.id })
        .from(taskTable)
        .where(eq(taskTable.id, taskId))
        .limit(1);
      if (!task) {
        throw new HTTPException(404, { message: "No such task" });
      }
    }

    let work = await openEntry(userId);
    if (!work) {
      const [created] = await db
        .insert(workTable)
        .values({ userId, startedAt: now, lastPromptAt: now })
        .returning();
      work = created ?? null;
    }
    if (!work) {
      throw new HTTPException(500, { message: "Could not start the clock" });
    }

    await closeOpenTaskEntry(userId, now);

    let entryId: string | null = null;
    if (taskId) {
      const [entry] = await db
        .insert(timeEntryTable)
        .values({ taskId, userId, startTime: now, duration: 0 })
        .returning({ id: timeEntryTable.id });
      entryId = entry?.id ?? null;
    }

    await db
      .update(workTable)
      .set({ currentTaskId: taskId })
      .where(eq(workTable.id, work.id));

    return c.json({ taskId, timeEntryId: entryId, workEntryId: work.id });
  })
  /**
   * Tasks this person could be working on, for the clock's picker.
   *
   * Same visibility rule as the project list (see
   * project/controllers/get-projects.ts) so the picker can never offer a board
   * the API would then refuse:
   *   no project access at all -> NOTHING
   *   owner / admin            -> every project
   *   member WITH assignments  -> only those
   *   member WITHOUT any       -> NOTHING
   *
   * That last line used to read "every project". get-projects.ts was fixed to
   * fail closed and this endpoint was not, so a lead-gen employee with no
   * assignments — Mateen — had every task title and project name in the
   * workspace listed in his sidebar picker, while the Projects nav was
   * correctly hidden from him. Hiding the nav is not access control; this is.
   *
   * One query rather than per-project fetches — this loads in the sidebar on
   * every page, so it has to be cheap. Done tasks are excluded; nobody clocks
   * time against something already finished.
   */
  .get("/tasks", async (c) => {
    const userId = c.get("userId");

    // Denied project access outright (a leads-only account): no picker at all.
    if (!(await canAccessProjects(userId))) return c.json({ items: [] });

    /*
     * A PINNED task collapses the picker to exactly that one entry. VK, about
     * a lead-gen employee: "I just want to put one task, one task alone, which
     * needs to be pre-selected — lead generation." Returning only the pin is
     * the point: fewer choices, not a longer list with a default.
     */
    const [pin] = await db
      .select({ pinnedTaskId: userAccessTable.pinnedTaskId })
      .from(userAccessTable)
      .where(eq(userAccessTable.userId, userId))
      .limit(1);

    if (pin?.pinnedTaskId) {
      const pinned = await db
        .select({
          id: taskTable.id,
          title: taskTable.title,
          status: taskTable.status,
          projectId: taskTable.projectId,
          projectName: projectTable.name,
        })
        .from(taskTable)
        .leftJoin(projectTable, eq(projectTable.id, taskTable.projectId))
        .where(eq(taskTable.id, pin.pinnedTaskId))
        .limit(1);
      return c.json({ items: pinned, pinned: true });
    }

    const role = await getUserWorkspaceRole(userId);

    let projectIds: string[] | null = null;
    if (role !== "owner" && role !== "admin") {
      const assignments = await db
        .select({ projectId: projectMemberTable.projectId })
        .from(projectMemberTable)
        .where(eq(projectMemberTable.userId, userId));

      // No assignments means no tasks. An empty list here must NOT fall through
      // to "unfiltered" — that is exactly how this leaked.
      if (assignments.length === 0) return c.json({ items: [] });
      projectIds = assignments.map((a) => a.projectId);
    }

    const rows = await db
      .select({
        id: taskTable.id,
        title: taskTable.title,
        status: taskTable.status,
        projectId: taskTable.projectId,
        projectName: projectTable.name,
      })
      .from(taskTable)
      .leftJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(
        projectIds
          ? and(
              inArray(taskTable.projectId, projectIds),
              sql`${taskTable.status} <> 'done'`,
            )
          : sql`${taskTable.status} <> 'done'`,
      )
      .orderBy(desc(taskTable.createdAt))
      .limit(300);

    return c.json({ items: rows });
  })
  /**
   * What a person actually spent the day on, grouped by task.
   *
   * Admins may pass ?userId to look at anyone; everybody else only ever sees
   * their own, enforced here rather than by the caller omitting the param.
   */
  .get("/breakdown", async (c) => {
    const viewerId = c.get("userId");
    const requested = c.req.query("userId");
    const days = Math.min(31, Math.max(1, Number(c.req.query("days") ?? "1")));

    let targetId = viewerId;
    if (requested && requested !== viewerId) {
      if (!(await isAdmin(viewerId))) {
        throw new HTTPException(403, {
          message: "Only admins can see another person's breakdown",
        });
      }
      targetId = requested;
    }

    // Named rather than ordered by ordinal: `ORDER BY 2 DESC` pointed at the
    // title column, so the longest task was never first.
    const secondsExpr = sql<number>`COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(${timeEntryTable.endTime}, now()) - ${timeEntryTable.startTime})))::int, 0)`;

    const rows = await db
      .select({
        taskId: timeEntryTable.taskId,
        title: taskTable.title,
        projectName: projectTable.name,
        // COALESCE on end_time so a still-running entry counts up to now
        // instead of reading as zero.
        seconds: secondsExpr,
      })
      .from(timeEntryTable)
      .leftJoin(taskTable, eq(taskTable.id, timeEntryTable.taskId))
      .leftJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(
        and(
          eq(timeEntryTable.userId, targetId),
          gte(
            timeEntryTable.startTime,
            sql`date_trunc('day', now()) - (${days - 1} * interval '1 day')`,
          ),
        ),
      )
      .groupBy(timeEntryTable.taskId, taskTable.title, projectTable.name)
      .orderBy(desc(secondsExpr));

    return c.json({ userId: targetId, days, items: rows });
  })
  /**
   * Answer to the 30-minute prompt.
   *
   * "yes" resets the miss counter. "no" stops the timer immediately. A client
   * that has not answered in a while sends nothing at all, so the miss count is
   * incremented here on the next check-in and the entry closes once it passes
   * the threshold — that path is what catches a laptop that was shut.
   */
  /**
   * The client reports that it has just PUT THE PROMPT ON SCREEN.
   *
   * This is the evidence the penalty depends on. Without it the scheduler
   * cannot distinguish someone ignoring the prompt from a tab that was closed
   * when it should have fired, and it docked both.
   */
  .post("/prompt-shown", async (c) => {
    const userId = c.get("userId");
    const open = await openEntry(userId);
    if (!open) return c.json({ running: false });

    await db
      .update(workTable)
      .set({ promptShownAt: new Date() })
      .where(eq(workTable.id, open.id));

    return c.json({ ok: true });
  })
  .post("/prompt", async (c) => {
    const userId = c.get("userId");
    const body = await c.req
      .json<{ working?: boolean }>()
      .catch(() => ({}) as { working?: boolean });

    const open = await openEntry(userId);
    if (!open) return c.json({ running: false });

    if (body.working === false) {
      const now = new Date();
      // Close the task entry too. Stopping only the work row would leave the
      // per-task entry open with no end, and every rollup COALESCEs a null
      // end_time to now() — so a declined prompt would have billed that task
      // indefinitely.
      await closeOpenTaskEntry(userId, now);
      await db
        .update(workTable)
        .set({
          endedAt: now,
          endedReason: "prompt_declined",
          currentTaskId: null,
        })
        .where(eq(workTable.id, open.id));
      return c.json({ running: false, stopped: "declined" });
    }

    await db
      .update(workTable)
      .set({ lastPromptAt: new Date(), promptMisses: 0 })
      .where(eq(workTable.id, open.id));

    return c.json({ running: true });
  })
  /**
   * Team summary — admins only.
   *
   * One row per member: hours today, hours this week, and whether they are on
   * the clock right now. This is the Employees tab.
   */
  /*
   * ADMIN: enter or correct a time slot for someone else.
   *
   * VK: "suppose we forgot to clock in, we should be able to add… if somebody
   * credible says they've worked and forgot to add it, I should be able to add
   * manually" — and equally, to refuse when he does not believe them. So this
   * is admin-only by design; there is no self-service path.
   *
   * Every row written here is flagged isManual with the admin's id in
   * createdBy. A hand-entered slot must never be indistinguishable from a
   * tracked one: these are payroll evidence, and somebody will eventually ask
   * where an hour came from.
   */
  .post("/entries", async (c) => {
    if (!(await isAdmin(c.get("userId")))) {
      throw new HTTPException(403, {
        message: "Only admins can enter time for someone else.",
      });
    }

    const body = await c.req
      .json<{ userId?: string; startedAt?: string; endedAt?: string; note?: string }>()
      .catch(() => ({}) as Record<string, string>);

    const targetId = body.userId;
    const started = body.startedAt ? new Date(body.startedAt) : null;
    const ended = body.endedAt ? new Date(body.endedAt) : null;

    if (!targetId || !started || !ended || Number.isNaN(started.getTime()) || Number.isNaN(ended.getTime())) {
      throw new HTTPException(400, {
        message: "userId, startedAt and endedAt are all required",
      });
    }
    if (ended <= started) {
      throw new HTTPException(400, { message: "End must be after start" });
    }
    // A slot longer than a day is a typo, not a shift.
    if (ended.getTime() - started.getTime() > 24 * 3600_000) {
      throw new HTTPException(400, { message: "That slot is longer than 24 hours" });
    }

    const [created] = await db
      .insert(workTable)
      .values({
        userId: targetId,
        startedAt: started,
        endedAt: ended,
        endedReason: "manual_entry",
        lastPromptAt: ended,
        note: body.note?.trim() || null,
        createdBy: c.get("userId"),
        isManual: true,
      })
      .returning({ id: workTable.id });

    return c.json({ id: created?.id ?? null });
  })
  /** ADMIN: correct or remove a slot. Same reasoning as the create above. */
  .delete("/entries/:id", async (c) => {
    if (!(await isAdmin(c.get("userId")))) {
      throw new HTTPException(403, {
        message: "Only admins can remove someone else's time.",
      });
    }
    await db.delete(workTable).where(eq(workTable.id, c.req.param("id")));
    return c.json({ ok: true });
  })
  /**
   * ADMIN: pin a task for a user, or clear it with taskId: null.
   *
   * A pinned task removes the choice entirely for people whose day is one
   * repeating job — the picker shows that task and nothing else.
   */
  .put("/pinned-task", async (c) => {
    if (!(await isAdmin(c.get("userId")))) {
      throw new HTTPException(403, { message: "Only admins can pin a task." });
    }
    const body = await c.req
      .json<{ userId?: string; taskId?: string | null }>()
      .catch(() => ({}) as { userId?: string; taskId?: string | null });

    if (!body.userId) throw new HTTPException(400, { message: "userId required" });

    await db
      .update(userAccessTable)
      .set({ pinnedTaskId: body.taskId ?? null })
      .where(eq(userAccessTable.userId, body.userId));

    return c.json({ ok: true });
  })
  .get("/team", async (c) => {
    if (!(await isAdmin(c.get("userId")))) {
      throw new HTTPException(403, {
        message: "Only admins can see team hours.",
      });
    }

    const teamTz = process.env.WORK_TZ || process.env.LOCAL_TZ || "Asia/Kolkata";
    const rows = await db.execute(sql`
      SELECT u.id,
             u.name,
             u.email,
             -- MUST match GET /me exactly. It did not, and the two disagreed
             -- on screen: the sidebar showed 3h19m while this table showed
             -- 4.3h for the same person at the same moment, because this query
             -- ignored both the pause and the penalty. A timesheet that
             -- contradicts itself is worse than no timesheet — people are
             -- judged on these numbers.
             -- Same window rules as GET /me: wall-clock midnight in the
             -- TEAM's zone (WORK_TZ), and each entry contributes its OVERLAP
             -- with the window rather than all-or-nothing on started_at.
             -- UTC midnight is 5:30 AM IST — an overnight session either
             -- vanished from "today" or landed whole in the wrong day.
             -- GREATEST(0, …) keeps a penalised row from going negative.
             COALESCE(SUM(GREATEST(0,
               EXTRACT(EPOCH FROM (
                 COALESCE(w.ended_at, w.paused_at, now())
                 - GREATEST(w.started_at, (date_trunc('day', now() AT TIME ZONE ${teamTz}) AT TIME ZONE ${teamTz}))
               ))::int - w.penalty_seconds
             )) FILTER (WHERE COALESCE(w.ended_at, w.paused_at, now()) >= (date_trunc('day', now() AT TIME ZONE ${teamTz}) AT TIME ZONE ${teamTz})), 0)::int AS seconds_today,
             COALESCE(SUM(GREATEST(0,
               EXTRACT(EPOCH FROM (
                 COALESCE(w.ended_at, w.paused_at, now())
                 - GREATEST(w.started_at, (date_trunc('week', now() AT TIME ZONE ${teamTz}) AT TIME ZONE ${teamTz}))
               ))::int - w.penalty_seconds
             )) FILTER (WHERE COALESCE(w.ended_at, w.paused_at, now()) >= (date_trunc('week', now() AT TIME ZONE ${teamTz}) AT TIME ZONE ${teamTz})), 0)::int AS seconds_week,
             -- w.id IS NOT NULL is load-bearing: this is a LEFT JOIN, so a
             -- member who has never clocked in produces a NULL row where
             -- "ended_at IS NULL" is TRUE, and BOOL_OR would report the whole
             -- team as permanently on the clock.
             -- Paused is NOT active. A paused clock is not accruing, and
             -- showing it as "Active" told the owner someone was working when
             -- the system had already stopped counting them.
             BOOL_OR(w.id IS NOT NULL AND w.ended_at IS NULL AND w.paused_at IS NULL) AS active,
             BOOL_OR(w.id IS NOT NULL AND w.ended_at IS NULL AND w.paused_at IS NOT NULL) AS paused,
             COALESCE(SUM(w.penalty_seconds) FILTER (
               WHERE COALESCE(w.ended_at, w.paused_at, now()) >= (date_trunc('day', now() AT TIME ZONE ${teamTz}) AT TIME ZONE ${teamTz})), 0)::int AS penalty_today,
             MAX(w.started_at) AS last_started_at
        FROM "user" u
        LEFT JOIN time_entry_work w ON w.user_id = u.id
       GROUP BY u.id, u.name, u.email
       ORDER BY active DESC NULLS LAST, seconds_today DESC
    `);

    const items = Array.isArray(rows)
      ? rows
      : ((rows as { rows?: unknown[] })?.rows ?? []);

    return c.json({ items });
  });

export { MAX_PROMPT_MISSES };
export default timeTracking;
