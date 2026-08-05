"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export const removeTargetFromList = async (targetListId: string, targetId: string) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  if (!targetId) return { error: "targetId is required" };

  try {
    await orm.targetsToTargetLists.delete({
      where: {
        target_id_target_list_id: {
          target_id: targetId,
          target_list_id: targetListId,
        },
      },
    });
    revalidatePath("/crm/target-lists", "page");
    return { success: true };
  } catch (error) {
    return { error: "Failed to remove target from list" };
  }
};
