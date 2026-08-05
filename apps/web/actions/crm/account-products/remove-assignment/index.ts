"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { writeAuditLog } from "@/lib/audit-log";
import { revalidatePath } from "next/cache";

export const removeAssignment = async (id: string) => {
  const session = await getSession();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }

  try {
    const assignment = await orm.crm_AccountProducts.update({
      where: { id },
      data: {
        status: "CANCELLED",
        updatedBy: session.user.id,
        v: { increment: 1 },
      },
    });

    await writeAuditLog({ entityType: "account_product", entityId: id, action: "cancelled", changes: null, userId: session.user.id });

    revalidatePath("/crm/accounts/[accountId]", "page");
    revalidatePath("/crm/products/[productId]", "page");
    return { data: { id: assignment.id } };
  } catch (error) {
    console.log("[REMOVE_ASSIGNMENT]", error);
    return { error: "Failed to cancel assignment" };
  }
};
