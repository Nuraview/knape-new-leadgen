import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getStorageBucket, getStorageClient } from "./s3";

/*
 * Reuses the API's existing S3 client rather than constructing a second one.
 * A parallel client is how two halves of an app end up pointed at different
 * buckets — the Trello attachment import already proved this path works.
 */
const bucket = () => getStorageBucket();

// Self-hosted replacement for @vercel/blob. Same shape as the three helpers the
// app used (put / list / del) so call sites stayed close to their Blob originals,
// plus presignPut for browser-direct uploads (Blob's client `upload()` handshake).
//
// Objects live in the MinIO bucket named by bucket(). Public reads go through
// nginx at NEXT_PUBLIC_FILES_URL (bucket has a download policy), never through a
// presigned GET — proposal PDFs and email images must not expire.

function publicBase(): string {
  // S3_PUBLIC_BASE_URL is the new stack's name for it; NEXT_PUBLIC_FILES_URL
  // stays as a fallback so a half-migrated .env produces identical URLs. These
  // end up inside delivered email and cannot be corrected afterwards.
  const base =
    process.env.S3_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_FILES_URL;
  if (!base) {
    throw new Error(
      "S3_PUBLIC_BASE_URL is not set — required to build public object URLs",
    );
  }
  return base.replace(/\/$/, "");
}

/** Public, non-expiring URL for a stored key. */
export function publicUrl(key: string): string {
  return `${publicBase()}/${key.replace(/^\//, "")}`;
}

/** Inverse of publicUrl. Returns null for URLs we don't host. */
export function keyFromUrl(url: string): string | null {
  const base = publicBase();
  if (url.startsWith(`${base}/`)) return url.slice(base.length + 1);
  return null;
}

export type PutResult = { url: string; pathname: string };

export async function put(
  pathname: string,
  body: Buffer | Uint8Array | string,
  opts: { contentType?: string } = {},
): Promise<PutResult> {
  const key = pathname.replace(/^\//, "");
  await getStorageClient().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      ContentType: opts.contentType,
    }),
  );
  return { url: publicUrl(key), pathname: key };
}

export type ListedObject = { pathname: string; url: string; size: number };

export async function list(
  opts: { prefix?: string; limit?: number } = {},
): Promise<{ blobs: ListedObject[] }> {
  const res = await getStorageClient().send(
    new ListObjectsV2Command({
      Bucket: bucket(),
      Prefix: opts.prefix,
      MaxKeys: opts.limit,
    }),
  );
  const blobs = (res.Contents ?? [])
    .filter((o): o is { Key: string; Size?: number } => Boolean(o.Key))
    .map((o) => ({
      pathname: o.Key,
      url: publicUrl(o.Key),
      size: o.Size ?? 0,
    }));
  return { blobs };
}

/** Accepts either a stored key or a public URL (Blob's del() took URLs). */
export async function del(keyOrUrl: string): Promise<void> {
  const key = /^https?:\/\//.test(keyOrUrl)
    ? keyFromUrl(keyOrUrl)
    : keyOrUrl.replace(/^\//, "");
  if (!key) return;
  await getStorageClient().send(
    new DeleteObjectCommand({ Bucket: bucket(), Key: key }),
  );
}

// Presigned URLs are consumed by the BROWSER, so they must be signed against a
// publicly reachable endpoint — MINIO_ENDPOINT is the container-internal
// http://cap-minio:9000, which no client can resolve. MINIO_PUBLIC_ENDPOINT
// points at the nginx passthrough (https://crmx1.nuraview.com/s3), which
// forwards to MinIO untouched so the SigV4 host+path still match.
let _publicClient: S3Client | null = null;

function publicSigningClient(): S3Client {
  const endpoint = process.env.MINIO_PUBLIC_ENDPOINT;
  if (!endpoint) return getStorageClient();
  if (_publicClient) return _publicClient;
  _publicClient = new S3Client({
    endpoint,
    region: "us-east-1",
    credentials: {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? "",
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? "",
    },
    forcePathStyle: true,
  });
  return _publicClient;
}

/**
 * Short-lived PUT URL so the browser uploads straight to MinIO — the server
 * never buffers the file (portfolio assets run to 100 MB).
 */
export async function presignPut(
  pathname: string,
  contentType: string,
  expirySeconds = 600,
): Promise<{ uploadUrl: string; url: string; pathname: string }> {
  const key = pathname.replace(/^\//, "");
  const uploadUrl = await getSignedUrl(
    publicSigningClient(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: expirySeconds },
  );
  return { uploadUrl, url: publicUrl(key), pathname: key };
}
