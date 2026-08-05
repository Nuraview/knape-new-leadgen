"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export const markTaskDone = async (taskId: string) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  if (!taskId) return { error: "Missing task ID" };

  try {
    await orm.tasks.update({
      where: { id: taskId },
      data: {
        taskStatus: "COMPLETE",
        updatedBy: session.user.id,
      },
    });

    revalidatePath("/projects", "page");
    return { success: true };
  } catch (error) {
    console.log("[MARK_TASK_DONE]", error);
    return { error: "Failed to mark task as done" };
  }
};
