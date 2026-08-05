import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { createSmsMessage, lookupLeadByPhone } from "@/lib/dialer/db";
import {
  sendWhatsAppMessage,
  twilioClient,
  twilioPhoneNumber,
} from "@/lib/dialer/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Replaces the standalone /api/send-sms and /api/send-whatsapp. Unknown
// numbers do NOT auto-create leads — the message is stored with leadId=null.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const phoneNumber = body?.phoneNumber as string | undefined;
  const message = body?.message as string | undefined;
  const channel = (body?.channel as string | undefined) ?? "sms";
  const explicitLeadId = body?.leadId as string | undefined;
  const templateId = (body?.templateId as number | undefined) ?? null;

  if (!phoneNumber || !message) {
    return NextResponse.json(
      { error: "phoneNumber and message are required" },
      { status: 400 },
    );
  }
  if (channel !== "sms" && channel !== "whatsapp") {
    return NextResponse.json(
      { error: "channel must be 'sms' or 'whatsapp'" },
      { status: 400 },
    );
  }

  try {
    const lead = explicitLeadId
      ? { id: explicitLeadId, displayName: "", company: null, phone: null }
      : await lookupLeadByPhone(phoneNumber);

    if (channel === "whatsapp") {
      const twilioMessage = await sendWhatsAppMessage(
        lead,
        phoneNumber,
        message,
        templateId,
      );
      return NextResponse.json({
        success: true,
        messageSid: twilioMessage.sid,
        leadId: lead?.id ?? null,
      });
    }

    const twilioMessage = await twilioClient().messages.create({
      body: message,
      from: twilioPhoneNumber(),
      to: phoneNumber,
    });
    await createSmsMessage({
      leadId: lead?.id ?? null,
      phoneNumber,
      messageSid: twilioMessage.sid,
      messageBody: message,
      messageStatus: "sent",
      direction: "outbound",
      messageType: "sms",
      templateId,
    });
    return NextResponse.json({
      success: true,
      messageSid: twilioMessage.sid,
      leadId: lead?.id ?? null,
    });
  } catch (error) {
    console.error("Error sending message:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 },
    );
  }
}
