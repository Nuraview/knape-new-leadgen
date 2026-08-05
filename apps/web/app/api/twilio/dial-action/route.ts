import { NextRequest, NextResponse } from "next/server";

import { updateCallStatus, type CallStatus } from "@/lib/dialer/db";
import {
  forbidden,
  readTwilioParams,
  twimlResponse,
  validateTwilioSignature,
} from "@/lib/dialer/twilio-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const params = await readTwilioParams(req);
  if (!validateTwilioSignature(req, params)) return forbidden();

  const { DialCallStatus, DialCallDuration, CallSid } = params;
  try {
    if (CallSid && DialCallStatus) {
      await updateCallStatus(
        CallSid,
        DialCallStatus as CallStatus,
        DialCallDuration ? parseInt(DialCallDuration, 10) : null,
      );
    }
  } catch (error) {
    console.error("dial-action error:", error);
  }

  return twimlResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
  );
}
