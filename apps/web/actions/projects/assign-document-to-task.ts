"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export const assignDocumentToTask = async (data: {
  documentId: string;
  taskId: string;
}) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  const { documentId, taskId } = data;
  if (!documentId) return { error: "Missing document ID" };
  if (!taskId) return { error: "Missing task ID" };

  try {
    const task = await orm.tasks.findUnique({
      where: { id: taskId },
    });

    if (!task) return { error: "Task not found" };

    await orm.documentsToTasks.create({
      data: {
        document_id: documentId,
        task_id: taskId,
      },
    });

    await orm.tasks.update({
      where: { id: taskId },
      data: { updatedBy: session.user.id },
    });

    revalidatePath("/projects", "page");
    return { success: true };
  } catch (error) {
    console.log("[ASSIGN_DOCUMENT_TO_TASK]", error);
    return { error: "Failed to assign document to task" };
  }
};

export const disconnectDocumentFromTask = async (data: {
  documentId: string;
  taskId: string;
}) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  const { documentId, taskId } = data;
  if (!documentId) return { error: "Missing document ID" };
  if (!taskId) return { error: "Missing task ID" };

  try {
    const task = await orm.tasks.findUnique({
      where: { id: taskId },
    });

    if (!task) return { error: "Task not found" };

    await orm.documentsToTasks.delete({
      where: {
        document_id_task_id: {
          document_id: documentId,
          task_id: taskId,
        },
      },
    });

    const updatedTask = await orm.tasks.update({
      where: { id: taskId },
      data: { updatedBy: session.user.id },
    });

    revalidatePath("/projects", "page");
    return { data: updatedTask };
  } catch (error) {
    console.log("[DISCONNECT_DOCUMENT_FROM_TASK]", error);
    return { error: "Failed to disconnect document from task" };
  }
};
