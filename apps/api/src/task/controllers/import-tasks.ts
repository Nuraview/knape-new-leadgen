import { and, desc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  labelTable,
  projectTable,
  taskProjectTable,
  taskRelationTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import {
  type BoardColumns,
  boardColumns,
  placeIn,
} from "../placement";
import {
  coercePriority,
  coerceStatus,
  getValidTaskStatuses,
} from "../validate-task-fields";
import getNextTaskNumber from "./get-next-task-number";

export type ImportTask = {
  title: string;
  description?: string;
  status: string;
  priority?: string;
  startDate?: string | null;
  dueDate?: string | null;
  userId?: string | null;
  /** Resolved to a user id. Unknown addresses leave the card unassigned. */
  assigneeEmail?: string | null;
  /**
   * Or name them. Matched case-insensitively against the full name and its
   * first word, so "Muadh" finds "Muadh Ali". People writing a batch from
   * meeting notes know who they mean, not what address we hold for them.
   */
  assigneeName?: string | null;
  /** Work stream NAME. Created on first use, reused after. */
  project?: string | null;
  /** Label names. Created per card, as labels already are. */
  labels?: string[];
  /** Subtask titles. Each becomes a real task linked by task_relation. */
  subtasks?: string[];
};

/** Stable colour per name, so the same stream/label looks the same everywhere. */
const PALETTE = [
  "teal",
  "red",
  "orange",
  "purple",
  "yellow",
  "green",
  "pink",
  "gray",
];
function colourFor(name: string) {
  let sum = 0;
  for (const ch of name) sum += ch.charCodeAt(0);
  return PALETTE[sum % PALETTE.length] as string;
}

async function importTasks(
  projectId: string,
  tasksToImport: ImportTask[],
  currentUserId?: string,
) {
  const project = await db.query.projectTable.findFirst({
    where: eq(projectTable.id, projectId),
  });

  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  const validStatuses = await getValidTaskStatuses(projectId);

  /*
   * Resolve the by-name fields ONCE for the whole batch rather than per row.
   * A 200-row paste naming four streams and six people should issue ten
   * lookups, not twelve hundred.
   */
  const emails = [
    ...new Set(
      tasksToImport
        .map((t) => t.assigneeEmail?.trim().toLowerCase())
        .filter((e): e is string => Boolean(e)),
    ),
  ];
  const users = emails.length
    ? await db
        .select({ id: userTable.id, email: userTable.email })
        .from(userTable)
        .where(inArray(userTable.email, emails))
    : [];
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u.id]));

  /*
   * Names, resolved once for the batch like the addresses above. A name is
   * only accepted when it identifies exactly ONE person — "Muadh" is fine,
   * but if two people ever share a first name the card is left unassigned and
   * says so rather than guessing which of them was meant.
   */
  const wantsName = tasksToImport.some((t) => t.assigneeName?.trim());
  const roster = wantsName
    ? await db
        .select({ id: userTable.id, name: userTable.name })
        .from(userTable)
    : [];
  const byName = new Map<string, string[]>();
  for (const person of roster) {
    const full = (person.name ?? "").trim().toLowerCase();
    if (!full) continue;
    for (const key of new Set([full, full.split(/\s+/)[0] as string])) {
      byName.set(key, [...(byName.get(key) ?? []), person.id]);
    }
  }

  const streamNames = [
    ...new Set(
      tasksToImport
        .map((t) => t.project?.trim())
        .filter((n): n is string => Boolean(n)),
    ),
  ];
  const streamByName = new Map<string, string>();
  for (const name of streamNames) {
    const [existing] = await db
      .select({ id: taskProjectTable.id })
      .from(taskProjectTable)
      .where(
        and(
          eq(taskProjectTable.workspaceId, project.workspaceId),
          eq(taskProjectTable.name, name),
        ),
      )
      .limit(1);
    if (existing) {
      streamByName.set(name, existing.id);
      continue;
    }
    const [created] = await db
      .insert(taskProjectTable)
      .values({
        workspaceId: project.workspaceId,
        name,
        color: colourFor(name),
      })
      .returning({ id: taskProjectTable.id });
    if (created) streamByName.set(name, created.id);
  }

  /*
   * Numbering and ordering, per destination board.
   *
   * Counted in memory rather than re-read per card: (project_id, number) is
   * unique, and a 200-row import that asks the database for "the current max"
   * 200 times is 200 chances to hand out the same number twice. Position is
   * kept moving for the same reason it exists — imported cards used to arrive
   * at position 0 in a heap, so the board's order was whatever the database
   * felt like returning.
   */
  const cursors = new Map<string, { number: number; position: number }>();
  const columnsByBoard = new Map<string, BoardColumns>();

  const nextSlot = async (boardId: string) => {
    let cursor = cursors.get(boardId);
    if (!cursor) {
      const [last] = await db
        .select({ position: taskTable.position })
        .from(taskTable)
        .where(eq(taskTable.projectId, boardId))
        .orderBy(desc(taskTable.position))
        .limit(1);
      cursor = {
        number: await getNextTaskNumber(boardId),
        position: last?.position ?? 0,
      };
      cursors.set(boardId, cursor);
    }
    cursor.number += 1;
    cursor.position += 1;
    return { number: cursor.number, position: cursor.position };
  };

  const columnsFor = async (boardId: string) => {
    let columns = columnsByBoard.get(boardId);
    if (!columns) {
      columns = await boardColumns(boardId);
      columnsByBoard.set(boardId, columns);
    }
    return columns;
  };

  const results = [];

  for (const taskData of tasksToImport) {
    try {
      const { status: pastedStatus, warning: statusWarning } = coerceStatus(
        taskData.status,
        validStatuses,
      );
      const { priority, warning: priorityWarning } = coercePriority(
        taskData.priority || "low",
      );
      const warnings = [statusWarning, priorityWarning].filter(Boolean);

      const namedMatches = taskData.assigneeName?.trim()
        ? (byName.get(taskData.assigneeName.trim().toLowerCase()) ?? [])
        : [];

      const resolvedAssignee =
        taskData.userId ||
        (taskData.assigneeEmail
          ? (userByEmail.get(taskData.assigneeEmail.trim().toLowerCase()) ??
            null)
          : null) ||
        (namedMatches.length === 1 ? (namedMatches[0] as string) : null);

      if (taskData.assigneeName?.trim() && namedMatches.length !== 1) {
        warnings.push(
          namedMatches.length > 1
            ? `"${taskData.assigneeName}" matches ${namedMatches.length} people — left unassigned`
            : `Unknown assignee "${taskData.assigneeName}"`,
        );
      }

      if (taskData.assigneeEmail && !resolvedAssignee) {
        // Named someone we do not have. The card is still worth creating —
        // losing a whole import row over one typo'd address is the wrong
        // trade — but the caller is told which ones landed unassigned.
        warnings.push(`Unknown assignee "${taskData.assigneeEmail}"`);
      }

      /*
       * Every row lands on the board being imported into.
       *
       * NuraView re-homes an assigned card onto the assignee's own board; that
       * rule is theirs, and it needs a board per person to re-home onto. Here a
       * board belongs to the client, several people work the same one, and
       * scattering a pasted batch across boards by who is named on each row
       * would be the opposite of what the paste asked for.
       */
      const boardId = projectId;
      const placed = placeIn(await columnsFor(boardId), pastedStatus);
      const status = placed.status;

      if (boardId !== projectId) {
        warnings.push("Sent to the assignee's board");
      }

      const slot = await nextSlot(boardId);

      const [createdTask] = await db
        .insert(taskTable)
        .values({
          projectId: boardId,
          userId: resolvedAssignee,
          title: taskData.title,
          status,
          columnId: placed.columnId,
          startDate: taskData.startDate ? new Date(taskData.startDate) : null,
          dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
          description: taskData.description || "",
          priority,
          number: slot.number,
          position: slot.position,
          taskProjectId: taskData.project
            ? (streamByName.get(taskData.project.trim()) ?? null)
            : null,
        })
        .returning();

      if (createdTask) {
        for (const name of taskData.labels ?? []) {
          const trimmed = name.trim();
          if (!trimmed) continue;
          await db
            .insert(labelTable)
            .values({
              taskId: createdTask.id,
              workspaceId: project.workspaceId,
              name: trimmed,
              color: colourFor(trimmed),
            })
            .onConflictDoNothing();
        }

        /*
         * Subtasks are real tasks joined by task_relation — the shape the
         * detail panel and the card badge already read. They are created on
         * the SAME board as their parent, whichever board that turned out to
         * be: a child on a different board from its parent is a card nobody
         * looking at the parent can reach.
         *
         * The board hides them as cards of their own (get-tasks marks them
         * with parentTaskId) and shows them on the front of the parent, which
         * is what a checklist item is. Before that they were pasted in as
         * ordinary cards: one line of a checklist became a column entry, and
         * a 12-row import with three subtasks each produced a board of 48.
         */
        for (const rawTitle of taskData.subtasks ?? []) {
          const subTitle = rawTitle.trim();
          if (!subTitle) continue;
          const childSlot = await nextSlot(boardId);
          const [child] = await db
            .insert(taskTable)
            .values({
              projectId: boardId,
              title: subTitle,
              status,
              columnId: placed.columnId,
              description: "",
              priority: "no-priority",
              number: childSlot.number,
              position: childSlot.position,
              userId: resolvedAssignee,
            })
            .returning();
          if (child) {
            await db.insert(taskRelationTable).values({
              sourceTaskId: createdTask.id,
              targetTaskId: child.id,
              relationType: "subtask",
            });
          }
        }

        await publishEvent("task.created", {
          ...createdTask,
          taskId: createdTask.id,
          userId: createdTask.userId ?? "",
          currentUserId: currentUserId ?? "",
          type: "create",
          content: "imported the task",
        });

        results.push({
          success: true,
          task: createdTask,
          ...(warnings.length > 0 && { warnings }),
        });
      } else {
        results.push({
          success: false,
          error: "Failed to create task",
          task: taskData,
        });
      }
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      results.push({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        task: taskData,
      });
    }
  }

  return {
    importedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
    },
    results: {
      total: tasksToImport.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      tasks: results,
    },
  };
}

export default importTasks;
