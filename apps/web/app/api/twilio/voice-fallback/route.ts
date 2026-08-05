import { NextRequest, NextResponse } from "next/server";

import { VoiceResponse } from "@/lib/dialer/twilio";
import {
  forbidden,
  readTwilioParams,
  twimlResponse,
  validateTwilioSignature,
} from "@/lib/dialer/twilio-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(req: NextRequest): Promise<NextResponse> {
  const params = await readTwilioParams(req);
  if (!validateTwilioSignature(req, params)) return forbidden();

  const twiml = new VoiceResponse();
  twiml.hangup();
  return twimlResponse(twiml.toString());
}

export { handler as GET, handler as POST };
