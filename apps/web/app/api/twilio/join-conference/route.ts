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
  const room = params.room;

  if (!room) {
    twiml.say("Conference room is missing.");
    twiml.hangup();
  } else {
    const dial = twiml.dial({ answerOnBridge: true });
    dial.conference(
      {
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        maxParticipants: 2,
      },
      room,
    );
  }

  return twimlResponse(twiml.toString());
}

export { handler as GET, handler as POST };
