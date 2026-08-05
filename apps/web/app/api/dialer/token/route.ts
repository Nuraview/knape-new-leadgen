import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";
import { identityForUser } from "@/lib/dialer/identity";
import { AccessToken, VoiceGrant } from "@/lib/dialer/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  const twimlAppSid = process.env.TWIML_APP_SID;
  if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) {
    return NextResponse.json(
      { error: "Twilio is not configured" },
      { status: 503 },
    );
  }

  // Identity always derives from the session — never client-supplied.
  const identity = identityForUser(session.user.id);

  const token = new AccessToken(accountSid, apiKey, apiSecret, {
    identity,
    ttl: 3600,
  });
  token.addGrant(
    new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true,
    }),
  );

  return NextResponse.json({ identity, token: token.toJwt() });
}
