"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { UpdateAssignment } from "./schema";
import { InputType, ReturnType } from "./types";
import { createSafeAction } from "@/lib/create-safe-action";
import { writeAuditLog, diffObjects } from "@/lib/audit-log";
import { revalidatePath } from "next/cache";

const handler = async (data: InputType): Promise<ReturnType> => {
  const session = await getSession();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }

  const userId = session.user.id;
  const { id, ...updateData } = data;

  try {
    const existing = await orm.crm_AccountProducts.findUnique({ where: { id } });
    if (!existing) {
      return { error: "Assignment not found" };
    }

    const startDate = updateData.start_date ?? existing.start_date;
    if (updateData.end_date && updateData.end_date <= startDate) {
      return { error: "End date must be after start date" };
    }
    if (updateData.renewal_date && updateData.renewal_date <= startDate) {
      return { error: "Renewal date must be after start date" };
    }

    const assignment = await orm.crm_AccountProducts.update({
      where: { id },
      data: {
        ...(updateData.quantity !== undefined && { quantity: updateData.quantity }),
        ...(updateData.custom_price !== undefined && { custom_price: updateData.custom_price ? parseFloat(updateData.custom_price) : null }),
        ...(updateData.status !== undefined && { status: updateData.status }),
        ...(updateData.start_date !== undefined && { start_date: updateData.start_date }),
        ...(updateData.end_date !== undefined && { end_date: updateData.end_date }),
        ...(updateData.renewal_date !== undefined && { renewal_date: updateData.renewal_date }),
        ...(updateData.notes !== undefined && { notes: updateData.notes }),
        updatedBy: userId,
        v: { increment: 1 },
      },
    });

    await writeAuditLog({ entityType: "account_product", entityId: assignment.id, action: "updated", changes: diffObjects(existing as unknown as Record<string, unknown>, assignment as unknown as Record<string, unknown>), userId });

    revalidatePath("/crm/accounts/[accountId]", "page");
    revalidatePath("/crm/products/[productId]", "page");
    return { data: { id: assignment.id } };
  } catch (error) {
    console.log("[UPDATE_ASSIGNMENT]", error);
    return { error: "Failed to update assignment" };
  }
};

export const updateAssignment = createSafeAction(UpdateAssignment, handler);
