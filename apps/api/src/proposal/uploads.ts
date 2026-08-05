/**
 * Proposal asset uploads — banners, inline images, branding.
 *
 * Ported from apps/web/app/api/proposals/{upload-url,ckeditor-upload}. These
 * two were the ONLY legacy endpoints the SPA still called, so porting them is
 * what lets the Next app be switched off rather than merely bypassed.
 *
 * PATHS ARE FROZEN: /api/proposals/upload-url and /api/proposals/ckeditor-upload
 * are hard-coded inside the ported sections editor and the CKEditor upload
 * adapter. Keeping the URLs identical means neither had to be touched.
 *
 * The client PROPOSES a pathname; the server decides. Traversal is rejected and
 * the key must fall under a known prefix, so a valid session cannot be used to
 * write over arbitrary bucket objects. Content types and size are allow-listed
 * for the same reason — an "image upload" that accepts text/html is a hosted
 * XSS on our own domain.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { presignPut, put } from "../storage/objects";

const uploads = new Hono<{ Variables: { userId: string; userEmail: string } }>();

const MAX_BYTES = 100 * 1024 * 1024;

/** Verbatim from the legacy route — the bucket layout depends on these. */
const ALLOWED_PREFIXES = [
  "proposals/",
  "proposal-banners/",
  "proposal-icons/",
  "proposal-avatars/",
  "proposal-branding/",
  "proposal-inline/",
];

const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
]);

function assertSafeKey(pathname: string) {
  if (!pathname || pathname.includes("..")) {
    throw new HTTPException(400, { message: "Invalid pathname" });
  }
  if (!ALLOWED_PREFIXES.some((p) => pathname.startsWith(p))) {
    throw new HTTPException(400, { message: "Pathname not allowed" });
  }
}

/** Two-step upload: we authorise, the browser PUTs straight to MinIO. */
uploads.post("/upload-url", async (c) => {
  const body = await c.req
    .json<{ pathname?: string; contentType?: string; size?: number }>()
    .catch(() => ({}) as Record<string, never>);

  const pathname = (body.pathname ?? "").replace(/^\/+/, "");
  const contentType = body.contentType ?? "";

  assertSafeKey(pathname);

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new HTTPException(400, {
      message: `Content type not allowed: ${contentType || "(none)"}`,
    });
  }
  if (typeof body.size === "number" && body.size > MAX_BYTES) {
    throw new HTTPException(400, { message: "File is larger than 100 MB" });
  }

  const signed = await presignPut(pathname, contentType);
  return c.json(signed);
});

/**
 * CKEditor's SimpleUploadAdapter posts a multipart file and expects
 * `{ url }` back — that response shape is CKEditor's contract, not ours.
 */
uploads.post("/ckeditor-upload", async (c) => {
  const form = await c.req.parseBody();
  const file = form.upload ?? form.file;

  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: "No file uploaded" });
  }
  if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
    throw new HTTPException(400, {
      message: `Content type not allowed: ${file.type || "(none)"}`,
    });
  }
  if (file.size > MAX_BYTES) {
    throw new HTTPException(400, { message: "File is larger than 100 MB" });
  }

  // Server-generated key: CKEditor sends only a filename, and trusting it would
  // let an editor overwrite another proposal's banner by naming a file the same.
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const key = `proposal-inline/${crypto.randomUUID()}-${safeName}`;

  const result = await put(key, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type,
  });
  return c.json({ url: result.url });
});

export default uploads;
