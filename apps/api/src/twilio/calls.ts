/**
 * Call-record helpers for the Twilio webhooks.
 *
 * Ported from apps/web/lib/dialer/db.ts, trimmed to what the webhooks need.
 * Every write is keyed on Twilio's CallSid, which is the only identifier both
 * sides agree on.
 */
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import crmDb from "../database/crm";
import { crmLeads, dialerCalls, dialerContacts } from "../database/crm-schema";

/**
 * A call Twilio still considers live.
 *
 * NO "queued" here even though Twilio reports it: dialer_calls.status is the
 * dialer_call_status ENUM and it has no such label. A text parameter compared
 * against an enum column is cast to the enum, so putting "queued" in this list
 * made the recent-calls SELECT itself throw ("invalid input value for enum").
 * Twilio's queued state is stored as 'initiated' — see normalizeCallStatus.
 */
export const ACTIVE_CALL_STATUSES = ["initiated", "ringing", "in-progress"];

/** Labels the dialer_call_status enum actually has. */
const CALL_STATUS_LABELS = new Set([
  "initiated",
  "ringing",
  "in-progress",
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
]);

/**
 * Twilio's status vocabulary is wider than the enum. queued -> initiated (it
 * is the same pre-ring moment for our purposes), and anything unrecognised
 * degrades to initiated rather than blowing up the insert — a wrong-but-live
 * status gets corrected by the next callback, a thrown insert never does.
 */
function normalizeCallStatus(status: string): string {
  if (status === "queued") return "initiated";
  return CALL_STATUS_LABELS.has(status) ? status : "initiated";
}

/**
 * dialer_call_direction: inbound | outbound-api | outbound-dial. Twilio
 * sometimes sends bare "outbound", and the status callback often omits
 * Direction entirely. The column is NOT NULL, so absent/unknown is stored as
 * 'inbound' PROVISIONALLY — the upsert below only ever corrects towards
 * outbound, so the first callback that actually knows the direction fixes it.
 */
function normalizeCallDirection(direction: string): string {
  if (direction === "outbound") return "outbound-api";
  if (["inbound", "outbound-api", "outbound-dial"].includes(direction)) {
    return direction;
  }
  return "inbound";
}

/**
 * Agents whose browser heartbeat is younger than `seconds`.
 *
 * The voice webhook rings these. If it returns nothing the caller is parked in
 * a conference and push-notified instead, so a stale row here is the difference
 * between a ringing phone and a caller listening to hold music for 45 seconds.
 */
export async function getActiveClients(seconds: number) {
  const result = await crmDb.execute<{ identity: string }>(sql`
    SELECT identity FROM dialer_client_sessions
     WHERE is_active = true
       AND last_heartbeat > now() - (${seconds} * interval '1 second')
  `);

  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: { identity: string }[] })?.rows ?? []);

  return rows as { identity: string }[];
}

/**
 * Who is calling? Dialer contact book first, then the lead pipeline.
 *
 * Matched on the last 10 digits — the CRM stores whatever a human or the
 * scraper typed, Twilio always sends E.164.
 */
export async function lookupCallerByPhone(phone: string | undefined) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (digits.length < 7) return null;

  const [contact] = await crmDb
    .select({
      name: dialerContacts.name,
      requirementTag: dialerContacts.requirementTag,
    })
    .from(dialerContacts)
    .where(
      sql`right(regexp_replace(${dialerContacts.phone}, '[^0-9]', '', 'g'), 10) = ${digits}`,
    )
    .limit(1);

  if (contact) {
    return {
      displayName: contact.name,
      secondary: contact.requirementTag ?? null,
    };
  }

  const [lead] = await crmDb
    .select({
      company: crmLeads.company,
      firstName: crmLeads.firstName,
      lastName: crmLeads.lastName,
      jobTitle: crmLeads.jobTitle,
    })
    .from(crmLeads)
    .where(
      sql`right(regexp_replace(coalesce(${crmLeads.phone}, ''), '[^0-9]', '', 'g'), 10) = ${digits}
       OR right(regexp_replace(coalesce(${crmLeads.phoneSecondary}, ''), '[^0-9]', '', 'g'), 10) = ${digits}`,
    )
    .limit(1);

  if (!lead) return null;

  return {
    displayName:
      lead.company ||
      [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
      "Lead",
    secondary: lead.jobTitle ?? null,
  };
}

/**
 * Calls this agent already has up, newest first.
 *
 * Also reaps rows stuck active for over 2h — without that a call whose final
 * webhook never arrived blocks the agent from dialling again, forever.
 */
export async function getRecentActiveCalls(agentIdentity: string | null) {
  if (!agentIdentity) return [];

  await crmDb.execute(sql`
    UPDATE dialer_calls
       SET status = 'failed', updated_at = now()
     WHERE agent_identity = ${agentIdentity}
       AND status IN ('initiated','ringing','in-progress')
       AND created_at < now() - interval '2 hours'
  `);

  return crmDb
    .select({
      id: dialerCalls.id,
      phoneNumber: dialerCalls.phoneNumber,
      createdAt: dialerCalls.createdAt,
    })
    .from(dialerCalls)
    .where(
      and(
        eq(dialerCalls.agentIdentity, agentIdentity),
        inArray(dialerCalls.status, ACTIVE_CALL_STATUSES),
        gt(dialerCalls.createdAt, sql`now() - interval '2 hours'`),
      ),
    )
    .orderBy(desc(dialerCalls.createdAt));
}

/** Insert a call row if this SID is new. Safe to call repeatedly. */
export async function ensureCall(params: {
  callSid: string;
  phoneNumber: string;
  status: string;
  direction: string;
  agentIdentity?: string | null;
}) {
  // Both columns are NOT NULL enums — raw Twilio vocabulary ("queued",
  // "unknown") is normalised here or the INSERT itself throws and the caller
  // surfaces "there was an error processing your call".
  const status = normalizeCallStatus(params.status);
  const direction = normalizeCallDirection(params.direction);

  await crmDb.execute(sql`
    INSERT INTO dialer_calls
      (phone_number, call_sid, status, direction, agent_identity)
    VALUES (
      ${params.phoneNumber},
      ${params.callSid},
      ${status},
      ${direction},
      ${params.agentIdentity ?? null}
    )
    ON CONFLICT (call_sid) DO UPDATE SET
      -- FIRST-WRITER-WINS was the bug behind "a call I made shows as inbound".
      -- Twilio's status callback usually beats the voice webhook, and it does
      -- not always carry Direction, so the row got stamped inbound and DO
      -- NOTHING froze that forever. A later, better-informed write now
      -- corrects it — but only ever from unknown/inbound TOWARDS outbound,
      -- never the reverse, so a genuine inbound call cannot be relabelled.
      -- ::text on both sides: direction is the dialer_call_direction ENUM, and
      -- Postgres has no LIKE for enums — "operator does not exist:
      -- dialer_call_direction ~~ unknown" killed this whole upsert, which is
      -- why every call died with "there was an error processing your call".
      direction = CASE
        WHEN EXCLUDED.direction::text LIKE 'outbound%' THEN EXCLUDED.direction
        ELSE dialer_calls.direction
      END,
      phone_number = COALESCE(NULLIF(EXCLUDED.phone_number, 'unknown'),
                              dialer_calls.phone_number),
      agent_identity = COALESCE(EXCLUDED.agent_identity,
                                dialer_calls.agent_identity)
  `);
}

export async function updateCallStatus(
  callSid: string,
  rawStatus: string,
  duration: number | null,
) {
  // Same enum constraint as the insert — Twilio's "queued" must not reach it.
  const status = normalizeCallStatus(rawStatus);
  await crmDb.execute(sql`
    UPDATE dialer_calls
       SET status     = ${status},
           duration   = COALESCE(${duration}, duration),
           updated_at = now()
     WHERE call_sid = ${callSid}
  `);
}

/**
 * Record an inbound SMS / WhatsApp message.
 *
 * Matched to a lead on the last 10 digits so the message shows up on that
 * lead's thread; unmatched messages are still stored, just unattached, because
 * losing a prospect's reply is worse than an orphan row.
 */
export async function insertInboundMessage(params: {
  messageSid: string;
  from: string;
  body: string;
  status: string;
  type: "sms" | "whatsapp";
}) {
  if (!params.messageSid) return;
  const digits = params.from.replace(/\D/g, "").slice(-10);

  await crmDb.execute(sql`
    INSERT INTO dialer_sms_messages
      (lead_id, phone_number, message_sid, message_body, message_status, direction, message_type)
    VALUES (
      (SELECT id FROM "crm_Leads"
        WHERE right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${digits}
           OR right(regexp_replace(coalesce(phone_secondary, ''), '[^0-9]', '', 'g'), 10) = ${digits}
        LIMIT 1),
      ${params.from},
      ${params.messageSid},
      ${params.body},
      ${params.status},
      'inbound',
      ${params.type}
    )
    ON CONFLICT (message_sid) DO NOTHING
  `);
}
