import { NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { mktEmails as emails } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/marketing/track/click?id=<emailId>&url=<encodedOriginalUrl>
 * Records the click and redirects to the original URL.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const emailId = searchParams.get("id");
    const redirectUrl = searchParams.get("url");

    if (!emailId || !redirectUrl) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 },
      );
    }

    try {
      new URL(redirectUrl);
    } catch {
      return NextResponse.json(
        { error: "Invalid redirect URL" },
        { status: 400 },
      );
    }

    const parsedId = parseInt(emailId, 10);
    if (isNaN(parsedId)) {
      return NextResponse.redirect(redirectUrl);
    }

    const [record] = await db
      .select()
      .from(emails)
      .where(eq(emails.id, parsedId))
      .execute();

    if (record) {
      // MUST await — on Vercel serverless, unawaited promises get killed
      // when the response is returned.
      await db
        .update(emails)
        .set({
          status: "clicked",
          clickedAt: record.clickedAt || new Date(),
          clickedCount: (record.clickedCount || 0) + 1,
        })
        .where(eq(emails.id, parsedId))
        .execute();

      try {
        revalidatePath("/marketing/dashboard");
        revalidatePath("/marketing/f/sent");
      } catch {
        // Ignore revalidation errors
      }
    }

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error("[Track Click] Failed to track email click:", error);
    try {
      const { searchParams } = new URL(req.url);
      const redirectUrl = searchParams.get("url");
      if (redirectUrl) {
        return NextResponse.redirect(redirectUrl);
      }
    } catch {
      // Ignore
    }
    return NextResponse.json(
      { error: "Failed to process tracking" },
      { status: 500 },
    );
  }
}
