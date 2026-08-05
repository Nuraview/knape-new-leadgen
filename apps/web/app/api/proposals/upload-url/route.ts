import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { presignPut } from "@/lib/storage/objects";

export const runtime = "nodejs";

// Presigned-PUT handshake for proposal assets (portfolio files, banners, icons,
// branding logos). The browser uploads straight to MinIO so a 100 MB PDF never
// passes through the Next server. Replaces the former Vercel Blob client-upload
// token route; same auth check and same content-type/size gates.
const ALLOWED_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/gif",
  "image/avif",
]);
const MAX_BYTES = 100 * 1024 * 1024;

// Keys are server-sanitised: the client proposes a pathname, we strip traversal
// and anything outside the known prefixes so a session can't write elsewhere.
const ALLOWED_PREFIXES = [
  "proposals/",
  "proposal-banners/",
  "proposal-icons/",
  "proposal-avatars/",
  "proposal-branding/",
  "proposal-inline/",
];

export async function POST(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    pathname?: string;
    contentType?: string;
    size?: number;
  } | null;

  const pathname = (body?.pathname ?? "").replace(/^\/+/, "");
  const contentType = body?.contentType ?? "";
  const size = body?.size ?? 0;

  if (!pathname || pathname.includes("..")) {
    return NextResponse.json({ error: "Invalid pathname" }, { status: 400 });
  }
  if (!ALLOWED_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.json({ error: "Pathname not allowed" }, { status: 400 });
  }
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });
  }
  if (size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 100 MB)" }, { status: 413 });
  }

  try {
    const { uploadUrl, url } = await presignPut(pathname, contentType);
    return NextResponse.json({ uploadUrl, url });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not sign upload" },
      { status: 500 },
    );
  }
}
