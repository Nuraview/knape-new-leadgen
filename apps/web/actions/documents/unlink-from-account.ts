"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { revalidatePath } from "next/cache";

export async function unlinkFromAccount(documentId: string, accountId: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  await orm.documentsToAccounts.delete({
    where: {
      document_id_account_id: { document_id: documentId, account_id: accountId },
    },
  });

  revalidatePath("/documents");
  revalidatePath(`/crm/accounts/${accountId}`);
}
