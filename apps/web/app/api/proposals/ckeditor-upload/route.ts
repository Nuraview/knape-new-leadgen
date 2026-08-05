import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { put } from "@/lib/storage/objects";

export const runtime = "nodejs";

// Inline-image upload for the proposal CKEditor (CKEditor's SimpleUploadAdapter
// POSTs multipart form-data with the file under the field name `upload`, and
// expects `{ url }` back — or `{ error: { message } }` on failure). The file is
// streamed straight to MinIO server-side; the public URL is what gets
// embedded in the section HTML and later allow-listed by sanitizeProposalHtml.
const ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/avif",
]);
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: { message: "Unauthorized" } }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("upload");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: { message: "No image provided" } }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: { message: "Unsupported image type" } }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: { message: "Image too large (max 15 MB)" } }, { status: 413 });
  }

  try {
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
    const buffer = Buffer.from(await file.arrayBuffer());
    const { url } = await put(
      `proposal-inline/${Date.now()}-${crypto.randomUUID()}.${ext}`,
      buffer,
      { contentType: file.type },
    );
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json(
      { error: { message: e instanceof Error ? e.message : "Upload failed" } },
      { status: 500 },
    );
  }
}
