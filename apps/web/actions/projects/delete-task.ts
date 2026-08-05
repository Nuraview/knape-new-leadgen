"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export const deleteTask = async (data: { id: string; section?: string }) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  const { id } = data;
  if (!id) return { error: "Missing task ID" };

  try {
    const currentTask = await orm.tasks.findUnique({
      where: { id },
    });

    // Delete all task comments first (foreign key constraint)
    await orm.tasksComments.deleteMany({
      where: { task: id },
    });

    await orm.tasks.delete({
      where: { id },
    });

    if (currentTask) {
      // Reorder remaining tasks in the section
      const tasks = await orm.tasks.findMany({
        where: { section: currentTask.section },
        orderBy: { position: "asc" },
      });

      for (const key in tasks) {
        const position = parseInt(key);
        await orm.tasks.update({
          where: { id: tasks[key].id },
          data: {
            updatedBy: session.user.id,
            position,
          },
        });
      }
    }

    revalidatePath("/projects", "page");
    return { success: true };
  } catch (error) {
    console.log("[DELETE_TASK]", error);
    return { error: "Failed to delete task" };
  }
};
