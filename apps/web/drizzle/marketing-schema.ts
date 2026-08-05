// NuraView Marketer (nvMarketter) — migrated into nextcrm.
//
// These tables were lifted from the standalone nv-marketter app. To coexist in
// the same Neon database without clashing with nextcrm's existing tables
// (Users, Email, crm_Contacts, crm_campaign_templates, …) every SQL object is
// prefixed `mkt_` and every exported symbol is prefixed `mkt` (so `export *`
// from lib/db/schema.ts doesn't collide with nextcrm's `users`/`emails`/etc.).
//
// Ported Marketer code imports these with aliases, e.g.
//   import { mktEmails as emails, mktUsers as users } from "@/lib/db";
// so the original query bodies stay byte-for-byte intact.

import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────
export const mktEmailStatusEnum = pgEnum("mkt_email_status", [
  "draft",
  "queued",
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "failed",
]);

export const mktSequenceStatusEnum = pgEnum("mkt_sequence_status", [
  "active",
  "cancelled",
  "complete",
  "paused",
]);

export const mktSequenceItemStatusEnum = pgEnum("mkt_sequence_item_status", [
  "pending",
  "scheduled",
  "sent",
  "failed",
  "cancelled",
]);

// ── Core tables ──────────────────────────────────────────
export const mktUsers = pgTable(
  "mkt_users",
  {
    id: serial("id").primaryKey(),
    firstName: varchar("first_name", { length: 50 }),
    lastName: varchar("last_name", { length: 50 }),
    email: varchar("email", { length: 255 }).notNull(),
    jobTitle: varchar("job_title", { length: 100 }),
    company: varchar("company", { length: 100 }),
    location: varchar("location", { length: 100 }),
    twitter: varchar("twitter", { length: 100 }),
    linkedin: varchar("linkedin", { length: 100 }),
    github: varchar("github", { length: 100 }),
    avatarUrl: varchar("avatar_url", { length: 255 }),
  },
  (table) => [uniqueIndex("mkt_email_idx").on(table.email)],
);

export const mktThreads = pgTable("mkt_threads", {
  id: serial("id").primaryKey(),
  subject: varchar("subject", { length: 255 }),
  lastActivityDate: timestamp("last_activity_date").defaultNow(),
});

export const mktEmails = pgTable(
  "mkt_emails",
  {
    id: serial("id").primaryKey(),
    threadId: integer("thread_id").references(() => mktThreads.id),
    senderId: integer("sender_id").references(() => mktUsers.id),
    recipientId: integer("recipient_id").references(() => mktUsers.id),
    subject: varchar("subject", { length: 255 }),
    body: text("body"),
    bodyHtml: text("body_html"),
    sentDate: timestamp("sent_date").defaultNow(),
    resendId: varchar("resend_id", { length: 255 }),
    // A/B email-provider attribution: 'resend' | 'smtp' (Mailu VPS)
    provider: varchar("provider", { length: 20 }),
    // Which sending identity/domain this email went out as (email-senders id,
    // e.g. "smtp:varshith@nuraview.us"). Drives per-domain deliverability on the
    // dashboard. Null on legacy rows → attributed to the default sender.
    fromAccountId: varchar("from_account_id", { length: 120 }),
    providerMessageId: varchar("provider_message_id", { length: 255 }),
    status: mktEmailStatusEnum("status").default("draft"),
    deliveredAt: timestamp("delivered_at"),
    openedAt: timestamp("opened_at"),
    clickedAt: timestamp("clicked_at"),
    bouncedAt: timestamp("bounced_at"),
    openedCount: integer("opened_count").default(0),
    clickedCount: integer("clicked_count").default(0),
  },
  (table) => [
    index("mkt_thread_id_idx").on(table.threadId),
    index("mkt_sender_id_idx").on(table.senderId),
    index("mkt_recipient_id_idx").on(table.recipientId),
    index("mkt_sent_date_idx").on(table.sentDate),
    index("mkt_resend_id_idx").on(table.resendId),
    index("mkt_status_idx").on(table.status),
    index("mkt_provider_idx").on(table.provider),
    index("mkt_from_account_id_idx").on(table.fromAccountId),
  ],
);

export const mktFolders = pgTable("mkt_folders", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
});

export const mktUserFolders = pgTable("mkt_user_folders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => mktUsers.id),
  folderId: integer("folder_id").references(() => mktFolders.id),
});

export const mktThreadFolders = pgTable("mkt_thread_folders", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").references(() => mktThreads.id),
  folderId: integer("folder_id").references(() => mktFolders.id),
});

export const mktEmailEvents = pgTable(
  "mkt_email_events",
  {
    id: serial("id").primaryKey(),
    resendId: varchar("resend_id", { length: 255 }).notNull(),
    emailId: integer("email_id").references(() => mktEmails.id),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("mkt_event_resend_id_idx").on(table.resendId),
    index("mkt_event_email_id_idx").on(table.emailId),
    index("mkt_event_type_idx").on(table.eventType),
  ],
);

export const mktTemplates = pgTable("mkt_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  subject: varchar("subject", { length: 255 }),
  bodyHtml: text("body_html"),
  bodyText: text("body_text"),
  variables: jsonb("variables"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const mktContacts = pgTable(
  "mkt_contacts",
  {
    id: serial("id").primaryKey(),
    firstName: varchar("first_name", { length: 100 }),
    lastName: varchar("last_name", { length: 100 }),
    email: varchar("email", { length: 255 }).notNull(),
    company: varchar("company", { length: 100 }),
    tags: jsonb("tags"),
    lastEngagement: timestamp("last_engagement"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [uniqueIndex("mkt_contact_email_idx").on(table.email)],
);

// ── Sequences ────────────────────────────────────────────
export const mktSequences = pgTable(
  "mkt_sequences",
  {
    id: serial("id").primaryKey(),
    campaign: varchar("campaign", { length: 255 }),
    initiatorUserId: integer("initiator_user_id").references(() => mktUsers.id),
    // Which sender identity to use for this sequence's follow-ups (email-senders
    // id, e.g. "resend:varshith@nuraview.com" / "smtp:varshith@creative-hive.co").
    senderId: varchar("sender_id", { length: 120 }),
    status: mktSequenceStatusEnum("status").default("active"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("mkt_sequence_status_idx").on(table.status),
    index("mkt_sequence_created_at_idx").on(table.createdAt),
  ],
);

export const mktSequenceItems = pgTable(
  "mkt_sequence_items",
  {
    id: serial("id").primaryKey(),
    sequenceId: integer("sequence_id").references(() => mktSequences.id),
    contactEmail: varchar("contact_email", { length: 255 }).notNull(),
    stepNumber: integer("step_number").notNull(),
    subject: varchar("subject", { length: 255 }),
    body: text("body"),
    bodyHtml: text("body_html"),
    scheduledAt: timestamp("scheduled_at").notNull(),
    sentAt: timestamp("sent_at"),
    status: mktSequenceItemStatusEnum("status").default("pending"),
    resendId: varchar("resend_id", { length: 255 }),
    messageIdHeader: varchar("message_id_header", { length: 255 }),
    parentMessageId: varchar("parent_message_id", { length: 255 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("mkt_sequence_item_sequence_id_idx").on(table.sequenceId),
    index("mkt_sequence_item_email_idx").on(table.contactEmail),
    index("mkt_sequence_item_scheduled_idx").on(table.scheduledAt),
    index("mkt_sequence_item_status_idx").on(table.status),
  ],
);

export const mktSequenceExclusions = pgTable(
  "mkt_sequence_exclusions",
  {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    reason: text("reason"),
    addedBy: integer("added_by").references(() => mktUsers.id),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("mkt_exclusion_email_idx").on(table.email)],
);

export const mktSequenceJobLogs = pgTable(
  "mkt_sequence_job_logs",
  {
    id: serial("id").primaryKey(),
    sequenceItemId: integer("sequence_item_id").references(
      () => mktSequenceItems.id,
    ),
    event: varchar("event", { length: 50 }).notNull(),
    message: text("message"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("mkt_job_log_sequence_item_idx").on(table.sequenceItemId),
    index("mkt_job_log_created_at_idx").on(table.createdAt),
  ],
);

// ── Relations (prefixed to avoid colliding with nextcrm relations.ts) ──
export const mktUsersRelations = relations(mktUsers, ({ many }) => ({
  sentEmails: many(mktEmails, { relationName: "sender" }),
  receivedEmails: many(mktEmails, { relationName: "recipient" }),
  userFolders: many(mktUserFolders),
}));

export const mktThreadsRelations = relations(mktThreads, ({ many }) => ({
  emails: many(mktEmails),
  threadFolders: many(mktThreadFolders),
}));

export const mktEmailsRelations = relations(mktEmails, ({ one, many }) => ({
  thread: one(mktThreads, {
    fields: [mktEmails.threadId],
    references: [mktThreads.id],
  }),
  sender: one(mktUsers, {
    fields: [mktEmails.senderId],
    references: [mktUsers.id],
    relationName: "sender",
  }),
  recipient: one(mktUsers, {
    fields: [mktEmails.recipientId],
    references: [mktUsers.id],
    relationName: "recipient",
  }),
  events: many(mktEmailEvents),
}));

export const mktEmailEventsRelations = relations(mktEmailEvents, ({ one }) => ({
  email: one(mktEmails, {
    fields: [mktEmailEvents.emailId],
    references: [mktEmails.id],
  }),
}));

export const mktFoldersRelations = relations(mktFolders, ({ many }) => ({
  userFolders: many(mktUserFolders),
  threadFolders: many(mktThreadFolders),
}));

export const mktUserFoldersRelations = relations(mktUserFolders, ({ one }) => ({
  user: one(mktUsers, {
    fields: [mktUserFolders.userId],
    references: [mktUsers.id],
  }),
  folder: one(mktFolders, {
    fields: [mktUserFolders.folderId],
    references: [mktFolders.id],
  }),
}));

export const mktThreadFoldersRelations = relations(
  mktThreadFolders,
  ({ one }) => ({
    thread: one(mktThreads, {
      fields: [mktThreadFolders.threadId],
      references: [mktThreads.id],
    }),
    folder: one(mktFolders, {
      fields: [mktThreadFolders.folderId],
      references: [mktFolders.id],
    }),
  }),
);

export const mktSequencesRelations = relations(mktSequences, ({ many }) => ({
  items: many(mktSequenceItems),
}));

export const mktSequenceItemsRelations = relations(
  mktSequenceItems,
  ({ one, many }) => ({
    sequence: one(mktSequences, {
      fields: [mktSequenceItems.sequenceId],
      references: [mktSequences.id],
    }),
    logs: many(mktSequenceJobLogs),
  }),
);

// Email-verification cache (Reacher SMTP existence check). Keyed by address;
// avoids re-probing the same email (reputation + speed).
export const mktEmailVerifications = pgTable("mkt_email_verifications", {
  email: varchar("email", { length: 320 }).primaryKey(),
  reachable: varchar("reachable", { length: 10 }),
  result: jsonb("result"),
  checkedAt: timestamp("checked_at").defaultNow(),
});
