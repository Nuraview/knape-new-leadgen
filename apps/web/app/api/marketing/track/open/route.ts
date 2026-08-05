import { NextRequest, NextResponse } from "next/server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { mktEmails as emails } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1x1 transparent GIF
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

const PIXEL_HEADERS = {
  "Content-Type": "image/gif",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

/**
 * GET /api/marketing/track/open?id=<emailId>
 * Returns a 1×1 transparent GIF and records the open event.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const emailId = searchParams.get("id");

    if (!emailId) {
      return new NextResponse(TRANSPARENT_GIF, { headers: PIXEL_HEADERS });
    }

    const parsedId = parseInt(emailId, 10);
    if (isNaN(parsedId)) {
      return new NextResponse(TRANSPARENT_GIF, { headers: PIXEL_HEADERS });
    }

    const [record] = await db
      .select()
      .from(emails)
      .where(eq(emails.id, parsedId))
      .execute();

    if (record) {
      await db
        .update(emails)
        .set({
          status: "opened",
          openedAt: record.openedAt || new Date(),
          openedCount: (record.openedCount || 0) + 1,
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

    return new NextResponse(TRANSPARENT_GIF, { headers: PIXEL_HEADERS });
  } catch (error) {
    console.error("[Track Open] Failed to track email open:", error);
    return new NextResponse(TRANSPARENT_GIF, { headers: PIXEL_HEADERS });
  }
}
