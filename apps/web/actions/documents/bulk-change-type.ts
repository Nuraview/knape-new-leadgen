"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { DocumentSystemType } from "@/lib/db-types";
import { revalidatePath } from "next/cache";

export async function bulkChangeType(documentIds: string[], systemType: DocumentSystemType) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  await orm.documents.updateMany({
    where: { id: { in: documentIds } },
    data: { document_system_type: systemType },
  });

  revalidatePath("/documents");
}
