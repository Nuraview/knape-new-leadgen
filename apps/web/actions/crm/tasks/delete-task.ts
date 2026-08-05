"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export const deleteTask = async (taskId: string) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  if (!taskId) return { error: "taskId is required" };

  try {
    // CRM account task comments link via `assigned_crm_account_task`, not
    // the Projects-facing `task` FK — see actions/crm/tasks/add-comment.ts.
    await orm.tasksComments.deleteMany({
      where: { assigned_crm_account_task: taskId },
    });

    await orm.documentsToCrmAccountsTasks.deleteMany({
      where: { crm_accounts_task_id: taskId },
    });

    await orm.crm_Accounts_Tasks.delete({
      where: { id: taskId },
    });

    revalidatePath("/crm", "page");
    return { success: true };
  } catch (error) {
    console.log("[DELETE_TASK]", error);
    return { error: "Failed to delete task" };
  }
};
