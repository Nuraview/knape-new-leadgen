import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  taskProjectTable,
  taskTable,
  userTable,
} from "../../database/schema";

async function getTask(taskId: string) {
  const task = await db
    .select({
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
      projectId: taskTable.projectId,
      // Work stream, flattened here and re-nested below. The detail panel and
      // the board card both render it, so both payloads have to carry it —
      // the picker showed "No project" on a card that had one when only the
      // board query was updated.
      taskProjectId: taskTable.taskProjectId,
      taskProjectName: taskProjectTable.name,
      taskProjectColor: taskProjectTable.color,
    })
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .leftJoin(
      taskProjectTable,
      eq(taskTable.taskProjectId, taskProjectTable.id),
    )
    .where(eq(taskTable.id, taskId))
    .limit(1);

  if (!task.length || !task[0]) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  const {
    taskProjectName,
    taskProjectColor,
    ...rest
  } = task[0];

  return {
    ...rest,
    taskProject:
      rest.taskProjectId && taskProjectName
        ? {
            id: rest.taskProjectId,
            name: taskProjectName,
            color: taskProjectColor ?? "gray",
          }
        : null,
  };
}

export default getTask;
