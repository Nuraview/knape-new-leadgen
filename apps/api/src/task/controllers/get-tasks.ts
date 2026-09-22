import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  columnTable,
  commentTable,
  externalLinkTable,
  labelTable,
  projectTable,
  taskAttachmentTable,
  taskProjectTable,
  taskRelationTable,
  taskTable,
  userTable,
} from "../../database/schema";

type GetTasksOptions = {
  assigneeId?: string;
  dueAfter?: string;
  dueBefore?: string;
  limit?: number;
  page?: number;
  priority?: string;
  sortBy?:
    | "createdAt"
    | "priority"
    | "dueDate"
    | "position"
    | "title"
    | "number";
  sortOrder?: "asc" | "desc";
  status?: string;
};

const priorityCaseExpr = sql<number>`CASE
  WHEN ${taskTable.priority} = 'urgent' THEN 4
  WHEN ${taskTable.priority} = 'high' THEN 3
  WHEN ${taskTable.priority} = 'medium' THEN 2
  WHEN ${taskTable.priority} = 'low' THEN 1
  ELSE 0
END`;

function buildOrderBy(
  sortBy: GetTasksOptions["sortBy"],
  sortOrder: GetTasksOptions["sortOrder"],
): SQL {
  const direction = sortOrder === "desc" ? desc : asc;

  switch (sortBy) {
    case "createdAt":
      return direction(taskTable.createdAt);
    case "priority":
      return direction(priorityCaseExpr);
    case "dueDate":
      return direction(taskTable.dueDate);
    case "title":
      return direction(taskTable.title);
    case "number":
      return direction(taskTable.number);
    default:
      return direction(taskTable.position);
  }
}

async function getTasks(projectId: string, options: GetTasksOptions = {}) {
  const project = await db.query.projectTable.findFirst({
    where: eq(projectTable.id, projectId),
  });

  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  const conditions = [eq(taskTable.projectId, projectId)];

  if (options.status) {
    conditions.push(eq(taskTable.status, options.status));
  }

  if (options.priority) {
    conditions.push(eq(taskTable.priority, options.priority));
  }

  if (options.assigneeId) {
    conditions.push(eq(taskTable.userId, options.assigneeId));
  }

  if (options.dueBefore) {
    conditions.push(lte(taskTable.dueDate, new Date(options.dueBefore)));
  }

  if (options.dueAfter) {
    conditions.push(gte(taskTable.dueDate, new Date(options.dueAfter)));
  }

  const whereClause = and(...conditions);
  const usePagination = options.page != null || options.limit != null;
  const page = options.page && options.page > 0 ? options.page : 1;
  const pageSize =
    options.limit && options.limit > 0 ? Math.min(options.limit, 100) : 50;
  const offset = (page - 1) * pageSize;

  const orderByClause = buildOrderBy(
    options.sortBy ?? "position",
    options.sortOrder ?? "asc",
  );

  const [taskCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(taskTable)
    .where(whereClause);

  const total = Number(taskCount?.count ?? 0);

  const taskSelection = {
    id: taskTable.id,
    title: taskTable.title,
    number: taskTable.number,
    description: taskTable.description,
    status: taskTable.status,
    priority: taskTable.priority,
    startDate: taskTable.startDate,
    dueDate: taskTable.dueDate,
    position: taskTable.position,
    createdAt: taskTable.createdAt,
    userId: taskTable.userId,
    assigneeName: userTable.name,
    assigneeId: userTable.id,
    assigneeImage: userTable.image,
    projectId: taskTable.projectId,
    taskProjectId: taskTable.taskProjectId,
  };

  const query = db
    .select(taskSelection)
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(whereClause)
    .orderBy(orderByClause);

  const paginatedTasks = usePagination
    ? await query.limit(pageSize).offset(offset)
    : await query;

  const taskIds = paginatedTasks.map((task) => task.id);

  const labelsData =
    taskIds.length > 0
      ? await db
          .select({
            id: labelTable.id,
            name: labelTable.name,
            color: labelTable.color,
            taskId: labelTable.taskId,
          })
          .from(labelTable)
          .where(inArray(labelTable.taskId, taskIds))
      : [];

  const externalLinksData =
    taskIds.length > 0
      ? await db
          .select()
          .from(externalLinkTable)
          .where(inArray(externalLinkTable.taskId, taskIds))
      : [];

  // Card badges. Trello puts a comment count and a paperclip on the front of
  // the card, which is how you tell a rich card from a bare one without opening
  // it. Two grouped counts rather than N+1 lookups per card.
  const commentCounts =
    taskIds.length > 0
      ? await db
          .select({
            taskId: commentTable.taskId,
            count: sql<number>`count(*)`,
          })
          .from(commentTable)
          .where(inArray(commentTable.taskId, taskIds))
          .groupBy(commentTable.taskId)
      : [];

  const attachmentCounts =
    taskIds.length > 0
      ? await db
          .select({
            taskId: taskAttachmentTable.taskId,
            count: sql<number>`count(*)`,
          })
          .from(taskAttachmentTable)
          .where(inArray(taskAttachmentTable.taskId, taskIds))
          .groupBy(taskAttachmentTable.taskId)
      : [];

  /*
   * The subtasks hanging off each card on this page — the "2/5" badge, and the
   * checklist behind it.
   *
   * Titles come back with the counts rather than in a second round trip
   * because the card front now expands into the list: hiding subtask cards
   * from the columns is only defensible if the parent shows what it is hiding,
   * and one query for the whole page is what makes that affordable.
   *
   * "Done" is defined exactly as the detail panel defines it
   * (components/task/task-subtasks.tsx): a subtask counts as complete when its
   * STATUS matches a column marked isFinal. The join is on
   * (projectId, slug) rather than the child's columnId on purpose — that is
   * the same lookup the panel does, and older rows can carry a status with no
   * columnId, which an id join would silently count as not-done. A card
   * disagreeing with the panel it opens is worse than no badge.
   */
  const subtaskRows =
    taskIds.length > 0
      ? await db
          .select({
            parentId: taskRelationTable.sourceTaskId,
            id: taskTable.id,
            title: taskTable.title,
            status: taskTable.status,
            done: sql<boolean>`coalesce(${columnTable.isFinal}, false)`,
          })
          .from(taskRelationTable)
          .innerJoin(
            taskTable,
            eq(taskTable.id, taskRelationTable.targetTaskId),
          )
          .leftJoin(
            columnTable,
            and(
              eq(columnTable.projectId, taskTable.projectId),
              eq(columnTable.slug, taskTable.status),
            ),
          )
          .where(
            and(
              inArray(taskRelationTable.sourceTaskId, taskIds),
              eq(taskRelationTable.relationType, "subtask"),
            ),
          )
          .orderBy(asc(taskTable.position), asc(taskTable.number))
      : [];

  const subtaskListMap = new Map<
    string,
    Array<{ id: string; title: string; status: string; done: boolean }>
  >();
  /*
   * Which cards are somebody's subtask, so the board can stop drawing them
   * twice.
   *
   * A subtask is a real task joined by task_relation — that is what makes it
   * assignable, datable and openable — but it is ALSO a line on its parent's
   * checklist, and a board that shows both puts every checklist item in a
   * column of its own. One 12-card import with three subtasks each arrived as
   * 48 cards, which is not a board anybody can read.
   *
   * Only parents on THIS board are consulted (the relation query is keyed on
   * this page's task ids), so a subtask handed to somebody else still shows up
   * as an ordinary card on their board — it has no parent there to hide behind.
   */
  const parentOf = new Map<string, string>();
  for (const row of subtaskRows) {
    if (!subtaskListMap.has(row.parentId)) subtaskListMap.set(row.parentId, []);
    subtaskListMap.get(row.parentId)?.push({
      id: row.id,
      title: row.title,
      status: row.status,
      done: Boolean(row.done),
    });
    parentOf.set(row.id, row.parentId);
  }

  const subtaskCountMap = new Map(
    [...subtaskListMap.entries()].map(([parentId, children]) => [
      parentId,
      {
        total: children.length,
        done: children.filter((c) => c.done).length,
      },
    ]),
  );

  /*
   * Work stream per card. One lookup for the streams actually referenced on
   * this page rather than a join on every row — the list is short (a handful
   * per workspace) and most boards use two or three of them.
   */
  const streamIds = [
    ...new Set(
      paginatedTasks
        .map((t) => t.taskProjectId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const streams =
    streamIds.length > 0
      ? await db
          .select({
            id: taskProjectTable.id,
            name: taskProjectTable.name,
            color: taskProjectTable.color,
          })
          .from(taskProjectTable)
          .where(inArray(taskProjectTable.id, streamIds))
      : [];
  const streamMap = new Map(streams.map((s) => [s.id, s]));

  const commentCountMap = new Map(
    commentCounts.map((r) => [r.taskId, Number(r.count)]),
  );
  const attachmentCountMap = new Map(
    attachmentCounts.map((r) => [r.taskId, Number(r.count)]),
  );

  const taskLabelsMap = new Map<
    string,
    Array<{ id: string; name: string; color: string }>
  >();
  for (const label of labelsData) {
    if (label.taskId) {
      if (!taskLabelsMap.has(label.taskId)) {
        taskLabelsMap.set(label.taskId, []);
      }
      taskLabelsMap.get(label.taskId)?.push({
        id: label.id,
        name: label.name,
        color: label.color,
      });
    }
  }

  const taskExternalLinksMap = new Map<
    string,
    Array<{
      id: string;
      taskId: string;
      integrationId: string;
      resourceType: string;
      externalId: string;
      url: string;
      title: string | null;
      metadata: Record<string, unknown> | null;
    }>
  >();
  for (const externalLink of externalLinksData) {
    if (!taskExternalLinksMap.has(externalLink.taskId)) {
      taskExternalLinksMap.set(externalLink.taskId, []);
    }
    taskExternalLinksMap.get(externalLink.taskId)?.push({
      ...externalLink,
      metadata: externalLink.metadata
        ? JSON.parse(externalLink.metadata)
        : null,
    });
  }

  const decorate = (task: (typeof paginatedTasks)[number]) => ({
    ...task,
    labels: taskLabelsMap.get(task.id) || [],
    externalLinks: taskExternalLinksMap.get(task.id) || [],
    commentCount: commentCountMap.get(task.id) ?? 0,
    attachmentCount: attachmentCountMap.get(task.id) ?? 0,
    subtaskTotal: subtaskCountMap.get(task.id)?.total ?? 0,
    subtaskDone: subtaskCountMap.get(task.id)?.done ?? 0,
    subtasks: subtaskListMap.get(task.id) ?? [],
    parentTaskId: parentOf.get(task.id) ?? null,
    taskProject: task.taskProjectId
      ? (streamMap.get(task.taskProjectId) ?? null)
      : null,
  });

  const projectColumns = await db
    .select()
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));

  const columns = projectColumns.map((column) => ({
    id: column.slug,
    slug: column.slug,
    name: column.name,
    icon: column.icon,
    isFinal: column.isFinal,
    tasks: paginatedTasks
      .filter((task) => task.status === column.slug)
      .map(decorate),
  }));

  const archivedTasks = paginatedTasks
    .filter((task) => task.status === "archived")
    .map(decorate);

  const plannedTasks = paginatedTasks
    .filter((task) => task.status === "planned")
    .map(decorate);

  return {
    data: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      icon: project.icon,
      description: project.description,
      workspaceId: project.workspaceId,
      columns,
      archivedTasks,
      plannedTasks,
    },
    pagination: usePagination
      ? {
          total,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        }
      : {
          total,
          page: 1,
          pageSize: total,
          totalPages: 1,
        },
  };
}

export default getTasks;
