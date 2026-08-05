"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export async function bulkLinkToAccount(documentIds: string[], accountId: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  await orm.documentsToAccounts.createMany({
    data: documentIds.map((document_id) => ({ document_id, account_id: accountId })),
    skipDuplicates: true,
  });

  revalidatePath("/documents");
}
