// Dialer data layer — port of the standalone app's services/db.js, rewritten
// against the CRM database. The standalone `contacts` table is gone: leads
// (crm_Leads) are the contact source, looked up by digit-normalized phone
// suffix. Unknown callers stay leadId=null — we deliberately do NOT auto-create
// leads (would pollute the Upwork review pipeline).

import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import {
  crmLeads,
  dialerCalls,
  dialerClientSessions,
  dialerContacts,
  dialerMessageTemplates,
  dialerPushSubscriptions,
  dialerSmsMessages,
} from "@/lib/db/schema";

export type LeadMatch = {
  id: string;
  displayName: string;
  company: string | null;
  phone: string | null;
};

export type CallDirection = "inbound" | "outbound-api" | "outbound-dial";
export type CallStatus =
  | "initiated"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "no-answer"
  | "failed"
  | "canceled";
export type MessageType = "sms" | "whatsapp";

export const ACTIVE_CALL_STATUSES: CallStatus[] = [
  "initiated",
  "ringing",
  "in-progress",
];

function leadDisplayName(lead: {
  firstName: string | null;
  lastName: string;
  company: string | null;
}): string {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  return name || lead.company || "";
}

// ── Dialer contacts (dedicated phone-book, separate from leads) ──
export type DialerContact = typeof dialerContacts.$inferSelect;

export async function getContacts(): Promise<DialerContact[]> {
  return db
    .select()
    .from(dialerContacts)
    .orderBy(desc(dialerContacts.createdAt));
}

export async function createContact(params: {
  name: string;
  phone: string;
  email?: string | null;
  requirementTag?: string | null;
  smsEnabled?: boolean;
  whatsappEnabled?: boolean;
}) {
  const [contact] = await db
    .insert(dialerContacts)
    .values(params)
    .onConflictDoUpdate({
      target: dialerContacts.phone,
      set: { ...params, updatedAt: new Date() },
    })
    .returning();
  return contact;
}

export async function updateContact(
  id: number,
  params: Partial<{
    name: string;
    phone: string;
    email: string | null;
    requirementTag: string | null;
    smsEnabled: boolean;
    whatsappEnabled: boolean;
  }>,
) {
  const [contact] = await db
    .update(dialerContacts)
    .set({ ...params, updatedAt: new Date() })
    .where(eq(dialerContacts.id, id))
    .returning();
  return contact ?? null;
}

export async function deleteContact(id: number) {
  await db.delete(dialerContacts).where(eq(dialerContacts.id, id));
}

export async function lookupContactByPhone(
  phone: string | null | undefined,
): Promise<DialerContact | null> {
  if (!phone) return null;
  const cleanPhone = phone.replace(/^(client:|whatsapp:)/, "");
  const digits = cleanPhone.replace(/\D/g, "");
  if (!digits) return null;
  const suffix = digits.length >= 10 ? digits.slice(-10) : digits;
  const [contact] = await db
    .select()
    .from(dialerContacts)
    .where(
      sql`regexp_replace(${dialerContacts.phone}, '\\D', '', 'g') LIKE ${"%" + suffix}`,
    )
    .limit(1);
  return contact ?? null;
}

// ── Lead lookup (Upwork pipeline; used as caller-ID fallback) ────
export async function lookupLeadByPhone(
  phone: string | null | undefined,
): Promise<LeadMatch | null> {
  if (!phone) return null;
  const cleanPhone = phone.replace(/^(client:|whatsapp:)/, "");
  const digits = cleanPhone.replace(/\D/g, "");
  if (!digits) return null;
  const suffix = digits.length >= 10 ? digits.slice(-10) : digits;

  const norm = (col: AnyPgColumn) =>
    sql`regexp_replace(coalesce(${col}, ''), '\\D', '', 'g')`;

  const [lead] = await db
    .select({
      id: crmLeads.id,
      firstName: crmLeads.firstName,
      lastName: crmLeads.lastName,
      company: crmLeads.company,
      phone: crmLeads.phone,
    })
    .from(crmLeads)
    .where(
      sql`(${norm(crmLeads.phone)} LIKE ${"%" + suffix} OR ${norm(crmLeads.phoneSecondary)} LIKE ${"%" + suffix})`,
    )
    .orderBy(desc(crmLeads.createdAt))
    .limit(1);

  if (!lead) return null;
  return {
    id: lead.id,
    displayName: leadDisplayName(lead),
    company: lead.company,
    phone: lead.phone,
  };
}

// ── Unified caller-ID lookup: dialer contacts FIRST, leads fallback ──
export type CallerMatch = {
  /** Name to show on caller-ID / incoming card. */
  displayName: string;
  /** Second line: contact requirement tag, or lead company. */
  secondary: string | null;
  /** Set only when the match came from crm_Leads (for activity linking). */
  leadId: string | null;
  contactId: number | null;
  phone: string | null;
};

export async function lookupCallerByPhone(
  phone: string | null | undefined,
): Promise<CallerMatch | null> {
  const contact = await lookupContactByPhone(phone);
  if (contact) {
    return {
      displayName: contact.name,
      secondary: contact.requirementTag,
      leadId: null,
      contactId: contact.id,
      phone: contact.phone,
    };
  }
  const lead = await lookupLeadByPhone(phone);
  if (lead) {
    return {
      displayName: lead.displayName,
      secondary: lead.company,
      leadId: lead.id,
      contactId: null,
      phone: lead.phone,
    };
  }
  return null;
}

// ── Calls ────────────────────────────────────────────────
export async function createCall(params: {
  leadId: string | null;
  phoneNumber: string;
  callSid: string;
  status: CallStatus;
  direction: CallDirection;
  agentIdentity?: string | null;
}) {
  const [call] = await db
    .insert(dialerCalls)
    .values(params)
    .onConflictDoNothing({ target: dialerCalls.callSid })
    .returning();
  return call ?? null;
}

export async function updateCallStatus(
  callSid: string,
  status: CallStatus,
  duration: number | null = null,
) {
  const set: Record<string, unknown> = { status, updatedAt: new Date() };
  if (duration !== null && !Number.isNaN(duration)) set.duration = duration;
  const [call] = await db
    .update(dialerCalls)
    .set(set)
    .where(eq(dialerCalls.callSid, callSid))
    .returning();
  return call ?? null;
}

export async function getCallBySid(callSid: string) {
  const [call] = await db
    .select()
    .from(dialerCalls)
    .where(eq(dialerCalls.callSid, callSid))
    .limit(1);
  return call ?? null;
}

export async function setCallActivityId(callId: number, activityId: string) {
  await db
    .update(dialerCalls)
    .set({ activityId, updatedAt: new Date() })
    .where(eq(dialerCalls.id, callId));
}

export async function getCallHistory(opts: { leadId?: string; limit?: number } = {}) {
  const rows = await db
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
      leadFirstName: crmLeads.firstName,
      leadLastName: crmLeads.lastName,
      leadCompany: crmLeads.company,
      contactName: dialerContacts.name,
    })
    .from(dialerCalls)
    .leftJoin(crmLeads, eq(dialerCalls.leadId, crmLeads.id))
    .leftJoin(dialerContacts, eq(dialerCalls.phoneNumber, dialerContacts.phone))
    .where(opts.leadId ? eq(dialerCalls.leadId, opts.leadId) : undefined)
    .orderBy(desc(dialerCalls.createdAt))
    .limit(opts.limit ?? 100);

  return rows.map((r) => ({
    ...r,
    leadName:
      r.contactName ||
      (r.leadLastName
        ? leadDisplayName({
            firstName: r.leadFirstName,
            lastName: r.leadLastName,
            company: r.leadCompany,
          })
        : null),
  }));
}

/**
 * Recent calls for the outbound duplicate/active-call guard, scoped to one
 * agent so simultaneous agents don't block each other. Auto-cleans calls
 * stuck in an active status for >2h (missed status callbacks).
 */
export async function getRecentActiveCalls(agentIdentity: string | null) {
  const STALE_MS = 2 * 60 * 60 * 1000;
  const rows = await db
    .select()
    .from(dialerCalls)
    .where(
      and(
        sql`${dialerCalls.status} IN ('initiated','ringing','in-progress')`,
        agentIdentity
          ? eq(dialerCalls.agentIdentity, agentIdentity)
          : undefined,
      ),
    )
    .orderBy(desc(dialerCalls.createdAt))
    .limit(20);

  const now = Date.now();
  const fresh: typeof rows = [];
  for (const call of rows) {
    const age = now - new Date(call.createdAt ?? 0).getTime();
    if (age >= STALE_MS) {
      await updateCallStatus(call.callSid, "completed", null);
    } else {
      fresh.push(call);
    }
  }
  return fresh;
}

// ── SMS / WhatsApp messages ──────────────────────────────
export async function createSmsMessage(params: {
  leadId: string | null;
  phoneNumber: string;
  messageSid: string;
  messageBody: string;
  messageStatus: string;
  direction: "inbound" | "outbound";
  messageType?: MessageType;
  callId?: number | null;
  templateId?: number | null;
}) {
  const [message] = await db
    .insert(dialerSmsMessages)
    .values({ messageType: "sms", ...params })
    .onConflictDoNothing({ target: dialerSmsMessages.messageSid })
    .returning();
  return message ?? null;
}

export async function getSmsHistory(
  opts: { leadId?: string; phone?: string; limit?: number } = {},
) {
  const filters = [];
  if (opts.leadId) filters.push(eq(dialerSmsMessages.leadId, opts.leadId));
  if (opts.phone) {
    const digits = opts.phone.replace(/\D/g, "");
    const suffix = digits.length >= 10 ? digits.slice(-10) : digits;
    filters.push(
      sql`regexp_replace(${dialerSmsMessages.phoneNumber}, '\\D', '', 'g') LIKE ${"%" + suffix}`,
    );
  }

  const rows = await db
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
      leadFirstName: crmLeads.firstName,
      leadLastName: crmLeads.lastName,
      leadCompany: crmLeads.company,
      contactName: dialerContacts.name,
    })
    .from(dialerSmsMessages)
    .leftJoin(crmLeads, eq(dialerSmsMessages.leadId, crmLeads.id))
    .leftJoin(
      dialerContacts,
      eq(dialerSmsMessages.phoneNumber, dialerContacts.phone),
    )
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(dialerSmsMessages.createdAt))
    .limit(opts.limit ?? 500);

  return rows.map((r) => ({
    ...r,
    leadName:
      r.contactName ||
      (r.leadLastName
        ? leadDisplayName({
            firstName: r.leadFirstName,
            lastName: r.leadLastName,
            company: r.leadCompany,
          })
        : null),
  }));
}

// ── Templates ────────────────────────────────────────────
export async function getMessageTemplates(type?: MessageType | null) {
  return db
    .select()
    .from(dialerMessageTemplates)
    .where(
      type
        ? and(
            eq(dialerMessageTemplates.isActive, true),
            eq(dialerMessageTemplates.messageType, type),
          )
        : eq(dialerMessageTemplates.isActive, true),
    )
    .orderBy(desc(dialerMessageTemplates.createdAt));
}

export async function createMessageTemplate(
  name: string,
  messageBody: string,
  messageType: MessageType = "sms",
) {
  const [template] = await db
    .insert(dialerMessageTemplates)
    .values({ name, messageBody, messageType })
    .returning();
  return template;
}

// ── Client presence (inbound routing) ────────────────────
export async function upsertClientSession(
  identity: string,
  userId: string | null,
  userAgent: string | null,
) {
  const now = new Date();
  const [session] = await db
    .insert(dialerClientSessions)
    .values({
      identity,
      userId,
      lastHeartbeat: now,
      userAgent,
      isActive: true,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: dialerClientSessions.identity,
      set: { lastHeartbeat: now, userAgent, userId, isActive: true, updatedAt: now },
    })
    .returning();
  return session;
}

export async function getActiveClients(timeoutSeconds = 30) {
  const threshold = new Date(Date.now() - timeoutSeconds * 1000);
  return db
    .select()
    .from(dialerClientSessions)
    .where(
      and(
        eq(dialerClientSessions.isActive, true),
        gte(dialerClientSessions.lastHeartbeat, threshold),
      ),
    )
    .orderBy(desc(dialerClientSessions.lastHeartbeat));
}

export async function removeClientSession(identity: string) {
  const [session] = await db
    .update(dialerClientSessions)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(dialerClientSessions.identity, identity))
    .returning();
  return session ?? null;
}

// ── Push subscriptions ───────────────────────────────────
export async function upsertPushSubscription(
  endpoint: string,
  p256dh: string,
  auth: string,
  userId: string | null,
  userAgent: string | null,
) {
  const now = new Date();
  const [subscription] = await db
    .insert(dialerPushSubscriptions)
    .values({ endpoint, p256dhKey: p256dh, authKey: auth, userId, userAgent, updatedAt: now })
    .onConflictDoUpdate({
      target: dialerPushSubscriptions.endpoint,
      set: { p256dhKey: p256dh, authKey: auth, userId, userAgent, updatedAt: now },
    })
    .returning();
  return subscription;
}

export async function getPushSubscriptions() {
  return db
    .select()
    .from(dialerPushSubscriptions)
    .orderBy(desc(dialerPushSubscriptions.createdAt));
}

export async function deletePushSubscription(endpoint: string) {
  const [subscription] = await db
    .delete(dialerPushSubscriptions)
    .where(eq(dialerPushSubscriptions.endpoint, endpoint))
    .returning();
  return subscription ?? null;
}
