import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@/lib/wait-until";

import {
  getActiveClients,
  getRecentActiveCalls,
  lookupCallerByPhone,
} from "@/lib/dialer/db";
import { stripClientPrefix } from "@/lib/dialer/identity";
import {
  sendIncomingCallPush,
  sendIncomingCallPushRetries,
} from "@/lib/dialer/push";
import { VoiceResponse } from "@/lib/dialer/twilio";
import {
  forbidden,
  publicBaseUrl,
  readTwilioParams,
  twimlResponse,
  validateTwilioSignature,
} from "@/lib/dialer/twilio-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Push retries keep running via waitUntil after the TwiML response returns.
export const maxDuration = 60;

const DUPLICATE_WINDOW_MS = 3000;

async function handler(req: NextRequest): Promise<NextResponse> {
  const params = await readTwilioParams(req);
  if (!validateTwilioSignature(req, params)) return forbidden();

  const twiml = new VoiceResponse();
  const baseUrl = publicBaseUrl();

  const callTo = params.To;
  const callFrom = params.From;
  const direction = params.Direction;
  const callSid = params.CallSid;
  const joinConferenceRoom = params.room;

  try {
    if (joinConferenceRoom || callTo?.startsWith("conference:")) {
      // Agent answering a push-delivered call: join the held caller's room.
      const room = joinConferenceRoom || callTo.replace("conference:", "");
      const dial = twiml.dial({ timeout: 45, record: "do-not-record", answerOnBridge: true });
      dial.conference(
        {
          startConferenceOnEnter: true,
          endConferenceOnExit: true,
          maxParticipants: 2,
        },
        room,
      );
    } else if (callFrom?.startsWith("client:") && callTo?.startsWith("+")) {
      await handleOutboundClientCall(twiml, baseUrl, callTo, stripClientPrefix(callFrom));
    } else if (callTo === process.env.TWILIO_PHONE_NUMBER && direction === "inbound") {
      await handleInboundCall(twiml, baseUrl, callSid, callFrom);
    } else if (callTo?.startsWith("client:")) {
      const dial = twiml.dial({
        timeout: 30,
        record: "do-not-record",
        callerId: callFrom,
        answerOnBridge: true,
        action: `${baseUrl}/api/twilio/dial-action`,
        method: "POST",
      });
      const client = dial.client(stripClientPrefix(callTo));
      const caller = await lookupCallerByPhone(callFrom);
      if (caller?.displayName) {
        client.parameter({ name: "contactName", value: caller.displayName });
      }
      if (caller?.secondary) {
        client.parameter({ name: "contactRequirement", value: caller.secondary });
      }
    } else {
      twiml.say("Sorry, this call cannot be completed. Please try again.");
      twiml.hangup();
    }
  } catch (error) {
    console.error("Voice webhook error:", error);
    twiml.say("Sorry, there was an error processing your call. Please try again.");
    twiml.hangup();
  }

  return twimlResponse(twiml.toString());
}

async function handleOutboundClientCall(
  twiml: InstanceType<typeof VoiceResponse>,
  baseUrl: string,
  callTo: string,
  agentIdentity: string,
) {
  // Guard scoped to THIS agent so simultaneous agents don't block each other.
  // getRecentActiveCalls also auto-cleans calls stuck active >2h.
  const activeCalls = await getRecentActiveCalls(agentIdentity);
  const now = Date.now();

  const duplicateAttempt = activeCalls.some(
    (call) =>
      call.phoneNumber === callTo &&
      now - new Date(call.createdAt ?? 0).getTime() < DUPLICATE_WINDOW_MS,
  );
  if (duplicateAttempt) {
    twiml.say("Duplicate call detected. Please wait before trying again.");
    twiml.hangup();
    return;
  }

  if (activeCalls.length > 0) {
    twiml.say(
      "You already have an active call. Please end your current call before making a new one.",
    );
    twiml.hangup();
    return;
  }

  const dial = twiml.dial({
    callerId: process.env.TWILIO_PHONE_NUMBER,
    timeout: 20,
    record: "do-not-record",
    ringTone: "us",
    answerOnBridge: true,
    action: `${baseUrl}/api/twilio/dial-action`,
    method: "POST",
  });
  dial.number(callTo);
}

async function handleInboundCall(
  twiml: InstanceType<typeof VoiceResponse>,
  baseUrl: string,
  callSid: string,
  callFrom: string,
) {
  const activeClients = await getActiveClients(30);

  if (activeClients.length > 0) {
    // Ring ALL online agents under one <Dial> — first to accept wins.
    const dial = twiml.dial({
      timeout: 30,
      callerId: callFrom,
      answerOnBridge: true,
      action: `${baseUrl}/api/twilio/dial-action`,
      method: "POST",
    });
    const caller = await lookupCallerByPhone(callFrom);
    for (const agent of activeClients) {
      const client = dial.client(agent.identity);
      if (caller?.displayName) {
        client.parameter({ name: "contactName", value: caller.displayName });
      }
      if (caller?.secondary) {
        client.parameter({ name: "contactRequirement", value: caller.secondary });
      }
    }
    return;
  }

  // Offline fallback: park caller in a conference + push-notify agents.
  const conferenceRoom = `room_${callSid}`;

  try {
    await sendIncomingCallPush({
      callSid,
      conference: conferenceRoom,
      from: callFrom,
      attempt: 1,
      maxAttempts: 5,
    });
    waitUntil(
      sendIncomingCallPushRetries({
        callSid,
        conference: conferenceRoom,
        from: callFrom,
        maxAttempts: 5,
        intervalMs: 4000,
      }),
    );
  } catch (error) {
    console.error("Failed sending incoming-call push:", error);
  }

  twiml.say("Please hold while we connect you to an agent.");
  const dial = twiml.dial({
    timeout: 45,
    action: `${baseUrl}/api/twilio/push-decline`,
    method: "POST",
  });
  dial.conference(
    {
      waitUrl: `${baseUrl}/api/twilio/hold-music`,
      waitMethod: "POST",
      beep: "false",
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      maxParticipants: 2,
    },
    conferenceRoom,
  );
}

export { handler as GET, handler as POST };
