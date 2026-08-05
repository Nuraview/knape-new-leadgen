/**
 * Twilio webhooks.
 *
 * Ported from apps/web/app/api/twilio/**. Mounted BEFORE the session middleware
 * — Twilio holds no cookie; the request signature IS the authentication, and
 * every route validates it before doing anything.
 *
 * Two of the nine are here. `hold-music` and `voice-fallback` are pure TwiML
 * with no other dependencies, which makes them the honest way to prove the
 * signature layer works end-to-end behind nginx before the rest follow. The
 * remaining seven (voice, call-status, dial-action, join-conference,
 * number-status, push-decline, sms-webhook) need the dialer's database and push
 * helpers and land with Phase D.
 *
 * All nine keep their exact legacy paths: Twilio's console holds these URLs and
 * they are only repointed once, at cutover.
 */
import type { Context } from "hono";
import { Hono } from "hono";
import twilio from "twilio";
import {
  ACTIVE_CALL_STATUSES,
  ensureCall,
  getActiveClients,
  getRecentActiveCalls,
  insertInboundMessage,
  lookupCallerByPhone,
  updateCallStatus,
} from "./calls";
import { sendIncomingCallPush } from "../dialer/push";
import {
  forbidden,
  publicBaseUrl,
  readTwilioParams,
  twimlResponse,
  validateTwilioSignature,
} from "./webhook";

/** Two dials of the same number inside this window is a double-click. */
const DUPLICATE_WINDOW_MS = 3000;

/** Twilio's `client:` prefix on a From/To value. */
const stripClientPrefix = (v: string | undefined) =>
  (v ?? "").replace(/^client:/, "");

const VoiceResponse = twilio.twiml.VoiceResponse;

const twilioApi = new Hono();

/**
 * Every handler is GET+POST because Twilio can be configured either way per
 * webhook, and the signature scheme differs between them (GET signs the query
 * string, POST signs the sorted form body).
 */
function twiml(
  path: string,
  build: (response: InstanceType<typeof VoiceResponse>) => void,
) {
  const handler = async (c: Context) => {
    const params = await readTwilioParams(c);
    if (!validateTwilioSignature(c, params)) return forbidden(c);

    const response = new VoiceResponse();
    build(response);
    return twimlResponse(c, response.toString());
  };

  twilioApi.get(path, handler);
  twilioApi.post(path, handler);
}

twiml("/hold-music", (response) => {
  response.say({ loop: 3 }, "Please hold. We are connecting you to an agent.");
});

// Twilio calls this when the primary voice webhook errors or times out. Hanging
// up is deliberate: a caller hearing silence forever is worse than a clean end.
twiml("/voice-fallback", (response) => {
  response.hangup();
});

/**
 * THE voice webhook — every call, in or out, is routed by this one handler.
 *
 * Four shapes arrive here and the order of the checks matters:
 *   1. a room param / "conference:" To — an agent accepting a parked caller
 *   2. From client: + To +E.164   — an agent dialling out
 *   3. To == our number, inbound  — a prospect calling us
 *   4. To client:                  — a direct client-to-client call
 *
 * Any thrown error still returns TwiML that speaks and hangs up. A 500 here
 * means the caller hears Twilio's generic failure tone, which is worse than an
 * apology.
 */
twilioApi.post("/voice", async (c) => {
  const params = await readTwilioParams(c);
  if (!validateTwilioSignature(c, params)) return forbidden(c);

  const response = new VoiceResponse();
  const baseUrl = publicBaseUrl();

  const { To: callTo, From: callFrom, Direction: direction, CallSid: callSid } =
    params;
  const room = params.room;

  try {
    if (room || callTo?.startsWith("conference:")) {
      // Agent answering a push-delivered call: join the held caller's room.
      const target = room || (callTo ?? "").replace("conference:", "");
      const dial = response.dial({
        timeout: 45,
        record: "do-not-record",
        answerOnBridge: true,
      });
      dial.conference(
        {
          startConferenceOnEnter: true,
          endConferenceOnExit: true,
          maxParticipants: 2,
        },
        target,
      );
    } else if (callFrom?.startsWith("client:") && callTo?.startsWith("+")) {
      await handleOutboundClientCall(
        response,
        baseUrl,
        callTo,
        stripClientPrefix(callFrom),
        callSid,
      );
    } else if (callTo === process.env.TWILIO_PHONE_NUMBER && direction === "inbound") {
      await handleInboundCall(response, baseUrl, callSid, callFrom);
    } else if (callTo?.startsWith("client:")) {
      const dial = response.dial({
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
        client.parameter({
          name: "contactRequirement",
          value: caller.secondary,
        });
      }
    } else {
      response.say("Sorry, this call cannot be completed. Please try again.");
      response.hangup();
    }
  } catch (error) {
    console.error("[twilio/voice]", error);
    response.say(
      "Sorry, there was an error processing your call. Please try again.",
    );
    response.hangup();
  }

  return twimlResponse(c, response.toString());
});

async function handleOutboundClientCall(
  response: InstanceType<typeof VoiceResponse>,
  baseUrl: string,
  callTo: string,
  agentIdentity: string,
  callSid: string | undefined,
) {
  // Guard scoped to THIS agent so two people dialling at once don't block each
  // other. getRecentActiveCalls also reaps calls stuck active over 2h.
  const active = await getRecentActiveCalls(agentIdentity);
  const now = Date.now();

  const duplicate = active.some(
    (call) =>
      call.phoneNumber === callTo &&
      now - new Date(call.createdAt ?? 0).getTime() < DUPLICATE_WINDOW_MS,
  );
  if (duplicate) {
    response.say("Duplicate call detected. Please wait before trying again.");
    response.hangup();
    return;
  }

  if (active.length > 0) {
    response.say(
      "You already have an active call. Please end your current call before making a new one.",
    );
    response.hangup();
    return;
  }

  if (callSid) {
    await ensureCall({
      callSid,
      phoneNumber: callTo,
      status: "initiated",
      direction: "outbound-api",
      agentIdentity,
    });
  }

  const dial = response.dial({
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
  response: InstanceType<typeof VoiceResponse>,
  baseUrl: string,
  callSid: string | undefined,
  callFrom: string | undefined,
) {
  const activeClients = await getActiveClients(30);

  if (callSid && callFrom) {
    await ensureCall({
      callSid,
      phoneNumber: callFrom,
      status: "ringing",
      direction: "inbound",
    });
  }

  if (activeClients.length > 0) {
    // Ring EVERY online agent under one <Dial> — first to accept wins.
    const dial = response.dial({
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
        client.parameter({
          name: "contactRequirement",
          value: caller.secondary,
        });
      }
    }
    return;
  }

  /*
   * Nobody online: park the caller in a conference so the line stays open, and
   * push every registered browser so an agent with the tab CLOSED still finds
   * out. This is the path that was missing — previously the caller just held
   * until somebody happened to open the dialer.
   *
   * Fire-and-forget, deliberately not awaited: TwiML must go back to Twilio
   * immediately or the caller hears silence. A push that fails must never
   * delay or break the call, so the promise is detached and only logged.
   */
  const conferenceRoom = `room_${callSid ?? "unknown"}`;
  if (callSid && callFrom) {
    void sendIncomingCallPush({
      callSid,
      conference: conferenceRoom,
      from: callFrom,
    }).catch((error: unknown) =>
      console.error("[twilio] incoming-call push failed:", error),
    );
  }

  response.say("Please hold while we connect you to an agent.");
  const dial = response.dial({
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

/** Twilio's per-call status callbacks. Keeps dialer_calls in step. */
twilioApi.post("/call-status", async (c) => {
  const params = await readTwilioParams(c);
  if (!validateTwilioSignature(c, params)) return forbidden(c);

  const { CallSid, CallStatus, From, To, Direction, CallDuration, Duration } =
    params;

  try {
    if (CallSid && CallStatus) {
      // The row may not exist if the status callback beats the voice webhook.
      await ensureCall({
        callSid: CallSid,
        phoneNumber: To || From || "unknown",
        status: CallStatus,
        // NOT `|| "inbound"`. An absent Direction means Twilio did not tell
        // us, and guessing inbound is wrong roughly half the time — that guess
        // is why every row in dialer_calls said inbound. "unknown" is honest,
        // and ensureCall will correct it if a later callback knows better.
        direction: Direction || "unknown",
      });
      await updateCallStatus(
        CallSid,
        CallStatus,
        CallDuration
          ? Number.parseInt(CallDuration, 10)
          : Duration
            ? Number.parseInt(Duration, 10)
            : null,
      );
    }
  } catch (error) {
    console.error("[twilio/call-status]", error);
  }

  return twimlResponse(
    c,
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
  );
});

/** Fires when a <Dial> finishes — records how the leg ended. */
twilioApi.post("/dial-action", async (c) => {
  const params = await readTwilioParams(c);
  if (!validateTwilioSignature(c, params)) return forbidden(c);

  try {
    if (params.CallSid && params.DialCallStatus) {
      await updateCallStatus(
        params.CallSid,
        params.DialCallStatus,
        params.DialCallDuration
          ? Number.parseInt(params.DialCallDuration, 10)
          : null,
      );
    }
  } catch (error) {
    console.error("[twilio/dial-action]", error);
  }

  // Empty TwiML: the call is already over, we just acknowledge.
  return twimlResponse(
    c,
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
  );
});

/** The parked caller's conference timed out with nobody joining. */
twilioApi.post("/push-decline", async (c) => {
  const params = await readTwilioParams(c);
  if (!validateTwilioSignature(c, params)) return forbidden(c);

  const response = new VoiceResponse();
  response.say(
    "Sorry, nobody is available right now. Please try again later.",
  );
  response.hangup();
  return twimlResponse(c, response.toString());
});

/** Inbound SMS / WhatsApp. Recorded against the lead when we can match it. */
twilioApi.post("/sms-webhook", async (c) => {
  const params = await readTwilioParams(c);
  if (!validateTwilioSignature(c, params)) return forbidden(c);

  try {
    const from = (params.From ?? "").replace(/^whatsapp:/, "");
    const isWhatsapp = (params.From ?? "").startsWith("whatsapp:");

    await insertInboundMessage({
      messageSid: params.MessageSid ?? params.SmsSid ?? "",
      from,
      body: params.Body ?? "",
      status: params.SmsStatus ?? "received",
      type: isWhatsapp ? "whatsapp" : "sms",
    });
  } catch (error) {
    console.error("[twilio/sms-webhook]", error);
  }

  return twimlResponse(
    c,
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
  );
});

/** Twilio pings this when a number's configuration changes. Ack only. */
twilioApi.post("/number-status", async (c) => {
  const params = await readTwilioParams(c);
  if (!validateTwilioSignature(c, params)) return forbidden(c);
  return twimlResponse(
    c,
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
  );
});

/** An agent joining the conference the parked caller is waiting in. */
twilioApi.post("/join-conference", async (c) => {
  const params = await readTwilioParams(c);
  if (!validateTwilioSignature(c, params)) return forbidden(c);

  const response = new VoiceResponse();
  const dial = response.dial({ answerOnBridge: true });
  dial.conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      maxParticipants: 2,
    },
    params.room ?? `room_${params.CallSid ?? "unknown"}`,
  );
  return twimlResponse(c, response.toString());
});

export { ACTIVE_CALL_STATUSES };
export default twilioApi;
