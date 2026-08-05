import { NextRequest, NextResponse } from "next/server";

import {
  forbidden,
  readTwilioParams,
  validateTwilioSignature,
} from "@/lib/dialer/twilio-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const params = await readTwilioParams(req);
  if (!validateTwilioSignature(req, params)) return forbidden();

  console.log(
    `/api/twilio/number-status: CallSid=${params.CallSid} status=${params.CallStatus}`,
  );
  return new NextResponse(null, { status: 200 });
}
