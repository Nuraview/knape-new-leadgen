"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export const deleteTarget = async (targetId: string) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  if (!targetId) return { error: "targetId is required" };

  try {
    await orm.crm_Targets.update({
      where: { id: targetId },
      data: { deletedAt: new Date(), deletedBy: session.user.id },
    });
    revalidatePath("/crm/targets", "page");
    return { success: true };
  } catch (error) {
    return { error: "Failed to delete target" };
  }
};
