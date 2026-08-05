/**
 * Dialer — Twilio Voice token, call log, SMS/WhatsApp history, contacts,
 * templates and agent presence.
 *
 * Ported from apps/web/app/api/dialer/** and lib/dialer/db.ts.
 *
 * The Voice SDK runs in the BROWSER; this side only mints the access token and
 * keeps the records. That is why the token endpoint matters more than it looks:
 * the identity is derived from the session and never accepted from the client,
 * otherwise any signed-in user could mint a token impersonating another agent
 * and receive their calls.
 */
import { and, desc, eq, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import twilio from "twilio";
import crmDb from "../database/crm";
import {
  crmLeads,
  dialerCalls,
  dialerContacts,
  dialerMessageTemplates,
  dialerSmsMessages,
} from "../database/crm-schema";
import { resolveCrmActorId } from "../lead/crm-actor";
import { requireCrmAccess } from "../utils/require-crm-access";
import { identityForUser } from "./identity";
import { lookupCallerByPhone } from "../twilio/calls";
import {
  countPushSubscriptions,
  deletePushSubscription,
  isPushConfigured,
  savePushSubscription,
  sendGenericPush,
} from "./push";

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

/** Statuses that mean a call is still up — used by the duplicate-dial guard. */
export const ACTIVE_CALL_STATUSES = [
  "queued",
  "initiated",
  "ringing",
  "in-progress",
];

/**
 * Phone matching throughout this file compares the LAST 10 DIGITS.
 *
 * The CRM stores numbers in whatever shape the scraper or a human typed
 * ("+1 (548) 251-8967", "5482518967"), while Twilio always sends E.164.
 * Normalising both sides to the trailing 10 digits is what makes an inbound
 * call actually resolve to a lead instead of showing as unknown.
 */

const dialer = new Hono<{ Variables: { userId: string; userEmail: string } }>()
  .use("*", requireCrmAccess)
  /**
   * Twilio Voice access token for the browser SDK.
   *
   * Identity ALWAYS derives from the session. Accepting it from the request
   * would let any signed-in user register as another agent's client and be
   * delivered their inbound calls.
   */
  .post("/token", async (c) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKey = process.env.TWILIO_API_KEY;
    const apiSecret = process.env.TWILIO_API_SECRET;
    const twimlAppSid = process.env.TWIML_APP_SID;

    if (!accountSid || !apiKey || !apiSecret || !twimlAppSid) {
      throw new HTTPException(503, { message: "Twilio is not configured" });
    }

    const identity = identityForUser(c.get("userId"));

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

    return c.json({ identity, token: token.toJwt() });
  })
  /** Call log, optionally scoped to one lead. */
  .get("/calls", async (c) => {
    const leadId = c.req.query("leadId");
    const limit = Math.min(200, Number(c.req.query("limit") ?? "50") || 50);

    const rows = await crmDb
      .select({
        id: dialerCalls.id,
        leadId: dialerCalls.leadId,
        phoneNumber: dialerCalls.phoneNumber,
        callSid: dialerCalls.callSid,
        status: dialerCalls.status,
        direction: dialerCalls.direction,
        duration: dialerCalls.duration,
        agentIdentity: dialerCalls.agentIdentity,
        createdAt: dialerCalls.createdAt,
      })
      .from(dialerCalls)
      .where(leadId ? eq(dialerCalls.leadId, leadId) : sql`true`)
      .orderBy(desc(dialerCalls.createdAt))
      .limit(limit);

    return c.json({ items: rows });
  })
  /*
   * The REAL call log — read from Twilio's REST API, not our dialer_calls table.
   *
   * Ported from apps/web/app/api/dialer/twilio-calls/route.ts. This is not a
   * nicety: dialer_calls contains ZERO outbound rows and always has (11 rows,
   * every one inbound), because outbound calls are placed by the browser SDK
   * and only ever land in our table if a status webhook happens to reach us.
   * Twilio is the source of truth for call history; our table is a cache of
   * whatever webhooks arrived.
   *
   * Serving the Calls tab from dialer_calls is why the log showed inbound-only
   * and no missed outbound attempts at all.
   */
  .get("/twilio-calls", async (c) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const ourNumber = process.env.TWILIO_PHONE_NUMBER;
    if (!accountSid || !authToken || !ourNumber) {
      throw new HTTPException(503, { message: "Twilio is not configured" });
    }

    let raw: Awaited<ReturnType<ReturnType<typeof twilio>["calls"]["list"]>>;
    try {
      raw = await twilio(accountSid, authToken).calls.list({ limit: 200 });
    } catch (error) {
      console.error("[dialer] twilio call list failed:", error);
      throw new HTTPException(502, { message: "Twilio fetch failed" });
    }

    type LogCall = {
      id: string;
      phoneNumber: string;
      direction: "inbound" | "outbound";
      status: string;
      duration: number | null;
      createdAt: string;
      leadName: string | null;
    };

    const calls: LogCall[] = [];

    // Every real call appears as two legs — the customer leg and the agent's
    // client leg. Keep only the leg facing the external number, otherwise the
    // log doubles up and the direction is meaningless.
    for (const call of raw) {
      const from = call.from ?? "";
      const to = call.to ?? "";
      let phoneNumber: string | null = null;
      let direction: "inbound" | "outbound" | null = null;

      if (call.direction === "inbound" && to === ourNumber && from.startsWith("+")) {
        phoneNumber = from;
        direction = "inbound";
      } else if (
        call.direction.startsWith("outbound") &&
        from === ourNumber &&
        to.startsWith("+")
      ) {
        phoneNumber = to;
        direction = "outbound";
      } else {
        continue;
      }

      const when = call.startTime ?? call.dateCreated ?? new Date();
      calls.push({
        id: call.sid,
        phoneNumber,
        direction,
        status: call.status,
        duration: call.duration ? parseInt(call.duration, 10) || null : null,
        createdAt: new Date(when).toISOString(),
        leadName: null,
      });
    }

    // One name lookup per distinct number, not per row.
    const distinct = Array.from(new Set(calls.map((call) => call.phoneNumber)));
    const nameByPhone = new Map<string, string | null>();
    await Promise.all(
      distinct.map(async (phone) => {
        try {
          const match = await lookupCallerByPhone(phone);
          nameByPhone.set(phone, match?.displayName ?? null);
        } catch {
          nameByPhone.set(phone, null);
        }
      }),
    );
    for (const call of calls) {
      call.leadName = nameByPhone.get(call.phoneNumber) ?? null;
    }

    return c.json({ calls });
  })
  /** SMS + WhatsApp thread for a lead (or the newest across all leads). */
  .get("/messages", async (c) => {
    const leadId = c.req.query("leadId");
    const limit = Math.min(200, Number(c.req.query("limit") ?? "100") || 100);

    const rows = await crmDb
      .select({
        id: dialerSmsMessages.id,
        leadId: dialerSmsMessages.leadId,
        phoneNumber: dialerSmsMessages.phoneNumber,
        messageSid: dialerSmsMessages.messageSid,
        messageBody: dialerSmsMessages.messageBody,
        messageStatus: dialerSmsMessages.messageStatus,
        direction: dialerSmsMessages.direction,
        messageType: dialerSmsMessages.messageType,
        createdAt: dialerSmsMessages.createdAt,
      })
      .from(dialerSmsMessages)
      .where(leadId ? eq(dialerSmsMessages.leadId, leadId) : sql`true`)
      .orderBy(desc(dialerSmsMessages.createdAt))
      .limit(limit);

    // Oldest-first reads like a conversation; the query is newest-first only so
    // the LIMIT takes the most recent slice.
    return c.json({ items: rows.reverse() });
  })
  .get("/contacts", async (c) => {
    const rows = await crmDb
      .select()
      .from(dialerContacts)
      .orderBy(dialerContacts.name);
    return c.json({ items: rows });
  })
  /*
   * Contact book writes. The read side shipped; these did not, so the 91
   * contacts in production were visible-but-frozen — no add, no edit, no
   * delete. Ported from apps/web/app/api/dialer/contacts/route.ts.
   */
  .post("/contacts", async (c) => {
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({}) as Record<string, unknown>);
    const name = String(body.name ?? "").trim();
    const phone = String(body.phone ?? "").trim();
    if (!name || !phone) {
      throw new HTTPException(400, { message: "Name and phone are required" });
    }

    const now = new Date();
    const [row] = await crmDb
      .insert(dialerContacts)
      .values({
        name,
        phone,
        email: body.email ? String(body.email).trim() : null,
        requirementTag: body.requirementTag
          ? String(body.requirementTag).trim()
          : null,
        // Default ON: a contact you just typed a number for is one you intend
        // to reach. Legacy defaulted the same way.
        smsEnabled: body.smsEnabled !== false,
        whatsappEnabled: body.whatsappEnabled !== false,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: dialerContacts.id });

    return c.json({ ok: true, id: row?.id });
  })
  .put("/contacts/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) {
      throw new HTTPException(400, { message: "Bad contact id" });
    }
    const body = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({}) as Record<string, unknown>);

    // Only the fields actually supplied are written — a PUT from the edit form
    // must not blank out a column the form did not render.
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) update.name = String(body.name).trim();
    if (body.phone !== undefined) update.phone = String(body.phone).trim();
    if (body.email !== undefined) {
      update.email = body.email ? String(body.email).trim() : null;
    }
    if (body.requirementTag !== undefined) {
      update.requirementTag = body.requirementTag
        ? String(body.requirementTag).trim()
        : null;
    }
    if (body.smsEnabled !== undefined) update.smsEnabled = !!body.smsEnabled;
    if (body.whatsappEnabled !== undefined) {
      update.whatsappEnabled = !!body.whatsappEnabled;
    }

    await crmDb
      .update(dialerContacts)
      .set(update)
      .where(eq(dialerContacts.id, id));
    return c.json({ ok: true });
  })
  .delete("/contacts/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) {
      throw new HTTPException(400, { message: "Bad contact id" });
    }
    await crmDb.delete(dialerContacts).where(eq(dialerContacts.id, id));
    return c.json({ ok: true });
  })
  /*
   * Web Push registration. The browser hands us an endpoint plus two keys; we
   * store them and can then reach it with the tab closed.
   *
   * Upsert by endpoint — see savePushSubscription. Re-subscribing yields the
   * same endpoint, so inserting blindly would give one browser several rows and
   * every alert several copies.
   */
  .post("/push/subscribe", async (c) => {
    const body = await c.req
      .json<{
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      }>()
      .catch(() => ({}) as { endpoint?: string; keys?: Record<string, string> });

    const endpoint = body.endpoint;
    const p256dh = body.keys?.p256dh;
    const auth = body.keys?.auth;
    if (!endpoint || !p256dh || !auth) {
      throw new HTTPException(400, {
        message: "endpoint and keys.p256dh/auth are required",
      });
    }

    const result = await savePushSubscription({
      endpoint,
      p256dh,
      auth,
      userId: await resolveCrmActorId(c.get("userEmail")),
      userAgent: c.req.header("user-agent") ?? null,
    });

    return c.json({ ok: true, ...result });
  })
  .delete("/push/subscribe", async (c) => {
    const endpoint = c.req.query("endpoint");
    if (!endpoint) {
      throw new HTTPException(400, { message: "endpoint is required" });
    }
    await deletePushSubscription(endpoint);
    return c.json({ ok: true });
  })
  /** Whether push can work at all, and how many browsers are registered. */
  .get("/push/status", async (c) =>
    c.json({
      configured: isPushConfigured(),
      subscriptions: await countPushSubscriptions(),
    }),
  )
  /** Fire a test push to every registered browser — proves the loop end to end. */
  .post("/push/test", async (c) => {
    if (!isPushConfigured()) {
      throw new HTTPException(503, {
        message: "VAPID keys are not configured on the server",
      });
    }
    const result = await sendGenericPush({
      title: "NuraView test",
      body: "Push notifications are working.",
      url: "/dialer",
      tag: "nuraview-test",
    });
    return c.json(result);
  })
  .get("/templates", async (c) => {
    const rows = await crmDb
      .select()
      .from(dialerMessageTemplates)
      .where(eq(dialerMessageTemplates.isActive, true))
      .orderBy(dialerMessageTemplates.name);
    return c.json({ items: rows });
  })
  /**
   * Who is this number? Checks the dialer's own contact book first, then falls
   * back to the lead pipeline. Used to label an inbound call.
   */
  .get("/lookup", async (c) => {
    const phone = c.req.query("phone")?.trim();
    if (!phone) throw new HTTPException(400, { message: "phone is required" });

    const digits = phone.replace(/\D/g, "").slice(-10);
    if (digits.length < 7) return c.json({ contact: null, lead: null });

    const [contact] = await crmDb
      .select()
      .from(dialerContacts)
      .where(sql`right(regexp_replace(${dialerContacts.phone}, '[^0-9]', '', 'g'), 10) = ${digits}`)
      .limit(1);

    const [lead] = await crmDb
      .select({
        id: crmLeads.id,
        company: crmLeads.company,
        firstName: crmLeads.firstName,
        lastName: crmLeads.lastName,
        jobTitle: crmLeads.jobTitle,
        phone: crmLeads.phone,
      })
      .from(crmLeads)
      .where(
        or(
          sql`right(regexp_replace(coalesce(${crmLeads.phone}, ''), '[^0-9]', '', 'g'), 10) = ${digits}`,
          sql`right(regexp_replace(coalesce(${crmLeads.phoneSecondary}, ''), '[^0-9]', '', 'g'), 10) = ${digits}`,
        ),
      )
      .limit(1);

    return c.json({ contact: contact ?? null, lead: lead ?? null });
  })
  /** Search leads by name/company/phone for the dial pad's picker. */
  .get("/leads-search", async (c) => {
    const q = c.req.query("q")?.trim();
    if (!q || q.length < 2) return c.json({ items: [] });

    const like = `%${q}%`;
    const rows = await crmDb
      .select({
        id: crmLeads.id,
        company: crmLeads.company,
        firstName: crmLeads.firstName,
        lastName: crmLeads.lastName,
        jobTitle: crmLeads.jobTitle,
        phone: crmLeads.phone,
      })
      .from(crmLeads)
      .where(
        and(
          sql`${crmLeads.deletedAt} is null`,
          sql`coalesce(${crmLeads.phone}, '') <> ''`,
          or(
            sql`${crmLeads.company} ilike ${like}`,
            sql`${crmLeads.firstName} ilike ${like}`,
            sql`${crmLeads.jobTitle} ilike ${like}`,
            sql`${crmLeads.phone} ilike ${like}`,
          ),
        ),
      )
      .limit(20);

    return c.json({ items: rows });
  })
  /**
   * Send an SMS or WhatsApp message through Twilio and record it.
   *
   * Recorded AFTER the send succeeds and keyed on the real message SID, so the
   * log never claims a message went out that Twilio rejected.
   */
  .post("/messages/send", async (c) => {
    const body = await c.req
      .json<{
        to?: string;
        body?: string;
        leadId?: string | null;
        type?: string;
      }>()
      .catch(() => ({}) as Record<string, never>);

    if (!body.to || !body.body) {
      throw new HTTPException(400, { message: "`to` and `body` are required" });
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !from) {
      throw new HTTPException(503, { message: "Twilio is not configured" });
    }

    const isWhatsapp = body.type === "whatsapp";
    const client = twilio(accountSid, authToken);

    const message = await client.messages.create({
      to: isWhatsapp ? `whatsapp:${body.to}` : body.to,
      from: isWhatsapp ? `whatsapp:${from}` : from,
      body: body.body,
    });

    await crmDb.execute(sql`
      INSERT INTO dialer_sms_messages
        (lead_id, phone_number, message_sid, message_body, message_status, direction, message_type)
      VALUES (
        ${body.leadId ?? null}::uuid,
        ${body.to},
        ${message.sid},
        ${body.body},
        ${message.status ?? "queued"},
        'outbound',
        ${isWhatsapp ? "whatsapp" : "sms"}
      )
    `);

    return c.json({ ok: true, sid: message.sid, status: message.status });
  })
  /**
   * Agent presence. The browser heartbeats while the dialer is open; the voice
   * webhook reads this to decide whether anyone is around to take a call.
   */
  .post("/presence/heartbeat", async (c) => {
    const identity = identityForUser(c.get("userId"));
    const actorId = await resolveCrmActorId(c.get("userEmail"));

    await crmDb.execute(sql`
      INSERT INTO dialer_client_sessions (identity, user_id, last_heartbeat, is_active)
      VALUES (${identity}, ${actorId}::uuid, now(), true)
      ON CONFLICT (identity) DO UPDATE SET
        last_heartbeat = now(),
        is_active      = true,
        user_id        = COALESCE(EXCLUDED.user_id, dialer_client_sessions.user_id)
    `);

    return c.json({ ok: true, identity });
  })
  .post("/presence/unregister", async (c) => {
    const identity = identityForUser(c.get("userId"));
    await crmDb.execute(sql`
      UPDATE dialer_client_sessions SET is_active = false WHERE identity = ${identity}
    `);
    return c.json({ ok: true });
  })
  /** Which agents are live right now — a heartbeat inside the last 60s. */
  .get("/presence", async (c) => {
    const rows = await crmDb.execute(sql`
      SELECT identity, user_id, last_heartbeat
        FROM dialer_client_sessions
       WHERE is_active = true
         AND last_heartbeat > now() - interval '60 seconds'
    `);
    const items = Array.isArray(rows)
      ? rows
      : ((rows as { rows?: unknown[] })?.rows ?? []);
    return c.json({ items });
  });

export default dialer;
