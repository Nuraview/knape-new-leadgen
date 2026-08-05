import { and, asc, eq, inArray } from "drizzle-orm";
import db from "../database";
import {
  workspace as workspaceTable,
  workspace_member as workspaceMemberTable,
} from "../database/schema";
import createNotification from "../notification/controllers/create-notification";

/**
 * Tell whoever approves that a post is waiting.
 *
 * "Whoever approves" is the owners and admins of the instance workspace, the
 * same definition `require-crm-access.ts` uses for full CRM access — so this
 * cannot drift from who is actually allowed to click Approve.
 *
 * Best-effort throughout: a notification that fails to send must not fail the
 * submit that triggered it. The post is still in the queue and still visible in
 * the Scheduler; the bell is a convenience, not the system of record.
 */

const REVIEWER_ROLES = ["owner", "admin"];

async function reviewerUserIds(): Promise<string[]> {
  const [workspace] = await db
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .orderBy(asc(workspaceTable.createdAt))
    .limit(1);
  if (!workspace) return [];

  const rows = await db
    .select({ userId: workspaceMemberTable.userId })
    .from(workspaceMemberTable)
    .where(
      and(
        eq(workspaceMemberTable.workspaceId, workspace.id),
        inArray(workspaceMemberTable.role, REVIEWER_ROLES),
      ),
    );

  return rows.map((r) => r.userId);
}

export async function notifyReviewers(
  postId: string,
  label: string,
  actor: string | null,
): Promise<void> {
  try {
    const recipients = await reviewerUserIds();
    const preview = label.trim().replace(/\s+/g, " ").slice(0, 80);

    await Promise.all(
      recipients.map((userId) =>
        createNotification({
          userId,
          title: "LinkedIn post needs approval",
          content: preview,
          type: "info",
          resourceId: postId,
          resourceType: "linkedin_post",
          eventData: { postId, submittedBy: actor },
        }),
      ),
    );
  } catch (error) {
    console.error("[linkedin] could not notify reviewers (continuing):", error);
  }
}
