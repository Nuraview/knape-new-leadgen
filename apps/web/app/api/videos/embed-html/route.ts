import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import {
  extractCapVideoId,
  renderVideoCardHtml,
  resolveCapEmbed,
} from "@/lib/videos/cap-embed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Copy embed HTML" in the lead drawer: resolve a Cap share link into the
// email-safe GIF thumbnail card (re-hosted on Vercel Blob) and return the
// markup so the reviewer can paste it into any external composer.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const { url } = await request.json().catch(() => ({ url: null }));
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }
  if (!extractCapVideoId(url)) {
    return NextResponse.json(
      { error: "Not a Cap share link (expected https://cap.nuraview.com/s/…)" },
      { status: 400 },
    );
  }

  try {
    const embed = await resolveCapEmbed(url);
    return NextResponse.json({ html: renderVideoCardHtml(embed), embed });
  } catch (err) {
    console.error("[VideoEmbed] resolve failed:", err);
    return NextResponse.json(
      { error: "Could not resolve the video preview — is the video processed and shareable?" },
      { status: 502 },
    );
  }
}
