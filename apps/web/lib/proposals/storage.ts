import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { minioClient, MINIO_BUCKET } from "@/lib/minio";
import { put } from "@/lib/storage/objects";

// Proposal binaries (generated PDF, drawn signatures, portfolio assets) live in
// the self-hosted MinIO bucket. Public URLs are returned and stored directly on
// the proposal.

export async function uploadProposalPdf(
  proposalId: string,
  pdf: Buffer,
): Promise<string> {
  const { url } = await put(`proposals/${proposalId}/proposal.pdf`, pdf, {
    contentType: "application/pdf",
  });
  return url;
}

/**
 * Store a drawn signature PNG (decoded server-side from the public approve
 * route — that endpoint is unauthenticated, so we write the blob ourselves
 * rather than hand out an upload token).
 */
export async function uploadProposalSignature(
  proposalId: string,
  png: Buffer,
): Promise<string> {
  const { url } = await put(
    `proposals/${proposalId}/signature-${Date.now()}.png`,
    png,
    { contentType: "image/png" },
  );
  return url;
}

/**
 * Resolve a stored file reference to a fetchable URL. Blob assets already store
 * a public URL (returned as-is); legacy MinIO assets store a key and get a
 * short-lived presigned URL.
 */
export async function getProposalFilePresignedUrl(
  keyOrUrl: string,
  expirySeconds = 300,
): Promise<string> {
  if (/^https?:\/\//.test(keyOrUrl)) return keyOrUrl;
  return getSignedUrl(
    minioClient,
    new GetObjectCommand({ Bucket: MINIO_BUCKET, Key: keyOrUrl }),
    { expiresIn: expirySeconds },
  );
}
