// Web Push for offline incoming-call alerts — port of services/push.js.
// VAPID is lazy-initialized so builds without env vars don't warn/throw.

import webpush from "web-push";

import {
  deletePushSubscription,
  getActiveClients,
  getPushSubscriptions,
  lookupCallerByPhone,
} from "./db";
import { isCallStillActive, sleep } from "./twilio";

let vapidConfigured: boolean | null = null;

function ensureVapid(): boolean {
  if (vapidConfigured !== null) return vapidConfigured;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (subject && publicKey && privateKey) {
    try {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      vapidConfigured = true;
    } catch (error) {
      console.warn("Web Push VAPID configuration is invalid:", error);
      vapidConfigured = false;
    }
  } else {
    console.warn("Web Push VAPID keys not configured — push disabled.");
    vapidConfigured = false;
  }
  return vapidConfigured;
}

export async function sendPushToAllSubscriptions(payload: unknown) {
  if (!ensureVapid()) throw new Error("VAPID is not configured");

  const subscriptions = await getPushSubscriptions();
  let sent = 0;
  let failed = 0;
  let cleaned = 0;

  for (const subscription of subscriptions) {
    const target = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dhKey, auth: subscription.authKey },
    };

    try {
      await webpush.sendNotification(target, JSON.stringify(payload));
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        await deletePushSubscription(subscription.endpoint);
        cleaned += 1;
      } else {
        console.error("Push send failed:", subscription.endpoint, error);
      }
      failed += 1;
    }
  }

  return { sent, failed, cleaned };
}

type IncomingCallPushParams = {
  callSid: string;
  conference: string;
  from: string;
  attempt?: number;
  maxAttempts?: number;
};

export async function sendIncomingCallPush({
  callSid,
  conference,
  from,
  attempt = 1,
  maxAttempts = 5,
}: IncomingCallPushParams) {
  const caller = await lookupCallerByPhone(from);
  const contactName = caller?.displayName || "";
  const contactRequirement = caller?.secondary || "";

  const attemptSuffix = attempt > 1 ? ` (alert ${attempt}/${maxAttempts})` : "";
  const title = contactName
    ? `📞 ${contactName}${attemptSuffix}`
    : `📞 Incoming Call${attemptSuffix}`;
  const bodyParts: string[] = [];
  if (contactRequirement) bodyParts.push(contactRequirement);
  if (from) bodyParts.push(from);
  if (!bodyParts.length) bodyParts.push("Unknown caller");

  return sendPushToAllSubscriptions({
    type: "incoming_call",
    title,
    body: bodyParts.join(" • "),
    callSid,
    conference,
    from,
    contactName,
    contactRequirement,
    attempt,
    maxAttempts,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Re-alerts every `intervalMs` until the caller hangs up or an agent comes
 * online. Runs ~16s — on Vercel this MUST be passed to waitUntil() by the
 * caller, or it dies when the TwiML response is returned.
 */
export async function sendIncomingCallPushRetries({
  callSid,
  conference,
  from,
  maxAttempts = 5,
  intervalMs = 4000,
}: IncomingCallPushParams & { intervalMs?: number }) {
  for (let attempt = 2; attempt <= maxAttempts; attempt += 1) {
    await sleep(intervalMs);

    const [callActive, activeClients] = await Promise.all([
      isCallStillActive(callSid),
      getActiveClients(30),
    ]);

    if (!callActive || activeClients.length > 0) return;

    try {
      await sendIncomingCallPush({ callSid, conference, from, attempt, maxAttempts });
    } catch (error) {
      console.error(`Incoming-call push retry ${attempt} failed:`, error);
    }
  }
}
