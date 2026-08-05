"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export const updateKanbanPosition = async (data: {
  resourceList: { id: string }[];
  destinationList: { id: string }[];
  resourceSectionId: string;
  destinationSectionId: string;
}) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  const {
    resourceList,
    destinationList,
    resourceSectionId,
    destinationSectionId,
  } = data;

  try {
    const resourceListReverse = [...resourceList].reverse();
    const destinationListReverse = [...destinationList].reverse();

    if (resourceSectionId !== destinationSectionId) {
      for (let key = 0; key < resourceListReverse.length; key++) {
        const task = resourceListReverse[key];
        await orm.tasks.update({
          where: { id: task.id },
          data: {
            section: resourceSectionId,
            position: key,
            updatedBy: session.user.id,
          },
        });
      }
    }

    for (let key = 0; key < destinationListReverse.length; key++) {
      const task = destinationListReverse[key];
      await orm.tasks.update({
        where: { id: task.id },
        data: {
          section: destinationSectionId,
          position: key,
          updatedBy: session.user.id,
        },
      });
    }

    revalidatePath("/projects", "page");
    return { success: true };
  } catch (error) {
    console.log("[UPDATE_KANBAN_POSITION]", error);
    return { error: "Failed to update task positions" };
  }
};
