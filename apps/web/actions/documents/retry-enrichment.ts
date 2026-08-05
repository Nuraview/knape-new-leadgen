"use server";
import { getSession } from "@/lib/auth-server";
import { orm } from "@/lib/db-compat";
import { inngest } from "@/inngest/client";
import { revalidatePath } from "next/cache";

export async function retryEnrichment(documentId: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  await orm.documents.update({
    where: { id: documentId },
    data: { processing_status: "PENDING", processing_error: null },
  });

  await inngest.send({
    name: "document/uploaded",
    data: { documentId },
  });

  revalidatePath("/documents");
}
