// NuraView Dialer (Twilio voice + SMS) — migrated into nextcrm.
//
// These tables were lifted from the standalone dialer app (alifsense/dialer).
// To coexist in the same Neon database every SQL object is prefixed `dialer_`
// and every exported symbol is prefixed `dialer` (so `export *` from
// lib/db/schema.ts doesn't collide with nextcrm's tables).
//
// Differences vs the standalone schema:
// - `contacts` table dropped — crm_Leads is the contact source. Calls/SMS
//   reference leads via a nullable `lead_id` (unknown callers stay null).
// - `agent_identity` on calls + `user_id` on sessions/subscriptions tie
//   dialer activity to CRM users (identity format: agent_<userId>).
// - `activity_id` backlinks a finished call to the crm_Activities row the
//   call-status webhook logs for the lead timeline.

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { crmActivities, crmLeads, users } from "./schema";

// ── Enums ────────────────────────────────────────────────
export const dialerCallStatusEnum = pgEnum("dialer_call_status", [
  "initiated",
  "ringing",
  "in-progress",
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
]);

export const dialerCallDirectionEnum = pgEnum("dialer_call_direction", [
  "inbound",
  "outbound-api",
  "outbound-dial",
]);

export const dialerMessageDirectionEnum = pgEnum("dialer_message_direction", [
  "inbound",
  "outbound",
]);

export const dialerMessageTypeEnum = pgEnum("dialer_message_type", [
  "sms",
  "whatsapp",
]);

// ── Tables ───────────────────────────────────────────────
// Dedicated dialer phone-book — intentionally separate from crm_Leads
// (the Upwork pipeline). Port of the standalone app's `contacts` table.
export const dialerContacts = pgTable(
  "dialer_contacts",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    phone: text("phone").notNull().unique(),
    email: text("email"),
    requirementTag: text("requirement_tag"),
    smsEnabled: boolean("sms_enabled").default(true),
    whatsappEnabled: boolean("whatsapp_enabled").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [index("dialer_contacts_name_idx").on(table.name)],
);

export const dialerCalls = pgTable(
  "dialer_calls",
  {
    id: serial("id").primaryKey(),
    leadId: uuid("lead_id").references(() => crmLeads.id, {
      onDelete: "set null",
    }),
    phoneNumber: text("phone_number").notNull(),
    callSid: text("call_sid").notNull().unique(),
    status: dialerCallStatusEnum("status").notNull(),
    direction: dialerCallDirectionEnum("direction").notNull(),
    duration: integer("duration"),
    agentIdentity: text("agent_identity"),
    activityId: uuid("activity_id").references(() => crmActivities.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("dialer_calls_lead_id_idx").on(table.leadId),
    index("dialer_calls_created_at_idx").on(table.createdAt),
    index("dialer_calls_phone_idx").on(table.phoneNumber),
    // The outbound duplicate-call guard scans recent active calls per agent.
    index("dialer_calls_agent_status_idx").on(table.agentIdentity, table.status),
  ],
);

export const dialerSmsMessages = pgTable(
  "dialer_sms_messages",
  {
    id: serial("id").primaryKey(),
    leadId: uuid("lead_id").references(() => crmLeads.id, {
      onDelete: "set null",
    }),
    phoneNumber: text("phone_number").notNull(),
    messageSid: text("message_sid").notNull().unique(),
    messageBody: text("message_body").notNull(),
    // queued, sent, delivered, undelivered, failed, received
    messageStatus: text("message_status").notNull(),
    direction: dialerMessageDirectionEnum("direction").notNull(),
    messageType: dialerMessageTypeEnum("message_type").notNull().default("sms"),
    callId: integer("call_id").references(() => dialerCalls.id),
    templateId: integer("template_id").references(
      () => dialerMessageTemplates.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("dialer_sms_lead_created_idx").on(table.leadId, table.createdAt),
    index("dialer_sms_phone_idx").on(table.phoneNumber),
  ],
);

export const dialerMessageTemplates = pgTable("dialer_message_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  messageBody: text("message_body").notNull(),
  messageType: dialerMessageTypeEnum("message_type").notNull().default("sms"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const dialerClientSessions = pgTable("dialer_client_sessions", {
  id: serial("id").primaryKey(),
  identity: text("identity").notNull().unique(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true })
    .notNull()
    .defaultNow(),
  userAgent: text("user_agent"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const dialerPushSubscriptions = pgTable("dialer_push_subscriptions", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dhKey: text("p256dh_key").notNull(),
  authKey: text("auth_key").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── Relations ────────────────────────────────────────────
export const dialerCallsRelations = relations(dialerCalls, ({ one, many }) => ({
  lead: one(crmLeads, {
    fields: [dialerCalls.leadId],
    references: [crmLeads.id],
  }),
  activity: one(crmActivities, {
    fields: [dialerCalls.activityId],
    references: [crmActivities.id],
  }),
  messages: many(dialerSmsMessages),
}));

export const dialerSmsMessagesRelations = relations(
  dialerSmsMessages,
  ({ one }) => ({
    lead: one(crmLeads, {
      fields: [dialerSmsMessages.leadId],
      references: [crmLeads.id],
    }),
    call: one(dialerCalls, {
      fields: [dialerSmsMessages.callId],
      references: [dialerCalls.id],
    }),
    template: one(dialerMessageTemplates, {
      fields: [dialerSmsMessages.templateId],
      references: [dialerMessageTemplates.id],
    }),
  }),
);

export const dialerClientSessionsRelations = relations(
  dialerClientSessions,
  ({ one }) => ({
    user: one(users, {
      fields: [dialerClientSessions.userId],
      references: [users.id],
    }),
  }),
);

export const dialerPushSubscriptionsRelations = relations(
  dialerPushSubscriptions,
  ({ one }) => ({
    user: one(users, {
      fields: [dialerPushSubscriptions.userId],
      references: [users.id],
    }),
  }),
);
