"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export const updateTargetList = async (data: {
  id: string;
  name?: string;
  description?: string;
  status?: boolean;
}) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  const { id, name, description, status } = data;
  if (!id) return { error: "id is required" };

  try {
    const existing = await orm.crm_TargetLists.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return { error: "Target list not found" };
    const list = await orm.crm_TargetLists.update({
      where: { id },
      data: { name, description, status },
    });
    revalidatePath("/crm/target-lists", "page");
    return { data: list };
  } catch (error) {
    return { error: "Failed to update target list" };
  }
};
