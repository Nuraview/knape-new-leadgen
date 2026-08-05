/**
 * No clock survives the night.
 *
 * THE PROBLEM THIS CLOSES. VK started a clock at 23:38 IST, the watchdog paused
 * it at 00:10, and a Resume click in the morning cleared the pause in place —
 * retroactively converting eleven and a half hours of sleep into on-the-clock
 * time. The sidebar read 12h and the Employees page 16h.
 *
 * Resume was fixed to close-and-reopen rather than un-pause in place, which stops
 * that specific mechanism. But that fix only makes the zombie UNLIKELY, not
 * IMPOSSIBLE: nothing bounded how long a single entry could stay open, so any
 * future path that clears a pause — a new endpoint, an admin edit, a bug — could
 * resurrect exactly the same shape. A daily total should not depend on nobody
 * making that mistake again.
 *
 * So: an entry may not span local midnight. Anything still open from yesterday is
 * closed, and if the person is genuinely still at their desk a fresh entry opens
 * at midnight to carry them into today.
 *
 * WHERE IT CLOSES, and why that boundary is the honest one:
 *
 *   credit up to the LAST EVIDENCE they were there (an answered prompt, or the
 *   tab heartbeating), never past midnight
 *
 * Crediting to midnight regardless would pay for the hours between walking away
 * and midnight. Crediting to the last evidence pays for the part we can actually
 * stand behind. Under-crediting is a conversation with VK, who can add the time
 * back from the Employees page; over-crediting is invisible and silently wrong.
 */
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import db from "../database";
import { time_entry_work as workTable, userTable } from "../database/schema";
import { rowsOf } from "../database/rows";

/**
 * Belt and braces: even inside one day, no single entry may run longer than
 * this. A 12-hour unbroken session is not a work pattern, it is a stuck timer.
 */
const MAX_SESSION_HOURS = 12;

/** Still counts as "at their desk" for the purpose of continuing into today. */
const STILL_ACTIVE_MINUTES = 10;

/*
 * Mirrors the watchdog (stale-work-clocks.ts): it pauses any entry whose prompt
 * has gone unanswered for PROMPT + GRACE minutes.
 *
 * That gives us a guarantee worth relying on. An entry that is STILL OPEN AND
 * UNPAUSED has been answering prompts the whole time it has been running — so a
 * night shift is evidenced minute by minute, not assumed. Anyone may work at any
 * hour and it must be recorded in full.
 */
const UNANSWERED_AFTER_MINUTES = 30;

export async function closeOvernightClocks() {
  const tz = process.env.WORK_TZ || process.env.LOCAL_TZ || "Asia/Kolkata";
  // Local midnight, expressed as an instant — the same expression /me and /team
  // bucket by, so the boundary agrees everywhere.
  const dayStart = sql`(date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;

  const stale = await db
    .select({
      id: workTable.id,
      userId: workTable.userId,
      startedAt: workTable.startedAt,
      pausedAt: workTable.pausedAt,
      lastPromptAt: workTable.lastPromptAt,
      lastSeenAt: workTable.lastSeenAt,
      currentTaskId: workTable.currentTaskId,
      email: userTable.email,
    })
    .from(workTable)
    .innerJoin(userTable, eq(userTable.id, workTable.userId))
    .where(and(isNull(workTable.endedAt), lt(workTable.startedAt, dayStart)));

  if (stale.length === 0) return;

  // Resolve the boundary once so every row in this pass uses the same instant.
  // Bail rather than guess if the database will not give it to us: a wrong
  // midnight would close entries at the wrong point, which is a silent edit to
  // someone's recorded hours.
  const boundaryRows = rowsOf<{ boundary: string }>(
    await db.execute(sql`SELECT ${dayStart} AS boundary`),
  );
  const boundary = boundaryRows[0]?.boundary;
  if (!boundary) {
    console.error("[overnight] could not resolve local midnight — skipping");
    return;
  }

  const midnight = new Date(boundary);
  const now = new Date();

  for (const row of stale) {
    const started = new Date(row.startedAt);

    /*
     * WHERE TO CUT, and why each case is the accurate answer rather than the
     * cautious one. People work night shifts; splitting the day must not cost
     * them the hours either side of midnight.
     *
     *   already paused   -> cut at pausedAt. It stopped accruing there; that IS
     *                       the truth of the entry.
     *   open and current  -> cut at MIDNIGHT and carry the rest into today. The
     *                       watchdog would have paused this entry within 30
     *                       minutes of an unanswered prompt, so its survival is
     *                       per-prompt evidence they were present the whole way
     *                       through — including across midnight. Full credit.
     *   open but overdue  -> the watchdog has not caught it yet. Credit to the
     *                       last answered prompt plus its grace, which is the
     *                       most the rules would ever have allowed.
     */
    const answeredAt = row.lastPromptAt ? new Date(row.lastPromptAt) : started;
    const overdue =
      now.getTime() - answeredAt.getTime() >
      UNANSWERED_AFTER_MINUTES * 60_000;

    let closeAt: Date;
    if (row.pausedAt) {
      closeAt = new Date(row.pausedAt);
    } else if (!overdue) {
      // Continuously present. Give them everything up to the day boundary.
      closeAt = midnight;
    } else {
      closeAt = new Date(
        answeredAt.getTime() + UNANSWERED_AFTER_MINUTES * 60_000,
      );
    }

    // Never past midnight, never before the start.
    if (closeAt > midnight) closeAt = midnight;
    if (closeAt < started) closeAt = started;

    const hardCap = new Date(
      started.getTime() + MAX_SESSION_HOURS * 60 * 60 * 1000,
    );
    if (closeAt > hardCap) closeAt = hardCap;

    await db
      .update(workTable)
      .set({
        endedAt: closeAt,
        pausedAt: null,
        endedReason: "auto_closed_overnight",
        currentTaskId: null,
      })
      .where(eq(workTable.id, row.id));

    /*
     * CARRY THE POST-MIDNIGHT PORTION INTO TODAY.
     *
     * Someone who worked 23:00 to 01:00 and then shut their laptop must be paid
     * for both hours. An earlier version of this only continued the session for
     * people still online right now, which silently dropped everything between
     * midnight and the moment they stopped — the same class of error as the
     * zombie, just in the employee's disfavour instead of their favour.
     *
     * So the continuation is created whenever there is evidence of activity
     * AFTER midnight, and it is closed at that last evidence unless they are
     * still at their desk, in which case it stays open and today continues
     * normally.
     *
     * A paused entry is never continued: they were away when it paused, and
     * resuming is their decision to make.
     */
    const afterMidnight = [row.lastPromptAt, row.lastSeenAt]
      .filter((d): d is Date => d != null)
      .map((d) => new Date(d).getTime())
      .filter((t) => t > midnight.getTime());

    const carryOver =
      row.pausedAt == null &&
      closeAt.getTime() === midnight.getTime() &&
      afterMidnight.length > 0;

    let continued: "open" | "closed" | null = null;

    if (carryOver) {
      const lastAfter = new Date(Math.max(...afterMidnight));
      const stillHere =
        row.lastSeenAt != null &&
        now.getTime() - new Date(row.lastSeenAt).getTime() <
          STILL_ACTIVE_MINUTES * 60_000;

      await db.insert(workTable).values({
        userId: row.userId,
        startedAt: midnight,
        lastPromptAt: row.lastPromptAt ?? now,
        currentTaskId: stillHere ? row.currentTaskId : null,
        endedAt: stillHere ? null : lastAfter,
        endedReason: stillHere ? null : "auto_closed_overnight",
      });
      continued = stillHere ? "open" : "closed";
    }

    console.log(
      `[overnight] closed ${row.email} at ${closeAt.toISOString()} ` +
        `(started ${started.toISOString()})` +
        (continued === "open"
          ? " — carried into today, still working"
          : continued === "closed"
            ? " — carried into today and closed at last activity"
            : ""),
    );
  }
}

export default closeOvernightClocks;
