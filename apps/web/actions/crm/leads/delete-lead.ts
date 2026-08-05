"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";
import { writeAuditLog } from "@/lib/audit-log";

export const deleteLead = async (leadId: string) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  if (!leadId) return { error: "leadId is required" };

  try {
    await orm.crm_Leads.update({
      where: { id: leadId },
      data: { deletedAt: new Date(), deletedBy: session.user.id },
    });
    await writeAuditLog({
      entityType: "lead",
      entityId: leadId,
      action: "deleted",
      changes: null,
      userId: session.user.id,
    });
    revalidatePath("/crm/leads", "page");
    return { success: true };
  } catch (error) {
    console.log("[DELETE_LEAD]", error);
    return { error: "Failed to delete lead" };
  }
};
