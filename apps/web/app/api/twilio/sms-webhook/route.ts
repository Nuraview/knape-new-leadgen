import { NextRequest, NextResponse } from "next/server";

import { createSmsMessage, lookupLeadByPhone } from "@/lib/dialer/db";
import {
  forbidden,
  readTwilioParams,
  twimlResponse,
  validateTwilioSignature,
} from "@/lib/dialer/twilio-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// Inbound SMS + WhatsApp from Twilio. Unknown senders are stored with
// leadId=null — no auto-created leads.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const params = await readTwilioParams(req);
  if (!validateTwilioSignature(req, params)) return forbidden();

  try {
    const { MessageSid, From, Body, MessageStatus, SmsStatus } = params;
    const messageStatus = MessageStatus || SmsStatus || "received";

    if (!MessageSid || !From || !Body) {
      console.error("Missing required fields in SMS webhook");
      return twimlResponse(EMPTY_TWIML);
    }

    const messageType = From.startsWith("whatsapp:") ? "whatsapp" : "sms";
    const phoneNumber = From.replace("whatsapp:", "");
    const lead = await lookupLeadByPhone(phoneNumber);

    await createSmsMessage({
      leadId: lead?.id ?? null,
      phoneNumber,
      messageSid: MessageSid,
      messageBody: Body,
      messageStatus,
      direction: "inbound",
      messageType,
    });
  } catch (error) {
    // Still 200 so Twilio doesn't retry-storm us.
    console.error("Error processing incoming message:", error);
  }

  return twimlResponse(EMPTY_TWIML);
}
