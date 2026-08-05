"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";
import { writeAuditLog } from "@/lib/audit-log";

export const deleteContact = async (contactId: string) => {
  const session = await getSession();
  if (!session) return { error: "Unauthorized" };

  if (!contactId) return { error: "contactId is required" };

  try {
    await orm.crm_Contacts.update({
      where: { id: contactId },
      data: { deletedAt: new Date(), deletedBy: session.user.id },
    });
    await writeAuditLog({
      entityType: "contact",
      entityId: contactId,
      action: "deleted",
      changes: null,
      userId: session.user.id,
    });
    revalidatePath("/crm/contacts", "page");
    return { success: true };
  } catch (error) {
    console.log("[DELETE_CONTACT]", error);
    return { error: "Failed to delete contact" };
  }
};
