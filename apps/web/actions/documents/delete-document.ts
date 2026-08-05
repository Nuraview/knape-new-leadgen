"use server";
import { getSession } from "@/lib/auth-server";

import { orm } from "@/lib/db-compat";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { minioClient, MINIO_BUCKET } from "@/lib/minio";

export async function deleteDocument(documentId: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthenticated");

  if (!documentId) throw new Error("Document ID is required");

  const document = await orm.documents.findUnique({
    where: { id: documentId },
  });

  if (!document) throw new Error("Document not found");

  await orm.documents.delete({ where: { id: documentId } });

  if (document.key) {
    await minioClient.send(
      new DeleteObjectCommand({
        Bucket: MINIO_BUCKET,
        Key: document.key,
      })
    );
  }
}
