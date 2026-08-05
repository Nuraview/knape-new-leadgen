import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import db from "../../database";
import { notificationTable, userTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deliverNotification } from "../../notification-preferences/delivery";
import {
  duplicatesOwnerBroadcast,
  humanizeStatus,
  notifyEmployeeWhatsapp,
} from "../whatsapp";

async function createNotification({
  userId,
  title,
  content,
  type,
  eventData,
  resourceId,
  resourceType,
}: {
  userId: string;
  title?: string | null;
  content?: string | null;
  type?: string;
  eventData?: Record<string, unknown> | null;
  resourceId?: string;
  resourceType?: string;
}) {
  const preferenceKey =
    type === "task_assignee_changed" || type === "task_created"
      ? "taskAssignmentEnabled"
      : type === "task_comment" || type === "task_mention"
        ? "taskCommentEnabled"
        : type === "task_status_changed"
          ? "taskStatusChangeEnabled"
          : type === "due_date_reminder" || type === "task_overdue"
            ? "dueDateReminderEnabled"
            : null;

  if (preferenceKey) {
    const preference = await db.query.userNotificationPreferenceTable.findFirst(
      {
        where: (table, { eq }) => eq(table.userId, userId),
      },
    );

    if (preference?.[preferenceKey] === false) {
      return null;
    }
  }

  const [notification] = await db
    .insert(notificationTable)
    .values({
      id: createId(),
      userId,
      title: title ?? null,
      content: content ?? null,
      type: type || "info",
      eventData: eventData ?? null,
      resourceId: resourceId || null,
      resourceType: resourceType || null,
    })
    .returning();

  if (notification) {
    await publishEvent("notification.created", {
      notificationId: notification.id,
      userId,
    });
    void deliverNotification(notification.id).catch((error) => {
      console.error("Failed to deliver notification", {
        notificationId: notification.id,
        error,
      });
    });

    /*
     * Mirror to the recipient's WhatsApp (meeting 2026-07-30: "the moment a
     * task has been added … or any comment is added, he also gets a WhatsApp
     * notification"). ONE hook here rather than one per event type: every
     * board notification — assignment, comment, mention, status change, due
     * date — already funnels through this function, already aimed at the
     * right person, and already gated on their notification preferences. An
     * employee whose email is not in WHATSAPP_EMPLOYEE_NUMBERS simply gets
     * nothing, so rollout is per-person as VK hands numbers over.
     */
    void mirrorToWhatsapp(userId, type, eventData).catch(() => {});
  }

  return notification;
}

const WHATSAPP_MIRRORED_TYPES: Record<string, string> = {
  task_created: "🆕 New task for you",
  task_assignee_changed: "📌 Task assigned to you",
  task_status_changed: "📋 Task status changed",
  task_comment: "💬 New comment",
  task_mention: "💬 You were mentioned",
  due_date_reminder: "⏰ Due date reminder",
  task_overdue: "⏰ Task overdue",
};

async function mirrorToWhatsapp(
  userId: string,
  type: string | undefined,
  eventData: Record<string, unknown> | null | undefined,
) {
  const heading = type ? WHATSAPP_MIRRORED_TYPES[type] : undefined;
  if (!heading) return;

  const [recipient] = await db
    .select({ email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  if (!recipient?.email) return;

  // The owner is in the employee map for his own assignments and due dates, so
  // skip the types he is already sent for every card on the board.
  if (duplicatesOwnerBroadcast(recipient.email, type)) return;

  const d = (eventData ?? {}) as Record<string, string | null | undefined>;
  const lines = [
    `${heading}${d.taskTitle ? `: *${d.taskTitle}*` : ""}`,
    type === "task_status_changed" && d.oldStatus && d.newStatus
      ? `${humanizeStatus(d.oldStatus)} → ${humanizeStatus(d.newStatus)}`
      : null,
    type === "task_comment" && d.commenterName
      ? `${d.commenterName}: ${d.commentPreview ?? ""}`
      : null,
    type === "task_mention" && d.mentionerName
      ? `by ${d.mentionerName}`
      : null,
    "— NuraView",
  ].filter(Boolean);

  await notifyEmployeeWhatsapp(
    recipient.email,
    lines.join("\n"),
    `nuraview-app:${type}`,
  );
}

export default createNotification;
