import { randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";

/**
 * Where a creative's bytes go.
 *
 * Preferred path is the same one Proposals uses: a presigned PUT straight to
 * object storage, with only the resulting URL stored on the row. But the Win
 * the Day deployment has no S3 credentials set today, and a scheduler whose
 * image attachments 503 is not a scheduler you can review posts in. So when
 * storage is absent this falls back to inlining small files as data URIs.
 *
 * The fallback is deliberately narrow — a few hundred KB, images only — because
 * it puts bytes in a text column, which is fine for a handful of creatives and
 * wrong at any real volume. Configure S3_ENDPOINT / S3_BUCKET /
 * S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY and every upload takes the good path
 * instead, with no code change and no migration.
 */

const INLINE_MAX_BYTES = 700 * 1024;
export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

const ALLOWED_IMAGE = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/avif",
]);
const ALLOWED_VIDEO = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT?.trim() && process.env.S3_BUCKET?.trim(),
  );
}

export function assertAllowedContentType(contentType: string): "image" | "video" {
  if (ALLOWED_IMAGE.has(contentType)) return "image";
  if (ALLOWED_VIDEO.has(contentType)) return "video";
  throw new HTTPException(400, {
    message: `Only images and videos can be attached (got ${contentType || "nothing"})`,
  });
}

/** Filenames end up in a URL path — keep them boring. */
export function safeFileName(name: string): string {
  return (name || "creative").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120);
}

export function objectKeyFor(postId: string, fileName: string): string {
  return `linkedin-posts/${postId}/${randomUUID().slice(0, 8)}-${safeFileName(fileName)}`;
}

/**
 * Store bytes that arrived through the API rather than through a presigned PUT.
 * Uses object storage when it is configured and a data URI when it is not.
 */
export async function storeInline(
  postId: string,
  fileName: string,
  contentType: string,
  bytes: Buffer,
): Promise<string> {
  if (isStorageConfigured()) {
    const { put } = await import("../storage/objects");
    const result = await put(objectKeyFor(postId, fileName), bytes, {
      contentType,
    });
    return result.url;
  }

  if (!ALLOWED_IMAGE.has(contentType)) {
    throw new HTTPException(503, {
      message:
        "Video attachments need object storage. Set S3_ENDPOINT and S3_BUCKET on this deployment.",
    });
  }
  if (bytes.byteLength > INLINE_MAX_BYTES) {
    throw new HTTPException(413, {
      message: `Without object storage configured, creatives must be under ${Math.round(
        INLINE_MAX_BYTES / 1024,
      )} KB. Set S3_ENDPOINT and S3_BUCKET to lift this.`,
    });
  }
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}
