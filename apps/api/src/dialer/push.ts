/**
 * Web Push — so an incoming call reaches an agent whose tab is closed.
 *
 * Ported from apps/web/lib/dialer/push.ts. Without this the dialer only rings
 * while the CRM tab is open and focused, which is why calls were being missed:
 * nobody keeps a tab open all day, and Twilio gives up long before someone
 * happens to look.
 *
 * VAPID is initialised lazily and fails SOFT. Push is an enhancement — a
 * missing key must never turn an inbound call into a 500 on the voice webhook,
 * because that drops the call entirely. Everything here returns rather than
 * throws, and says so in the log.
 */
import { eq, sql } from "drizzle-orm";
import webpush from "web-push";
import crmDb from "../database/crm";
import { dialerPushSubscriptions } from "../database/crm-schema";
import { lookupCallerByPhone } from "../twilio/calls";
import { rowsOf } from "../database/rows";

let vapidConfigured: boolean | null = null;

function ensureVapid(): boolean {
  if (vapidConfigured !== null) return vapidConfigured;

  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!subject || !publicKey || !privateKey) {
    console.warn("[push] VAPID keys not configured — web push disabled.");
    vapidConfigured = false;
    return false;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
  } catch (error) {
    console.warn("[push] VAPID configuration is invalid:", error);
    vapidConfigured = false;
  }
  return vapidConfigured;
}

export function isPushConfigured(): boolean {
  return ensureVapid();
}

/**
 * Fan a payload out to every registered browser.
 *
 * 404 and 410 mean the browser threw the subscription away (uninstalled the
 * PWA, cleared site data). Those rows are deleted rather than retried — a dead
 * endpoint retried forever is how a push queue silently becomes all failures.
 */
export async function sendPushToAllSubscriptions(payload: unknown) {
  if (!ensureVapid()) return { sent: 0, failed: 0, cleaned: 0 };

  const subscriptions = await crmDb.select().from(dialerPushSubscriptions);
  const body = JSON.stringify(payload);

  let sent = 0;
  let failed = 0;
  let cleaned = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dhKey,
            auth: subscription.authKey,
          },
        },
        body,
      );
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      /*
       * 403 joins 404/410 as permanently dead.
       *
       * A 403 means the push service rejected our VAPID signature — the
       * subscription was minted under a different key and no retry will ever
       * fix it. Production had ten of these from the legacy app, failing on
       * every send and never being cleaned up, so the audience looked healthy
       * while nothing could be delivered to any of them.
       */
      if (status === 404 || status === 410 || status === 403) {
        await crmDb
          .delete(dialerPushSubscriptions)
          .where(eq(dialerPushSubscriptions.endpoint, subscription.endpoint));
        cleaned += 1;
      } else {
        console.error("[push] send failed:", subscription.endpoint, error);
        failed += 1;
      }
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
  const caller = await lookupCallerByPhone(from).catch(() => null);
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
 * Push to ONE person's browsers.
 *
 * The dialer deliberately pushes everyone — any agent can take a call. The
 * work-clock prompt must not: asking the whole company "are you still working?"
 * because one person's laptop slept is how a notification channel gets muted.
 */
export async function sendPushToUser(crmUserId: string, payload: unknown) {
  if (!ensureVapid()) return { sent: 0, failed: 0, cleaned: 0 };

  const subscriptions = await crmDb
    .select()
    .from(dialerPushSubscriptions)
    .where(eq(dialerPushSubscriptions.userId, crmUserId));

  if (subscriptions.length === 0) return { sent: 0, failed: 0, cleaned: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  let cleaned = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dhKey,
            auth: subscription.authKey,
          },
        },
        body,
      );
      sent += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      // Same rule as the broadcast path: 403 is a permanent key mismatch.
      if (status === 404 || status === 410 || status === 403) {
        await crmDb
          .delete(dialerPushSubscriptions)
          .where(eq(dialerPushSubscriptions.endpoint, subscription.endpoint));
        cleaned += 1;
      } else {
        console.error("[push] user send failed:", subscription.endpoint, error);
        failed += 1;
      }
    }
  }

  return { sent, failed, cleaned };
}

/**
 * A generic alert — used by the 30-minute work-clock prompt, which has the same
 * problem as the dialer: it only fires while a tab is open.
 */
export async function sendGenericPush(params: {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}) {
  return sendPushToAllSubscriptions({
    type: "generic",
    title: params.title,
    body: params.body,
    url: params.url ?? "/",
    tag: params.tag ?? "nuraview",
    timestamp: new Date().toISOString(),
  });
}

/** Register (or refresh) a browser's subscription. */
export async function savePushSubscription(params: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userId?: string | null;
  userAgent?: string | null;
}) {
  const now = new Date();

  // The endpoint is the browser's identity and is unique. Re-subscribing after
  // a permission reset yields the same endpoint, so this must update rather
  // than accumulate duplicates that each get their own copy of every alert.
  const existing = await crmDb
    .select({ id: dialerPushSubscriptions.id })
    .from(dialerPushSubscriptions)
    .where(eq(dialerPushSubscriptions.endpoint, params.endpoint))
    .limit(1);

  if (existing.length > 0) {
    await crmDb
      .update(dialerPushSubscriptions)
      .set({
        p256dhKey: params.p256dh,
        authKey: params.auth,
        userId: params.userId ?? null,
        userAgent: params.userAgent ?? null,
        updatedAt: now,
      })
      .where(eq(dialerPushSubscriptions.endpoint, params.endpoint));
    return { created: false };
  }

  await crmDb.insert(dialerPushSubscriptions).values({
    endpoint: params.endpoint,
    p256dhKey: params.p256dh,
    authKey: params.auth,
    userId: params.userId ?? null,
    userAgent: params.userAgent ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return { created: true };
}

export async function deletePushSubscription(endpoint: string) {
  await crmDb
    .delete(dialerPushSubscriptions)
    .where(eq(dialerPushSubscriptions.endpoint, endpoint));
}

/** How many browsers would be reached right now — for the admin panel. */
export async function countPushSubscriptions(): Promise<number> {
  const rows = rowsOf(await crmDb.execute(
    sql`SELECT count(*)::int AS n FROM dialer_push_subscriptions`,
  ));
  return rows?.[0]?.n ?? 0;
}

