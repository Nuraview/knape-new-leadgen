"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";
import { writeAuditLog } from "@/lib/audit-log";

export const deleteOpportunity = async (opportunityId: string) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  if (!opportunityId) return { error: "opportunityId is required" };

  try {
    await orm.crm_Opportunities.update({
      where: { id: opportunityId },
      data: { deletedAt: new Date(), deletedBy: session.user.id },
    });
    await writeAuditLog({
      entityType: "opportunity",
      entityId: opportunityId,
      action: "deleted",
      changes: null,
      userId: session.user.id,
    });
    revalidatePath("/crm/opportunities", "page");
    return { success: true };
  } catch (error) {
    console.log("[DELETE_OPPORTUNITY]", error);
    return { error: "Failed to delete opportunity" };
  }
};
