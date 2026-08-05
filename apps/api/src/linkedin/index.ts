/**
 * LinkedIn content scheduler — the staff side.
 *
 * Posts are written ahead of time, reviewed in the CRM against a feed-accurate
 * preview, approved, and then published at their scheduled time. Publishing is
 * manual today: whoever posts it pastes the live URL back in, which is what
 * moves the post to `published` and keeps this an accurate record of what
 * actually went out. The auto-publisher is a separate, later piece; the columns
 * it needs already exist.
 *
 * Data lives in the CRM database beside nv_orders — see drizzle/nv_linkedin.sql.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import crmDb from "../database/crm";
import {
  nvLinkedinPostMedia,
  nvLinkedinPosts,
} from "../database/crm-schema";
import { requireCrmAccess } from "../utils/require-crm-access";
import { draftPost } from "./ai/draft";
import { ANGLES } from "./ai/prompt";
import {
  assertAllowedContentType,
  isStorageConfigured,
  objectKeyFor,
  storeInline,
  UPLOAD_MAX_BYTES,
} from "./media";
import { notifyReviewers } from "./notify";
import {
  assertTransition,
  MANUAL_PUBLISH_FROM,
  POST_STATUSES,
  isPostStatus,
} from "./statuses";
import {
  assertBody,
  loadEvents,
  loadMedia,
  logEvent,
  requireCrm,
  requirePost,
  serializeEvent,
  serializeMedia,
  serializePost,
} from "./store";
import {
  isValidTimeZone,
  parseZonedLocal,
  reanchorToDate,
} from "./timezone";

const linkedin = new Hono<{
  Variables: { userId: string; userEmail: string };
}>()
  .use("*", requireCrmAccess)

  /** What the composer offers as a starting angle, and the status vocabulary. */
  .get("/meta", (c) =>
    c.json({
      statuses: POST_STATUSES,
      angles: ANGLES.map((a) => ({ key: a.key, name: a.name })),
      storageConfigured: isStorageConfigured(),
      aiConfigured: Boolean(process.env.OPENAI_API_KEY),
    }),
  )

  /**
   * The month, however the caller wants it bounded.
   *
   * `from`/`to` are ISO instants and are what the calendar sends: its grid
   * spills into the neighbouring months, so a card on a spill day still has to
   * come back. Unscheduled posts are ALWAYS included regardless of the window —
   * they live in the tray, and a draft that silently vanished because it has no
   * date yet is the bug this avoids.
   */
  .get("/posts", async (c) => {
    requireCrm();
    const status = c.req.query("status");
    const from = c.req.query("from");
    const to = c.req.query("to");

    const conditions: SQL[] = [isNull(nvLinkedinPosts.deletedAt)];
    if (status && isPostStatus(status)) {
      conditions.push(eq(nvLinkedinPosts.status, status));
    }

    const rows = await crmDb
      .select()
      .from(nvLinkedinPosts)
      .where(and(...conditions))
      .orderBy(asc(nvLinkedinPosts.scheduledAt), desc(nvLinkedinPosts.createdAt))
      .limit(1000);

    const windowStart = from ? new Date(from) : null;
    const windowEnd = to ? new Date(to) : null;
    const inWindow = (scheduledAt: Date | null) => {
      if (!scheduledAt) return true; // the tray
      if (windowStart && scheduledAt < windowStart) return false;
      if (windowEnd && scheduledAt > windowEnd) return false;
      return true;
    };

    const visible = rows.filter((row) => inWindow(row.scheduledAt));

    // One query for every post's media rather than one per post.
    const mediaByPost = new Map<string, Awaited<ReturnType<typeof loadMedia>>>();
    if (visible.length > 0) {
      const allMedia = await crmDb
        .select()
        .from(nvLinkedinPostMedia)
        .orderBy(asc(nvLinkedinPostMedia.sortOrder), asc(nvLinkedinPostMedia.id));
      for (const m of allMedia) {
        const list = mediaByPost.get(m.postId) ?? [];
        list.push(m);
        mediaByPost.set(m.postId, list);
      }
    }

    return c.json({
      items: visible.map((row) => ({
        ...serializePost(row),
        media: (mediaByPost.get(row.id) ?? []).map(serializeMedia),
      })),
    });
  })

  .get("/posts/:id", async (c) => {
    requireCrm();
    const post = await requirePost(c.req.param("id"));
    const [media, events] = await Promise.all([
      loadMedia(post.id),
      loadEvents(post.id),
    ]);
    return c.json({
      post: serializePost(post),
      media: media.map(serializeMedia),
      events: events.map(serializeEvent),
    });
  })

  .post("/posts", async (c) => {
    requireCrm();
    const body = await c.req.json<{
      body?: string;
      title?: string | null;
      /** Wall clock, resolved in `timezone` below. What the picker produces. */
      scheduledLocal?: string | null;
      timezone?: string;
    }>();

    const text = assertBody(body.body ?? "");
    const timezone = (body.timezone ?? "America/New_York").trim();
    if (!isValidTimeZone(timezone)) {
      throw new HTTPException(400, { message: `Unknown timezone ${timezone}` });
    }

    let scheduledAt: Date | null = null;
    if (body.scheduledLocal) {
      try {
        scheduledAt = parseZonedLocal(body.scheduledLocal, timezone);
      } catch (error) {
        throw new HTTPException(400, {
          message: error instanceof Error ? error.message : "Invalid time",
        });
      }
    }

    const id = randomUUID();
    const now = new Date();
    await crmDb.insert(nvLinkedinPosts).values({
      id,
      status: "draft",
      title: body.title?.trim() || null,
      body: text,
      scheduledAt,
      timezone,
      publishAttempts: 0,
      createdBy: c.get("userEmail") || null,
      createdAt: now,
      updatedAt: now,
    });

    return c.json({ post: serializePost(await requirePost(id)) }, 201);
  })

  /**
   * Edit.
   *
   * Two ways to move a post in time, both resolved in ITS OWN zone rather than
   * the caller's: `scheduledLocal` ("YYYY-MM-DDTHH:mm") is the datetime
   * picker's path, and `scheduledDate` ("YYYY-MM-DD") is the calendar's
   * drag-and-drop path, which keeps the time of day the post already had.
   * Passing `scheduledLocal: null` clears the schedule and returns it to the
   * tray. When both arrive the explicit time wins.
   *
   * Editing the body OR the schedule of an approved post sends it back for
   * review. That is the point of the tick: what was approved is what goes out,
   * and if either changes, it was not approved.
   */
  .patch("/posts/:id", async (c) => {
    requireCrm();
    const post = await requirePost(c.req.param("id"));
    const body = await c.req.json<{
      body?: string;
      title?: string | null;
      scheduledLocal?: string | null;
      scheduledDate?: string;
      timezone?: string;
    }>();

    const actor = c.get("userEmail") || null;
    const patch: Partial<typeof nvLinkedinPosts.$inferInsert> = {};

    if (body.timezone !== undefined) {
      const tz = body.timezone.trim();
      if (!isValidTimeZone(tz)) {
        throw new HTTPException(400, { message: `Unknown timezone ${tz}` });
      }
      if (tz !== post.timezone) patch.timezone = tz;
    }

    if (body.body !== undefined) {
      const text = assertBody(body.body);
      if (text !== post.body) patch.body = text;
    }

    if (body.title !== undefined) {
      const title = body.title?.trim() || null;
      if (title !== post.title) patch.title = title;
    }

    // The zone this patch leaves the post in, not the one it arrived with.
    const zone = patch.timezone ?? post.timezone;

    if (body.scheduledLocal !== undefined) {
      let next: Date | null = null;
      if (body.scheduledLocal) {
        try {
          next = parseZonedLocal(body.scheduledLocal, zone);
        } catch (error) {
          throw new HTTPException(400, {
            message: error instanceof Error ? error.message : "Invalid time",
          });
        }
      }
      if (next?.getTime() !== post.scheduledAt?.getTime()) {
        patch.scheduledAt = next;
      }
    } else if (body.scheduledDate !== undefined) {
      let next: Date;
      try {
        next = reanchorToDate(post.scheduledAt, zone, body.scheduledDate);
      } catch (error) {
        throw new HTTPException(400, {
          message: error instanceof Error ? error.message : "Invalid date",
        });
      }
      if (next.getTime() !== post.scheduledAt?.getTime()) {
        patch.scheduledAt = next;
      }
    }

    const contentChanged =
      patch.body !== undefined || patch.scheduledAt !== undefined;

    if (post.status === "published" && contentChanged) {
      throw new HTTPException(400, {
        message:
          "This post is already live on LinkedIn. Edit it there, or un-mark it as published first.",
      });
    }

    if (Object.keys(patch).length === 0) {
      return c.json({ post: serializePost(post) });
    }

    if (post.status === "approved" && contentChanged) {
      patch.status = "pending_approval";
      patch.approvedBy = null;
      patch.approvedAt = null;
    }

    patch.updatedAt = new Date();
    await crmDb
      .update(nvLinkedinPosts)
      .set(patch)
      .where(eq(nvLinkedinPosts.id, post.id));

    if (patch.status === "pending_approval") {
      // Say which it was: "rescheduled" reads very differently from "rewritten"
      // when Dan reads the timeline.
      await logEvent(
        post.id,
        "system",
        patch.body !== undefined
          ? "Edited after approval, so it needs a fresh review."
          : "Rescheduled after approval, so it needs a fresh review.",
        actor,
      );
      await notifyReviewers(post.id, post.title ?? post.body, actor);
    }

    return c.json({ post: serializePost(await requirePost(post.id)) });
  })

  /** Soft delete: a post that was reviewed keeps its trail. */
  .delete("/posts/:id", async (c) => {
    requireCrm();
    const post = await requirePost(c.req.param("id"));
    await crmDb
      .update(nvLinkedinPosts)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(nvLinkedinPosts.id, post.id));
    return c.json({ ok: true });
  })

  .post("/posts/:id/submit", async (c) => {
    requireCrm();
    const post = await requirePost(c.req.param("id"));
    assertTransition(post.status, "pending_approval");
    const actor = c.get("userEmail") || null;

    await crmDb
      .update(nvLinkedinPosts)
      .set({ status: "pending_approval", updatedAt: new Date() })
      .where(eq(nvLinkedinPosts.id, post.id));
    await logEvent(post.id, "system", "Submitted for approval.", actor);
    await notifyReviewers(post.id, post.title ?? post.body, actor);

    return c.json({ post: serializePost(await requirePost(post.id)) });
  })

  .post("/posts/:id/approve", async (c) => {
    requireCrm();
    const post = await requirePost(c.req.param("id"));
    assertTransition(post.status, "approved");
    const actor = c.get("userEmail") || null;

    await crmDb
      .update(nvLinkedinPosts)
      .set({
        status: "approved",
        approvedBy: actor,
        approvedAt: new Date(),
        // A re-approved failure gets a fresh set of attempts.
        publishAttempts: 0,
        publishError: null,
        updatedAt: new Date(),
      })
      .where(eq(nvLinkedinPosts.id, post.id));
    await logEvent(post.id, "approval", "Approved.", actor);

    return c.json({ post: serializePost(await requirePost(post.id)) });
  })

  .post("/posts/:id/request-changes", async (c) => {
    requireCrm();
    const post = await requirePost(c.req.param("id"));
    assertTransition(post.status, "needs_changes");
    const body = await c.req.json<{ comment?: string }>();
    const comment = (body.comment ?? "").trim();
    if (!comment) {
      throw new HTTPException(400, {
        message: "Please describe the changes you need",
      });
    }

    await crmDb
      .update(nvLinkedinPosts)
      .set({
        status: "needs_changes",
        approvedBy: null,
        approvedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(nvLinkedinPosts.id, post.id));
    await logEvent(post.id, "change_request", comment, c.get("userEmail") || null);

    return c.json({ post: serializePost(await requirePost(post.id)) });
  })

  .post("/posts/:id/comment", async (c) => {
    requireCrm();
    const post = await requirePost(c.req.param("id"));
    const body = await c.req.json<{ body?: string }>();
    const text = (body.body ?? "").trim();
    if (!text) throw new HTTPException(400, { message: "Comment cannot be empty" });

    await logEvent(post.id, "comment", text, c.get("userEmail") || null);
    return c.json({ ok: true });
  })

  // --- creatives -----------------------------------------------------------

  /**
   * Presign a direct upload. Only offered when object storage is configured;
   * otherwise the client posts the bytes to /media below and they are inlined.
   */
  .post("/upload-url", async (c) => {
    const body = await c.req.json<{
      postId?: string;
      fileName?: string;
      contentType?: string;
      size?: number;
    }>();

    if (!isStorageConfigured()) {
      throw new HTTPException(503, {
        message: "Object storage is not configured on this deployment",
      });
    }
    assertAllowedContentType(body.contentType ?? "");
    if (typeof body.size === "number" && body.size > UPLOAD_MAX_BYTES) {
      throw new HTTPException(400, { message: "File is larger than 100 MB" });
    }
    const post = await requirePost(body.postId ?? "");

    const { presignPut } = await import("../storage/objects");
    const signed = await presignPut(
      objectKeyFor(post.id, body.fileName ?? "creative"),
      body.contentType ?? "application/octet-stream",
    );
    return c.json(signed);
  })

  /**
   * Attach a creative.
   *
   * Two shapes, one route: a JSON body with a `url` records an upload that
   * already went straight to storage; a raw binary body carries the bytes for
   * this API to store. The second path is what makes the module usable on a
   * deployment with no object storage yet.
   */
  .post("/posts/:id/media", async (c) => {
    requireCrm();
    const post = await requirePost(c.req.param("id"));
    const contentType = c.req.header("content-type") ?? "";

    let url: string;
    let fileName: string;
    let mediaType: string;
    let sizeBytes: number | null = null;

    if (contentType.includes("application/json")) {
      const body = await c.req.json<{
        url?: string;
        fileName?: string;
        contentType?: string;
        size?: number;
      }>();
      if (!body.url) throw new HTTPException(400, { message: "url is required" });
      assertAllowedContentType(body.contentType ?? "");
      url = body.url;
      fileName = body.fileName ?? "creative";
      mediaType = body.contentType ?? "";
      sizeBytes = body.size ?? null;
    } else {
      const declared = c.req.query("contentType") ?? contentType;
      assertAllowedContentType(declared);
      const bytes = Buffer.from(await c.req.arrayBuffer());
      if (bytes.byteLength === 0) {
        throw new HTTPException(400, { message: "Empty file" });
      }
      if (bytes.byteLength > UPLOAD_MAX_BYTES) {
        throw new HTTPException(400, { message: "File is larger than 100 MB" });
      }
      fileName = c.req.query("fileName") ?? "creative";
      mediaType = declared;
      sizeBytes = bytes.byteLength;
      url = await storeInline(post.id, fileName, declared, bytes);
    }

    const existing = await loadMedia(post.id);
    const [row] = await crmDb
      .insert(nvLinkedinPostMedia)
      .values({
        id: randomUUID(),
        postId: post.id,
        kind: assertAllowedContentType(mediaType),
        fileName,
        url,
        contentType: mediaType,
        sizeBytes,
        sortOrder: existing.length,
        createdAt: new Date(),
      })
      .returning();

    return c.json({ media: row ? serializeMedia(row) : null }, 201);
  })

  .delete("/media/:id", async (c) => {
    requireCrm();
    const id = c.req.param("id");
    const [row] = await crmDb
      .select()
      .from(nvLinkedinPostMedia)
      .where(eq(nvLinkedinPostMedia.id, id))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "Creative not found" });

    await crmDb
      .delete(nvLinkedinPostMedia)
      .where(eq(nvLinkedinPostMedia.id, id));
    return c.json({ ok: true });
  })

  // --- share links ---------------------------------------------------------

  /**
   * Mint (idempotently) the public preview link. The token is a capability: it
   * grants read access to exactly one post and nothing else, and revoking it is
   * one click — which is why it is a column rather than the post id.
   */
  .post("/posts/:id/share", async (c) => {
    requireCrm();
    const post = await requirePost(c.req.param("id"));
    if (post.shareToken) {
      return c.json({ shareToken: post.shareToken });
    }
    const token = randomBytes(16).toString("base64url");
    await crmDb
      .update(nvLinkedinPosts)
      .set({ shareToken: token, updatedAt: new Date() })
      .where(eq(nvLinkedinPosts.id, post.id));
    return c.json({ shareToken: token });
  })

  .delete("/posts/:id/share", async (c) => {
    requireCrm();
    const post = await requirePost(c.req.param("id"));
    await crmDb
      .update(nvLinkedinPosts)
      .set({ shareToken: null, updatedAt: new Date() })
      .where(eq(nvLinkedinPosts.id, post.id));
    return c.json({ ok: true });
  })

  // --- manual publishing ---------------------------------------------------

  .post("/posts/:id/published", async (c) => {
    requireCrm();
    const post = await requirePost(c.req.param("id"));
    const body = await c.req.json<{ url?: string }>();
    const url = (body.url ?? "").trim();

    if (!url) {
      throw new HTTPException(400, {
        message: "Paste the link to the live LinkedIn post",
      });
    }
    if (!/^https?:\/\//.test(url)) {
      throw new HTTPException(400, {
        message: "That does not look like a link — it should start with https://",
      });
    }
    if (url.length > 1000) {
      throw new HTTPException(400, { message: "That link is too long to be real" });
    }
    if (!MANUAL_PUBLISH_FROM.includes(post.status)) {
      throw new HTTPException(400, {
        message:
          "Approve the post first — only approved posts can be marked as published",
      });
    }

    const wasPublished = post.status === "published";
    await crmDb
      .update(nvLinkedinPosts)
      .set({
        status: "published",
        linkedinPostUrl: url,
        publishedAt: post.publishedAt ?? new Date(),
        publishError: null,
        updatedAt: new Date(),
      })
      .where(eq(nvLinkedinPosts.id, post.id));
    await logEvent(
      post.id,
      "system",
      wasPublished
        ? "Updated the link to the live LinkedIn post."
        : "Posted to LinkedIn by hand, link recorded.",
      c.get("userEmail") || null,
    );

    return c.json({ post: serializePost(await requirePost(post.id)) });
  })

  /**
   * Undo a manual publish (wrong post, wrong link) — back to approved.
   *
   * Refused for anything the auto-publisher sent: that really is live on
   * LinkedIn under a URN we did not invent, and pretending otherwise here would
   * only make this record wrong.
   */
  .delete("/posts/:id/published", async (c) => {
    requireCrm();
    const post = await requirePost(c.req.param("id"));
    if (post.status !== "published") {
      throw new HTTPException(400, {
        message: "This post is not marked as published",
      });
    }
    if (post.linkedinPostUrn) {
      throw new HTTPException(400, {
        message:
          "This post was published automatically — it cannot be un-published here",
      });
    }

    await crmDb
      .update(nvLinkedinPosts)
      .set({
        status: "approved",
        linkedinPostUrl: null,
        publishedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(nvLinkedinPosts.id, post.id));
    await logEvent(
      post.id,
      "system",
      "Un-marked as published, back to approved.",
      c.get("userEmail") || null,
    );

    return c.json({ post: serializePost(await requirePost(post.id)) });
  })

  // --- AI ------------------------------------------------------------------

  .post("/draft", async (c) => {
    const body = await c.req.json<{ topic?: string; angle?: string | null }>();
    const result = await draftPost(body.topic ?? "", body.angle ?? null);
    return c.json(result);
  });

export default linkedin;
