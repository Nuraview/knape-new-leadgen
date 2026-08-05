import { NextRequest, NextResponse } from "next/server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import { mktEmailEvents as emailEvents, mktEmails as emails } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResendWebhookEvent = {
  type: string;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
    [key: string]: unknown;
  };
};

export async function POST(request: NextRequest) {
  try {
    const body: ResendWebhookEvent = await request.json();

    const { type, data } = body;
    const resendId = data.email_id;

    console.log(`[Webhook] Received event: ${type} for resendId: ${resendId}`);

    if (!resendId) {
      return NextResponse.json(
        { error: "Missing email_id in webhook payload" },
        { status: 400 },
      );
    }

    const [emailRecord] = await db
      .select({ id: emails.id })
      .from(emails)
      .where(eq(emails.resendId, resendId))
      .limit(1);

    if (!emailRecord) {
      console.warn(`[Webhook] No email found for resendId: ${resendId}`);
    }

    // Store the raw event
    await db.insert(emailEvents).values({
      resendId,
      emailId: emailRecord?.id || null,
      eventType: type,
      payload: body,
    });

    if (emailRecord) {
      switch (type) {
        case "email.sent":
          await db
            .update(emails)
            .set({ status: "sent" })
            .where(eq(emails.id, emailRecord.id));
          break;

        case "email.delivered":
          await db
            .update(emails)
            .set({ status: "delivered", deliveredAt: new Date(data.created_at) })
            .where(eq(emails.id, emailRecord.id));
          break;

        case "email.opened":
          await db
            .update(emails)
            .set({
              status: "opened",
              openedAt: sql`COALESCE(${emails.openedAt}, NOW())`,
              openedCount: sql`${emails.openedCount} + 1`,
            })
            .where(eq(emails.id, emailRecord.id));
          break;

        case "email.clicked":
          await db
            .update(emails)
            .set({
              status: "clicked",
              clickedAt: sql`COALESCE(${emails.clickedAt}, NOW())`,
              clickedCount: sql`${emails.clickedCount} + 1`,
            })
            .where(eq(emails.id, emailRecord.id));
          break;

        case "email.bounced":
          await db
            .update(emails)
            .set({ status: "bounced", bouncedAt: new Date(data.created_at) })
            .where(eq(emails.id, emailRecord.id));
          break;

        case "email.complained":
          await db
            .update(emails)
            .set({ status: "complained" })
            .where(eq(emails.id, emailRecord.id));
          break;

        default:
          console.log(`[Webhook] Unhandled event type: ${type}`);
      }

      revalidatePath("/marketing/dashboard");
      revalidatePath("/marketing/f/sent");
      revalidatePath("/marketing/f/inbox");
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[Webhook] Processing error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
