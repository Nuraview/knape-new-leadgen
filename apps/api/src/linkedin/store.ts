import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import crmDb, { isCrmConfigured } from "../database/crm";
import {
  nvLinkedinEvents,
  nvLinkedinPostMedia,
  nvLinkedinPosts,
} from "../database/crm-schema";

/** Shared plumbing for the scheduler's routers. */

export function requireCrm(): void {
  if (!isCrmConfigured()) {
    throw new HTTPException(503, {
      message: "CRM_DATABASE_URL is not configured",
    });
  }
}

export type PostRow = typeof nvLinkedinPosts.$inferSelect;

/** LinkedIn's hard cap on a post. */
export const MAX_BODY = 3000;

/**
 * Load one post, or 404.
 *
 * Soft-deleted rows are invisible to every read path — the `deleted_at` filter
 * belongs here rather than at each call site so a new endpoint cannot forget it.
 */
export async function requirePost(id: string): Promise<PostRow> {
  const [row] = await crmDb
    .select()
    .from(nvLinkedinPosts)
    .where(and(eq(nvLinkedinPosts.id, id), isNull(nvLinkedinPosts.deletedAt)))
    .limit(1);

  if (!row) throw new HTTPException(404, { message: "Post not found" });
  return row;
}

export async function loadMedia(postId: string) {
  return crmDb
    .select()
    .from(nvLinkedinPostMedia)
    .where(eq(nvLinkedinPostMedia.postId, postId))
    .orderBy(asc(nvLinkedinPostMedia.sortOrder), asc(nvLinkedinPostMedia.id));
}

export async function loadEvents(postId: string) {
  return crmDb
    .select()
    .from(nvLinkedinEvents)
    .where(eq(nvLinkedinEvents.postId, postId))
    .orderBy(asc(nvLinkedinEvents.createdAt), asc(nvLinkedinEvents.id));
}

/** Append to the review trail. Every status change writes one of these. */
export async function logEvent(
  postId: string,
  kind: "comment" | "change_request" | "approval" | "system",
  body: string,
  author: string | null,
): Promise<void> {
  await crmDb.insert(nvLinkedinEvents).values({
    id: randomUUID(),
    postId,
    author,
    kind,
    body,
    createdAt: new Date(),
  });
}

export function assertBody(body: string): string {
  const trimmed = (body ?? "").trim();
  if (!trimmed) {
    throw new HTTPException(400, { message: "Post text is required" });
  }
  if (trimmed.length > MAX_BODY) {
    throw new HTTPException(400, {
      message: `LinkedIn caps a post at ${MAX_BODY.toLocaleString()} characters`,
    });
  }
  return trimmed;
}

/** What the calendar and the detail dialog both render. */
export function serializePost(row: PostRow) {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    body: row.body,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    timezone: row.timezone,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    shareToken: row.shareToken,
    linkedinPostUrl: row.linkedinPostUrl,
    /** Presence means the auto-publisher posted it, not a person. */
    autoPublished: Boolean(row.linkedinPostUrn),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    publishError: row.publishError,
    publishAttempts: row.publishAttempts,
    createdBy: row.createdBy,
    createdAt: row.createdAt?.toISOString() ?? null,
  };
}

export function serializeMedia(
  row: typeof nvLinkedinPostMedia.$inferSelect,
) {
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    url: row.url,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
  };
}

export function serializeEvent(row: typeof nvLinkedinEvents.$inferSelect) {
  return {
    id: row.id,
    author: row.author,
    kind: row.kind,
    body: row.body,
    createdAt: row.createdAt?.toISOString() ?? null,
  };
}
