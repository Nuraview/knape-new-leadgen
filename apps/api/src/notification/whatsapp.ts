/**
 * WhatsApp notifications for project activity.
 *
 * Meeting requirement 2026-07-27: updates and comments on a project should
 * reach people without them having to sit in the app.
 *
 * NuraView already runs a WhatsApp bridge (the nuraview-whatsapp container),
 * which polls the `whatsapp_outbox` table and sends whatever it finds. So this
 * enqueues a row rather than talking to WhatsApp directly — no second
 * integration, no credentials here, and the bridge's retry/backoff behaviour
 * is inherited for free.
 *
 * Delivery is BEST EFFORT and deliberately swallows its own errors: a
 * notification failing must never fail the comment or status change that
 * triggered it. The user's write already succeeded by the time we get here.
 */
import { sql } from "drizzle-orm";
import crmDb, { isCrmConfigured } from "../database/crm";

/** Digits-only JID, e.g. 919591190000@s.whatsapp.net */
function toJid(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 10) return null;
  return `${digits}@s.whatsapp.net`;
}

/**
 * The OWNER's number: the FIRST WHATSAPP_RECIPIENTS entry, the same convention
 * the work-clock and lead-flow watchdogs use.
 *
 * The rest of that variable is NOT a list of owners — it is the legacy reminder
 * list, and employees who review leads have to stay in it so the reminder cron
 * can route by name. Broadcasting board activity to the whole list therefore
 * sent every comment in the workspace to an employee who never asked for it,
 * which is why nothing here broadcasts any more: owner business goes through
 * notifyOwnerWhatsapp, one person's business through notifyEmployeeWhatsapp.
 */
export function ownerJid(): string | null {
  const first = (process.env.WHATSAPP_RECIPIENTS ?? "").split(",")[0] ?? "";
  return toJid(first.slice(first.indexOf(":") + 1));
}

/**
 * Queue a message for the owner alone — clock starts/stops, card moves,
 * watchdog alerts, and every comment on the board.
 */
export function notifyOwnerWhatsapp(
  body: string,
  enqueuedBy = "nuraview-app:owner",
): Promise<number> {
  const jid = ownerJid();
  if (!jid || !isCrmConfigured()) return Promise.resolve(0);

  return crmDb
    .execute(
      sql`insert into whatsapp_outbox (id, to_jid, body, status, attempts, account, enqueued_by, created_at)
          values (gen_random_uuid(), ${jid}, ${body}, 'pending', 0, 'primary', ${enqueuedBy}, now())`,
    )
    .then(() => 1)
    .catch((error) => {
      console.error("[whatsapp] owner enqueue failed:", error);
      return 0;
    });
}

/**
 * Per-employee numbers, from WHATSAPP_EMPLOYEE_NUMBERS:
 *   "javed@nuraview.com:+9199...,shantanu@nuraview.com:+9198..."
 *
 * Env rather than a table because that is how every other number in this
 * system is configured (WHATSAPP_RECIPIENTS, WHATSAPP_TO), and VK hands the
 * numbers over as a list. Unknown email -> no send, silently: an employee
 * without a number configured just doesn't get WhatsApp yet.
 */
function employeeJid(email: string | null | undefined): string | null {
  if (!email) return null;
  const raw = process.env.WHATSAPP_EMPLOYEE_NUMBERS ?? "";
  for (const entry of raw.split(",")) {
    const sep = entry.lastIndexOf(":");
    if (sep === -1) continue;
    if (entry.slice(0, sep).trim().toLowerCase() === email.toLowerCase()) {
      return toJid(entry.slice(sep + 1));
    }
  }
  return null;
}

/** Queue a message to ONE employee, matched by email. */
export function notifyEmployeeWhatsapp(
  email: string | null | undefined,
  body: string,
  enqueuedBy = "nuraview-app:employee",
): Promise<number> {
  const jid = employeeJid(email);
  if (!jid || !isCrmConfigured()) return Promise.resolve(0);

  return crmDb
    .execute(
      sql`insert into whatsapp_outbox (id, to_jid, body, status, attempts, account, enqueued_by, created_at)
          values (gen_random_uuid(), ${jid}, ${body}, 'pending', 0, 'primary', ${enqueuedBy}, now())`,
    )
    .then(() => 1)
    .catch((error) => {
      console.error("[whatsapp] employee enqueue failed:", error);
      return 0;
    });
}

/**
 * Board events the owner ALREADY receives for every card, from
 * notifyOwnerWhatsapp on each move and notifyComment on each comment.
 */
const OWNER_GLOBAL_TYPES = new Set([
  "task_status_changed",
  "task_comment",
  "task_mention",
]);

/**
 * True when a personal mirror would repeat something the owner is already sent
 * board-wide.
 *
 * The owner is a member like anyone else — he has cards, gets assigned work and
 * has due dates — so his number belongs in WHATSAPP_EMPLOYEE_NUMBERS too, or he
 * silently misses "assigned to you" and due-date reminders. But three of the
 * mirrored types duplicate the board-wide alerts he gets as owner, and two
 * identical WhatsApps for one comment is how people learn to ignore the
 * channel. Assignment and due-date types have no owner-side equivalent, so they
 * pass through.
 */
export function duplicatesOwnerBroadcast(
  email: string | null | undefined,
  type: string | undefined,
): boolean {
  if (!type || !OWNER_GLOBAL_TYPES.has(type)) return false;
  const jid = employeeJid(email);
  return jid !== null && jid === ownerJid();
}

/** "in-progress" -> "In Progress" for human-facing messages. */
export function humanizeStatus(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length ? w[0]?.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * A new comment on a card, to the OWNER only.
 *
 * This used to broadcast to every WHATSAPP_RECIPIENTS entry, but that list is
 * not "the owners" — it is the legacy reminder list, and the lead reminder
 * cron still resolves lead reminders by NAME against it, so employees who
 * review leads have to stay in it. The effect was that every one of them got a
 * copy of every comment on every task in the workspace, plus a second copy of
 * comments on their own tasks (createNotification already mirrors
 * task_comment / task_mention to each person individually).
 *
 * Whole-board comment visibility is the owner's, so the owner is who this
 * goes to. Everyone else gets their personal mirror and nothing more.
 */
export function notifyComment(input: {
  projectName: string;
  taskTitle: string;
  author: string;
  comment: string;
  url?: string;
}) {
  const trimmed =
    input.comment.length > 300
      ? `${input.comment.slice(0, 300)}…`
      : input.comment;

  return notifyOwnerWhatsapp(
    [
      `💬 *${input.author}* commented`,
      `${input.projectName} › ${input.taskTitle}`,
      "",
      trimmed,
      input.url ? `\n${input.url}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    "nuraview-app:comment",
  );
}

/*
 * There was a notifyStatusChange() here that broadcast card moves to the whole
 * WHATSAPP_RECIPIENTS list. Nothing ever called it — the task.status_changed
 * subscriber in notification/index.ts sends the owner alert itself — and it was
 * the last user of the broadcast helper, so both are gone.
 */
