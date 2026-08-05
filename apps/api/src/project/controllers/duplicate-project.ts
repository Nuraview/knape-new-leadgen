/**
 * Duplicate a project (board).
 *
 * Meeting requirement 2026-07-27: "It should be duplicatable" — the same board
 * structure gets reused per client, and rebuilding columns by hand each time is
 * the thing being complained about.
 *
 * Copies structure, not history: columns and tasks come across, while comments,
 * activity and time entries do not. A duplicate is a fresh start from a known
 * shape, not a clone of someone else's conversation.
 *
 * Public share tokens are explicitly NOT copied. Duplicating a board that had
 * been shared with client A must never hand client B a working link to it.
 */
import { asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { columnTable, projectTable, taskTable } from "../../database/schema";

export async function duplicateProject(
  projectId: string,
  options: { name?: string; includeTasks?: boolean } = {},
) {
  const [source] = await db
    .select()
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);

  if (!source) throw new HTTPException(404, { message: "PROJECT_NOT_FOUND" });


  const includeTasks = options.includeTasks !== false;
  const now = new Date();

  const [copy] = await db
    .insert(projectTable)
    .values({
      workspaceId: source.workspaceId,
      name: options.name?.trim() || `${source.name} (copy)`,
      slug: source.slug,
      icon: source.icon,
      description: source.description,
      createdAt: now,
    })
    .returning();

  if (!copy) throw new HTTPException(500, { message: "DUPLICATE_FAILED" });

  const columns = await db
    .select()
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));

  // old column id -> new column id, so tasks land in the matching column
  const columnMap = new Map<string, string>();

  for (const column of columns) {
    const [created] = await db
      .insert(columnTable)
      .values({
        projectId: copy.id,
        name: column.name,
        slug: column.slug,
        position: column.position,
        isFinal: column.isFinal,
        icon: column.icon,
        color: column.color,
      })
      .returning();

    if (created) columnMap.set(column.id, created.id);
  }

  let copiedTasks = 0;

  if (includeTasks) {
    const tasks = await db
      .select()
      .from(taskTable)
      .where(eq(taskTable.projectId, projectId))
      .orderBy(asc(taskTable.position));

    for (const task of tasks) {
      const targetColumn = task.columnId
        ? columnMap.get(task.columnId)
        : undefined;

      copiedTasks += 1;

      await db.insert(taskTable).values({
        projectId: copy.id,
        // Ticket numbers restart in the copy rather than inheriting the
        // original's, which would collide with the copy's own sequence.
        number: copiedTasks,
        columnId: targetColumn ?? null,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        position: task.position,
        // Dates and assignment belong to the original run of work, not the
        // copy — a duplicated board starts unassigned and undated.
        dueDate: null,
        // The schema calls the assignee column userId (assignee_id).
        userId: null,
        createdAt: now,
      });
    }
  }

  return {
    project: copy,
    copiedColumns: columnMap.size,
    copiedTasks,
  };
}
