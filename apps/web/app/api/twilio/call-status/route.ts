import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@/lib/wait-until";

import { db } from "@/lib/db";
import { crmActivities, crmActivityLinks } from "@/lib/db/schema";
import {
  createCall,
  getCallBySid,
  lookupLeadByPhone,
  setCallActivityId,
  updateCallStatus,
  type CallDirection,
  type CallStatus as DialerCallStatus,
  type LeadMatch,
} from "@/lib/dialer/db";
import { stripClientPrefix, userIdFromIdentity } from "@/lib/dialer/identity";
import { sendFollowUpSMS } from "@/lib/dialer/twilio";
import {
  forbidden,
  readTwilioParams,
  validateTwilioSignature,
} from "@/lib/dialer/twilio-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MISSED_STATUSES = new Set(["busy", "no-answer", "failed"]);
const TERMINAL_STATUSES = new Set([
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const params = await readTwilioParams(req);
  if (!validateTwilioSignature(req, params)) return forbidden();

  const { CallSid, CallStatus, From, To, Direction, Duration, CallDuration } =
    params;

  try {
    let lead: LeadMatch | null = null;
    let phoneNumber: string | null = null;
    let agentIdentity: string | null = null;

    if (Direction === "outbound-dial" && From?.startsWith("client:")) {
      phoneNumber = To;
      agentIdentity = stripClientPrefix(From);
      lead = await lookupLeadByPhone(phoneNumber);
    } else if (Direction === "inbound" && From?.startsWith("+")) {
      phoneNumber = From;
      lead = await lookupLeadByPhone(phoneNumber);
    }

    const duration = parseInt(CallDuration || Duration || "", 10);

    // Ensure a row exists for this call before updating it. createCall is
    // idempotent (onConflictDoNothing on callSid), so calling it on every event
    // means the call is still logged even if the "initiated" callback never
    // arrives (e.g. status-callback events misconfigured) — without it, the
    // update below would silently no-op and the call would never appear.
    if (phoneNumber) {
      await createCall({
        leadId: lead?.id ?? null,
        phoneNumber,
        callSid: CallSid,
        status: CallStatus as DialerCallStatus,
        direction: Direction as CallDirection,
        agentIdentity,
      });
    }
    // Always update by CallSid so calls don't get stuck active forever.
    await updateCallStatus(
      CallSid,
      CallStatus as DialerCallStatus,
      Number.isNaN(duration) ? null : duration,
    );

    // Missed-call follow-up SMS (env-gated; replaces per-contact smsEnabled).
    if (
      MISSED_STATUSES.has(CallStatus) &&
      phoneNumber &&
      Direction === "inbound" &&
      process.env.DIALER_MISSED_CALL_SMS === "1"
    ) {
      waitUntil(sendFollowUpSMS(lead, phoneNumber, CallSid));
    }

    // Lead timeline: log terminal calls as crm_Activities.
    if (TERMINAL_STATUSES.has(CallStatus)) {
      waitUntil(
        logCallActivity(CallSid, CallStatus as DialerCallStatus).catch((error) =>
          console.error("call activity logging failed:", error),
        ),
      );
    }
  } catch (error) {
    console.error("call-status webhook error:", error);
  }

  return new NextResponse(null, { status: 200 });
}

async function logCallActivity(callSid: string, status: DialerCallStatus) {
  const call = await getCallBySid(callSid);
  if (!call || !call.leadId || call.activityId) return;

  const missed = status !== "completed" || !call.duration;
  const directionLabel = call.direction === "inbound" ? "Inbound" : "Outbound";
  const activityId = randomUUID();
  const createdBy = call.agentIdentity
    ? userIdFromIdentity(call.agentIdentity)
    : null;

  await db.insert(crmActivities).values({
    id: activityId,
    type: "call",
    title: `${directionLabel} call — ${call.phoneNumber}`,
    date: new Date().toISOString(),
    duration: call.duration ?? null,
    outcome: missed ? "missed" : "answered",
    status: "completed",
    metadata: {
      callSid: call.callSid,
      direction: call.direction,
      phoneNumber: call.phoneNumber,
      agentIdentity: call.agentIdentity,
      callStatus: status,
    },
    createdBy,
  });
  await db.insert(crmActivityLinks).values({
    id: randomUUID(),
    activityId,
    entityType: "lead",
    entityId: call.leadId,
  });
  await setCallActivityId(call.id, activityId);
}
