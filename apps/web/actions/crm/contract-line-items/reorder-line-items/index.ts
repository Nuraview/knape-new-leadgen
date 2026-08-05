"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export const reorderContractLineItems = async (
  items: { id: string; sort_order: number }[]
) => {
  const session = await getSession();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }

  try {
    await orm.$transaction(
      items.map((item) =>
        orm.crm_ContractLineItems.update({
          where: { id: item.id },
          data: { sort_order: item.sort_order },
        })
      )
    );

    revalidatePath("/crm/contracts/[contractId]", "page");
    return { data: { success: true } };
  } catch (error) {
    console.log("[REORDER_CONTRACT_LINE_ITEMS]", error);
    return { error: "Failed to reorder line items" };
  }
};
