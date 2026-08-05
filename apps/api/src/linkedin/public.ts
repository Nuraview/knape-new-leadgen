/**
 * The public side of a share link.
 *
 * Mounted BEFORE the session gate, alongside the public proposal and portal
 * routers. The token in the path is the credential: it unlocks exactly one
 * post, and the payload is assembled field by field rather than spread from the
 * row, so nothing internal can leak by being added to the table later — no
 * internal title, no author, no review comments, no other post.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import crmDb from "../database/crm";
import {
  nvLinkedinPostMedia,
  nvLinkedinPosts,
} from "../database/crm-schema";
import { getBrand } from "../utils/get-brand";
import { requireCrm } from "./store";

const linkedinPublic = new Hono().get("/:token", async (c) => {
  requireCrm();
  const token = c.req.param("token").trim();
  if (!token) {
    throw new HTTPException(404, { message: "This link is no longer valid" });
  }

  const [post] = await crmDb
    .select()
    .from(nvLinkedinPosts)
    .where(
      and(
        eq(nvLinkedinPosts.shareToken, token),
        isNull(nvLinkedinPosts.deletedAt),
      ),
    )
    .limit(1);

  if (!post) {
    // Same answer for revoked, deleted and never-existed.
    throw new HTTPException(404, { message: "This link is no longer valid" });
  }

  const media = await crmDb
    .select()
    .from(nvLinkedinPostMedia)
    .where(eq(nvLinkedinPostMedia.postId, post.id))
    .orderBy(asc(nvLinkedinPostMedia.sortOrder), asc(nvLinkedinPostMedia.id));

  return c.json({
    post: {
      status: post.status,
      body: post.body,
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      timezone: post.timezone,
      publishedAt: post.publishedAt?.toISOString() ?? null,
      linkedinPostUrl: post.linkedinPostUrl,
    },
    media: media.map((m) => ({
      id: m.id,
      kind: m.kind,
      fileName: m.fileName,
      url: m.url,
    })),
    /** Whose feed this will appear in — shown above the preview. */
    author: getBrand().signature.personName || getBrand().shortName,
  });
});

export default linkedinPublic;
