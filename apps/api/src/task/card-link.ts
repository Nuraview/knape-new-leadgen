/**
 * Standalone card link.
 *
 * A card has to be openable as a URL of its own, so a card can be handed to
 * the person doing the work instead of "find it on the board".
 *
 * This REPLACES a public token share ("anyone with the link can view this
 * card"). That was wrong: a card carries the client's name, the description,
 * and the team's comments, and the rule everywhere else in this app is that an
 * employee only sees the projects they are assigned to (project_member, see
 * canOpenProject). An anonymous link was strictly wider than the board it came
 * from — anyone forwarded the URL, inside the company or outside it, could
 * read the card, and nothing recorded who did.
 *
 * So the link is NOT a capability. It only names the task; the SERVER decides,
 * on every request, using the same rule as opening the board:
 *   owner / admin           -> any card
 *   member assigned to it   -> that project's cards
 *   everyone else           -> 404
 *
 * 404 rather than 403 deliberately, matching assertCanOpenProject: a link you
 * may not open must not confirm that the card exists.
 */
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import getComments from "../comment/controllers/get-comments";
import db from "../database";
import { projectTable, taskTable, userTable } from "../database/schema";
import { assertCanOpenProject } from "../utils/require-crm-access";

export async function getTaskCard(taskId: string, viewerId: string) {
  const [row] = await db
    .select({
      id: taskTable.id,
      number: taskTable.number,
      title: taskTable.title,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      createdAt: taskTable.createdAt,
      assigneeName: userTable.name,
      projectId: projectTable.id,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);

  // Same 404 as "you are not on this project" below — a card you cannot open
  // and a card that does not exist must be indistinguishable.
  if (!row) throw new HTTPException(404, { message: "Card not found" });

  await assertCanOpenProject(viewerId, row.projectId);

  // Through the same controller the card detail uses. Comments are rows in
  // `activity` with type "comment" — `comment` is a legacy table the app no
  // longer writes to, and reading it here (as the old public page did) showed
  // an empty thread on cards that plainly had comments.
  const comments = await getComments(row.id);

  return {
    task: {
      id: row.id,
      number: row.number,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      startDate: row.startDate,
      dueDate: row.dueDate,
      createdAt: row.createdAt,
      assignee: row.assigneeName,
    },
    project: {
      id: row.projectId,
      name: row.projectName,
      slug: row.projectSlug,
      workspaceId: row.workspaceId,
    },
    comments: comments.map((comment) => ({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      author: comment.user.name ?? "Team",
    })),
  };
}
