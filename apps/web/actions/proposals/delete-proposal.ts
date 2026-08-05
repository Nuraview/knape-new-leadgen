"use server";

import { orm } from "@/lib/db-compat";
import { getUser } from "@/actions/get-user";
import { revalidatePath } from "next/cache";

export async function deleteProposal(id: string) {
  await getUser();
  await orm.crm_Proposals.update({
    where: { id },
    data: { deletedAt: new Date().toISOString() },
  });
  revalidatePath("/proposals");
  return { id };
}
