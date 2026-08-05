/**
 * Drizzle definitions for the NuraView CRM tables.
 *
 * These live in a SEPARATE database from the PM tables (see ./crm.ts). During
 * the migration the legacy Next app still owns writes to this schema, so
 * everything here is treated as read-mostly: the ported API reads leads,
 * statuses and sources, and write paths are added per-endpoint only once the
 * corresponding legacy surface is retired.
 *
 * Column names are quoted camelCase because the schema was originally generated
 * by `drizzle-kit pull` against a Prisma-created database.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const crmLeads = pgTable(
  "crm_Leads",
  {
    id: uuid("id").primaryKey(),
    createdAt: timestamp("createdAt", { mode: "date" }),
    updatedAt: timestamp("updatedAt", { mode: "date" }),
    firstName: text("firstName"),
    lastName: text("lastName"),
    company: text("company"),
    jobTitle: text("jobTitle"),
    email: text("email"),
    phone: text("phone"),
    description: text("description"),
    assignedTo: uuid("assigned_to"),
    leadSourceId: uuid("lead_source_id"),
    leadStatusId: uuid("lead_status_id"),
    leadTypeId: uuid("lead_type_id"),
    deletedAt: timestamp("deletedAt", { mode: "date" }),

    // Upwork ingest — written by apps/scraper via /api/ingest/upwork
    upworkJobUrl: text("upwork_job_url"),
    upworkJobId: text("upwork_job_id"),
    extractedAt: timestamp("extracted_at", { mode: "date" }),
    sourcePayload: jsonb("source_payload"),
    postedAt: timestamp("posted_at", { mode: "date" }),
    hasClientInfo: boolean("has_client_info"),

    // Outreach workflow
    highlightedAt: timestamp("highlighted_at", { mode: "date" }),
    lastContactedAt: timestamp("last_contacted_at", { mode: "date" }),
    reminderAt: timestamp("reminder_at", { mode: "date" }),
    reminderNote: text("reminder_note"),
    // Used by the Kanban's Reminders column: a reminder that fired in the last
    // 24h keeps its card visible even after the message went out.
    reminderSentAt: timestamp("reminder_sent_at", { mode: "date" }),
    reminderFirstSentAt: timestamp("reminder_first_sent_at", { mode: "date" }),
    reminderFollowupPending: boolean("reminder_followup_pending"),
    // Which WHATSAPP_RECIPIENTS entry this lead's reminder goes to (e.g. "VK",
    // "AbdulMateen"). Null falls back to WHATSAPP_TO. Read by the reminder cron.
    reminderAccount: text("reminder_account"),
    irrelevantAt: timestamp("irrelevant_at", { mode: "date" }),
    irrelevantReason: text("irrelevant_reason"),

    linkedinUrl: text("linkedin_url"),
    emailSecondary: text("email_secondary"),
    phoneSecondary: text("phone_secondary"),

    // Outreach email, exactly as crmx1 stored it.
    //
    // generated_email_* is the AI draft the Email Generator wrote, kept on the
    // row so a half-reviewed email survives closing the drawer. Cleared on
    // send.
    generatedEmailSubject: text("generated_email_subject"),
    generatedEmailBody: text("generated_email_body"),
    // sent_email_* is the snapshot of what actually went out. The marketing
    // tables hold no CC and no lead link, so this is the only per-lead record
    // of the message — it is what the drawer's "Sent Email" block reads.
    sentEmailSubject: text("sent_email_subject"),
    sentEmailBody: text("sent_email_body"),
    sentEmailTo: text("sent_email_to"),
    sentEmailCc: text("sent_email_cc"),

    // Cap share URL — the per-lead video recording (the Loom replacement) that
    // the outreach email embeds as a thumbnail. Declared here because the lead
    // detail both reads and writes it; the column already exists in the CRM
    // database, this file simply had not caught up.
    videoLink: text("video_link"),
    // Projection of the latest enrichment run, so the list can badge a lead
    // without joining the audit table on every row. The audit trail itself
    // lives in crm_Lead_Enrichment.
    enrichmentStatus: text("enrichment_status"),
    enrichedAt: timestamp("enriched_at", { precision: 3, mode: "date" }),
    // NOTE: there is no `budget` column on crm_Leads. The posting's budget
    // lives inside `source_payload` (budget_raw, or the budget_min/max pair) —
    // `budget` on crm_Opportunities is a different thing entirely. Adding one
    // here produced errorMissingColumn and 500'd the whole lead detail.
  },
  (table) => [
    index("crm_leads_created_at_idx").on(table.createdAt),
    index("crm_leads_status_idx").on(table.leadStatusId),
    /*
     * The leads page's ONE hot path, in index form.
     *
     * /lead/view sorts the active pipeline by arrival — coalesce(extracted_at,
     * createdAt) desc — and takes 50 rows. Neither plain column index can serve
     * that sort, so Postgres seq-scanned all 52k rows and top-N sorted them:
     * 1.8s and ~1.2GB of buffers to return 50 rows, on every page load and
     * every Kanban day column.
     *
     * Partial on the same predicate the endpoint always applies (deletedAt is
     * null and irrelevant_at is null), so the index stays the size of the
     * working pipeline rather than the whole archive, and the from/to Kanban
     * windows range-scan it too. Measured 1828ms -> 0.4ms.
     *
     * Applied to prod as CREATE INDEX CONCURRENTLY; matched here so a later
     * generate does not propose dropping it.
     */
    index("crm_Leads_active_arrived_idx")
      .on(sql`(COALESCE(extracted_at, "createdAt")) DESC`)
      .where(sql`"deletedAt" IS NULL AND irrelevant_at IS NULL`),
  ],
);

/**
 * Enrichment run audit. One row per attempt, written PENDING at queue time and
 * updated by the Inngest worker.
 *
 * `status` is a Postgres enum (`crm_EnrichmentStatus`) in the real schema;
 * declared as text here because Drizzle only needs to read and write the
 * values, and re-declaring the enum type risks drizzle-kit proposing to create
 * it. Values: PENDING | RUNNING | COMPLETED | FAILED | SKIPPED.
 */
export const crmLeadEnrichment = pgTable("crm_Lead_Enrichment", {
  id: uuid("id").primaryKey(),
  leadId: uuid("leadId").notNull(),
  status: text("status").notNull(),
  mode: text("mode"), // auto | manual | deep
  fields: text("fields").array(),
  result: jsonb("result"),
  costUsd: numeric("cost_usd", { precision: 10, scale: 4 }),
  error: text("error"),
  triggeredBy: uuid("triggeredBy"),
  createdAt: timestamp("createdAt", { precision: 3, mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { precision: 3, mode: "date" }).notNull(),
});

/**
 * Per-user "I have opened this lead" log.
 *
 * Stamped on every lead-detail open. The list and the kanban left-join it for
 * the CURRENT user, so each row can show the 👁 icon for leads that reviewer
 * has already eyeballed — the "what's new since last time" scan signal. One
 * row per user per lead; viewed_at is refreshed on each subsequent open.
 */
export const crmLeadViews = pgTable(
  "crm_Lead_Views",
  {
    leadId: uuid("lead_id").notNull(),
    userId: uuid("user_id").notNull(),
    viewedAt: timestamp("viewed_at", { precision: 3, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.leadId, table.userId] })],
);

export const crmLeadStatuses = pgTable("crm_Lead_Statuses", {
  id: uuid("id").primaryKey(),
  name: text("name"),
});

export const crmLeadSources = pgTable("crm_Lead_Sources", {
  id: uuid("id").primaryKey(),
  name: text("name"),
});

/**
 * Dialer tables. Ported from apps/web/drizzle/dialer-schema.ts.
 *
 * Enum columns (status, direction, message_type) are declared as text for the
 * same reason as crm_Lead_Enrichment.status: Drizzle only needs to read and
 * write the values, and re-declaring the pgEnum invites drizzle-kit to propose
 * creating a type that already exists.
 *
 * These use serial integer PKs, unlike the uuid-keyed CRM tables — they were
 * added later, by a different hand.
 */
export const dialerContacts = pgTable("dialer_contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  requirementTag: text("requirement_tag"),
  smsEnabled: boolean("sms_enabled"),
  whatsappEnabled: boolean("whatsapp_enabled"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
});

/*
 * Browser push subscriptions — one row per browser, keyed by endpoint.
 * Transcribed from information_schema: user_id is a uuid and nullable (a
 * subscription can exist before we know which user it belongs to), the key
 * columns are p256dh_key / auth_key, and both timestamps carry a timezone.
 */
export const dialerPushSubscriptions = pgTable("dialer_push_subscriptions", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull(),
  p256dhKey: text("p256dh_key").notNull(),
  authKey: text("auth_key").notNull(),
  userId: uuid("user_id"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
});

export const dialerCalls = pgTable("dialer_calls", {
  id: serial("id").primaryKey(),
  leadId: uuid("lead_id"),
  phoneNumber: text("phone_number").notNull(),
  callSid: text("call_sid").notNull(),
  status: text("status").notNull(),
  direction: text("direction").notNull(),
  duration: integer("duration"),
  agentIdentity: text("agent_identity"),
  activityId: uuid("activity_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
});

export const dialerSmsMessages = pgTable("dialer_sms_messages", {
  id: serial("id").primaryKey(),
  leadId: uuid("lead_id"),
  phoneNumber: text("phone_number").notNull(),
  messageSid: text("message_sid").notNull(),
  messageBody: text("message_body").notNull(),
  messageStatus: text("message_status").notNull(),
  direction: text("direction").notNull(),
  messageType: text("message_type").notNull(),
  callId: integer("call_id"),
  templateId: integer("template_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
});

export const dialerMessageTemplates = pgTable("dialer_message_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  messageBody: text("message_body").notNull(),
  messageType: text("message_type").notNull(),
  isActive: boolean("is_active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
});

export const dialerClientSessions = pgTable("dialer_client_sessions", {
  id: serial("id").primaryKey(),
  identity: text("identity").notNull(),
  userId: uuid("user_id"),
  lastHeartbeat: timestamp("last_heartbeat", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  userAgent: text("user_agent"),
  isActive: boolean("is_active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
});


/**
 * Marketing mailbox (mkt_*). Ported from apps/web/drizzle/marketing-schema.ts.
 *
 * Enums declared as text for the same reason as elsewhere in this file: Drizzle
 * only reads and writes the values, and re-declaring a pgEnum invites
 * drizzle-kit to propose creating a type that already exists.
 *
 * `mkt_users` is the mailbox's OWN participant table — senders and recipients
 * of marketing email. It is not the auth user table and the two are unrelated.
 */
/*
 * Transcribed from production (\d mkt_users), not guessed.
 *
 * The previous declaration had `name: text` and a bare `integer` id. There is
 * no `name` column — production has first_name/last_name — and the id carries
 * a sequence default, so any insert that omitted it would have failed on a
 * not-null violation. Reads happened to survive because nothing selected the
 * missing column; the send path inserts, so it would not have.
 */
export const mktUsers = pgTable("mkt_users", {
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
});

export const mktThreads = pgTable("mkt_threads", {
  id: serial("id").primaryKey(),
  subject: text("subject"),
  lastActivityDate: timestamp("last_activity_date", { mode: "date" }),
});

export const mktEmails = pgTable("mkt_emails", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id"),
  senderId: integer("sender_id"),
  recipientId: integer("recipient_id"),
  subject: text("subject"),
  body: text("body"),
  bodyHtml: text("body_html"),
  sentDate: timestamp("sent_date", { mode: "date" }),
  resendId: text("resend_id"),
  // A/B provider attribution: 'resend' | 'smtp' (Mailu on the VPS).
  provider: text("provider"),
  fromAccountId: text("from_account_id"),
  providerMessageId: text("provider_message_id"),
  status: text("status"),
  deliveredAt: timestamp("delivered_at", { mode: "date" }),
  openedAt: timestamp("opened_at", { mode: "date" }),
  clickedAt: timestamp("clicked_at", { mode: "date" }),
  bouncedAt: timestamp("bounced_at", { mode: "date" }),
  openedCount: integer("opened_count"),
  clickedCount: integer("clicked_count"),
});

export const mktContacts = pgTable("mkt_contacts", {
  id: serial("id").primaryKey(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email").notNull(),
  company: text("company"),
  tags: jsonb("tags"),
  lastEngagement: timestamp("last_engagement", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }),
});

export const mktSequences = pgTable("mkt_sequences", {
  id: serial("id").primaryKey(),
  campaign: text("campaign"),
  initiatorUserId: integer("initiator_user_id"),
  senderId: text("sender_id"),
  status: text("status"),
  createdAt: timestamp("created_at", { mode: "date" }),
  updatedAt: timestamp("updated_at", { mode: "date" }),
});

/*
 * Transcribed from production (information_schema), like every other table
 * here. It previously declared a `body` column that does not exist — the real
 * ones are body_html and body_text — so GET /marketing/templates 500'd with
 * errorMissingColumn and the whole compose page rendered blank.
 *
 * Third time this exact class of bug has shipped: crm_Leads.budget,
 * mkt_users.name, now this. Declarations get checked against the database.
 */
export const mktTemplates = pgTable("mkt_templates", {
  id: serial("id").primaryKey(),
  name: text("name"),
  subject: text("subject"),
  bodyHtml: text("body_html"),
  bodyText: text("body_text"),
  variables: jsonb("variables"),
  createdAt: timestamp("created_at", { mode: "date" }),
  updatedAt: timestamp("updated_at", { mode: "date" }),
});

/*
 * The Stop List. Transcribed from information_schema like everything else here
 * (varchar email, integer added_by, nullable created_at with a now() default).
 *
 * The follow-up dispatcher already honours this table — it was reading it
 * through raw SQL because nothing declared it. Nothing could WRITE to it on
 * this stack, which meant "stop emailing me" had no button behind it.
 */
export const mktSequenceExclusions = pgTable("mkt_sequence_exclusions", {
  id: serial("id").primaryKey(),
  email: varchar("email").notNull(),
  reason: text("reason"),
  addedBy: integer("added_by"),
  createdAt: timestamp("created_at", { mode: "date" }),
});

export const crmSchema = {
  crmLeads,
  dialerPushSubscriptions,
  mktSequenceExclusions,
  crmLeadEnrichment,
  crmLeadStatuses,
  crmLeadSources,
  dialerContacts,
  dialerCalls,
  dialerSmsMessages,
  dialerMessageTemplates,
  dialerClientSessions,
  mktUsers,
  mktThreads,
  mktEmails,
  mktContacts,
  mktSequences,
  mktTemplates,
};

/*
 * Marketing tables the SEND path needs, beyond the read surface.
 *
 * All three already exist in the production nuracrm database — these are
 * declarations, not migrations. Column names and types are transcribed from
 * apps/web/drizzle/marketing-schema.ts; a mismatch here produces
 * errorMissingColumn at runtime rather than at build time.
 */
export const mktFolders = pgTable("mkt_folders", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
});

export const mktThreadFolders = pgTable("mkt_thread_folders", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").references(() => mktThreads.id),
  folderId: integer("folder_id").references(() => mktFolders.id),
});

export const mktSequenceItems = pgTable("mkt_sequence_items", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").references(() => mktSequences.id),
  contactEmail: varchar("contact_email", { length: 255 }).notNull(),
  stepNumber: integer("step_number").notNull(),
  subject: varchar("subject", { length: 255 }),
  body: text("body"),
  bodyHtml: text("body_html"),
  scheduledAt: timestamp("scheduled_at").notNull(),
  sentAt: timestamp("sent_at"),
  /*
   * Real values are pending | scheduled | sent | failed | cancelled. Declared
   * as text rather than a pgEnum on purpose: the legacy default is "pending"
   * but the app writes "scheduled", and a Drizzle enum here would have to be
   * kept in lockstep with a type this stack does not own. A previous filter on
   * a default value no row ever holds is exactly how the follow-ups list read
   * 0 against the legacy app's 9.
   */
  status: text("status").default("pending"),
  resendId: varchar("resend_id", { length: 255 }),
  messageIdHeader: varchar("message_id_header", { length: 255 }),
  parentMessageId: varchar("parent_message_id", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/** Reacher deliverability cache. Keyed by email so a repeat send is free. */
export const mktEmailVerifications = pgTable("mkt_email_verifications", {
  email: varchar("email", { length: 320 }).primaryKey(),
  reachable: varchar("reachable", { length: 10 }),
  result: jsonb("result"),
  checkedAt: timestamp("checked_at").defaultNow(),
});

/* ─────────────────────────────────────────────────────────────────────────────
 * PROPOSALS
 *
 * Transcribed column-for-column from production (information_schema), not from
 * the legacy Drizzle file. The two had already drifted: the legacy schema.ts
 * lists columns in a different order and the enum is a Postgres USER-DEFINED
 * type. Declaring against the file rather than the database is how the `budget`
 * mistake happened — a column that existed in one place and not the other,
 * producing errorMissingColumn and a 500 on every detail view.
 *
 * These tables ALREADY EXIST. This is a declaration; there is no migration and
 * none should be generated. `drizzle-kit push` against this database proposes
 * destructive constraint drops.
 *
 * `status` is declared as text rather than a pgEnum on purpose — the enum type
 * is owned by the legacy app's migrations, and mirroring it here would mean
 * keeping two definitions of the same type in lockstep across two repos.
 * ────────────────────────────────────────────────────────────────────────── */
/**
 * Narrow projections of the invoicing tables — only the columns the proposal
 * approve flow writes. The full shapes live in the legacy app's schema; the
 * tables already exist in the CRM database, these definitions just let this
 * API insert into them.
 */
export const crmAccounts = pgTable("crm_Accounts", {
  id: uuid("id").primaryKey(),
  v: integer("__v").notNull(),
  name: text("name").notNull(),
  status: text("status"),
  createdBy: uuid("createdBy"),
});

export const invoices = pgTable("Invoices", {
  id: uuid("id").primaryKey(),
  accountId: uuid("accountId").notNull(),
  createdBy: uuid("createdBy").notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  status: text("status").notNull().default("DRAFT"),
  issueDate: timestamp("issueDate", { mode: "date" }),
  dueDate: timestamp("dueDate", { mode: "date" }),
  subtotal: numeric("subtotal").notNull().default("0"),
  discountTotal: numeric("discountTotal").notNull().default("0"),
  vatTotal: numeric("vatTotal").notNull().default("0"),
  grandTotal: numeric("grandTotal").notNull().default("0"),
  paidTotal: numeric("paidTotal").notNull().default("0"),
  balanceDue: numeric("balanceDue").notNull().default("0"),
  publicNotes: text("publicNotes"),
  /** Staff-only. Carries the `[test]` marker for Stripe test-mode invoices. */
  internalNotes: text("internalNotes"),
  /**
   * Point-in-time copy of who was billed and how the total was built (client
   * name/email/address, processing fee). The pay page renders from this, so an
   * invoice keeps reading correctly even if the account is later renamed.
   */
  billingSnapshot: jsonb("billingSnapshot"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
});

export const invoiceLineItems = pgTable("Invoice_LineItems", {
  id: uuid("id").primaryKey(),
  invoiceId: uuid("invoiceId").notNull(),
  position: integer("position").notNull(),
  productId: uuid("productId"),
  description: text("description").notNull(),
  quantity: numeric("quantity").notNull(),
  unitPrice: numeric("unitPrice").notNull(),
  discountPercent: numeric("discountPercent").notNull().default("0"),
  taxRateId: uuid("taxRateId"),
  taxRateSnapshot: numeric("taxRateSnapshot"),
  lineSubtotal: numeric("lineSubtotal").notNull(),
  lineVat: numeric("lineVat").notNull(),
  lineTotal: numeric("lineTotal").notNull(),
});

export const crmProposals = pgTable("crm_Proposals", {
  id: uuid("id").primaryKey(),
  number: integer("number"),
  clientSlug: text("clientSlug"),
  title: text("title").notNull(),
  status: text("status").notNull(),
  accountId: uuid("accountId"),
  contactId: uuid("contactId"),
  createdBy: uuid("createdBy").notNull(),
  isTemplate: boolean("isTemplate").notNull().default(false),
  templateName: text("templateName"),
  sourceTemplateId: uuid("sourceTemplateId"),
  clientName: text("clientName"),
  clientCompany: text("clientCompany"),
  clientEmail: text("clientEmail"),
  clientAddress: text("clientAddress"),
  projectName: text("projectName"),
  proposalDate: timestamp("proposalDate", { mode: "date" }),
  currency: varchar("currency", { length: 3 }).notNull(),
  theme: text("theme"),
  videoUrl: text("videoUrl"),
  scheduleCallUrl: text("scheduleCallUrl"),
  designPresetId: text("designPresetId"),
  designTokens: jsonb("designTokens"),
  portfolioConfig: jsonb("portfolioConfig"),
  brandColor: text("brandColor"),
  logoStorageKey: text("logoStorageKey"),
  /** Ordered Tiptap sections — the document body, and the AI write target. */
  sections: jsonb("sections"),
  pricingMode: text("pricingMode").notNull().default("LINE_ITEMS"),
  fixedPrice: numeric("fixedPrice"),
  subtotal: numeric("subtotal").notNull().default("0"),
  discountTotal: numeric("discountTotal").notNull().default("0"),
  taxTotal: numeric("taxTotal").notNull().default("0"),
  transactionFee: numeric("transactionFee").notNull().default("0"),
  processingFee: numeric("processingFee").notNull().default("0"),
  grandTotal: numeric("grandTotal").notNull().default("0"),
  /** Upfront amount. This is the "50% upfront" field, already in the schema. */
  depositAmount: numeric("depositAmount"),
  /** 32-char nanoid. The token alone is the credential for the public page. */
  shareToken: text("shareToken"),
  sentAt: timestamp("sentAt", { mode: "date" }),
  firstViewedAt: timestamp("firstViewedAt", { mode: "date" }),
  lastViewedAt: timestamp("lastViewedAt", { mode: "date" }),
  viewCount: integer("viewCount").notNull().default(0),
  decisionAt: timestamp("decisionAt", { mode: "date" }),
  expiresAt: timestamp("expiresAt", { mode: "date" }),
  approvedByName: text("approvedByName"),
  approvedByEmail: text("approvedByEmail"),
  signatureType: text("signatureType"),
  signatureTypedName: text("signatureTypedName"),
  signatureStorageKey: text("signatureStorageKey"),
  signatureIpAddress: text("signatureIpAddress"),
  rejectionReason: text("rejectionReason"),
  paymentMethod: text("paymentMethod"),
  paymentProvider: text("paymentProvider"),
  stripePaymentIntentId: text("stripePaymentIntentId"),
  stripeCustomerId: text("stripeCustomerId"),
  paypalOrderId: text("paypalOrderId"),
  paypalCaptureId: text("paypalCaptureId"),
  paidAt: timestamp("paidAt", { mode: "date" }),
  linkedInvoiceId: uuid("linkedInvoiceId"),
  pdfStorageKey: text("pdfStorageKey"),
  pdfGeneratedAt: timestamp("pdfGeneratedAt", { mode: "date" }),
  publicNotes: text("publicNotes"),
  internalNotes: text("internalNotes"),
  /**
   * The crm_Leads row this proposal was drafted from, when it came out of the
   * lead card's "Draft with AI". No FK: leads and proposals sit in the same
   * database but have never had a relation, and adding one would fail on the
   * proposals that predate this column. Nullable because a proposal created
   * from the Proposals list has no lead behind it.
   */
  sourceLeadId: uuid("source_lead_id"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
  /** Soft delete. Every read must filter on this being null. */
  deletedAt: timestamp("deletedAt", { mode: "date" }),
});

export const crmProposalLineItems = pgTable("crm_Proposal_LineItems", {
  id: uuid("id").primaryKey(),
  proposalId: uuid("proposalId").notNull(),
  position: integer("position").notNull(),
  productId: uuid("productId"),
  description: text("description").notNull(),
  quantity: numeric("quantity").notNull(),
  unitPrice: numeric("unitPrice").notNull(),
  discountPercent: numeric("discountPercent").notNull().default("0"),
  taxRateId: uuid("taxRateId"),
  taxRateSnapshot: numeric("taxRateSnapshot"),
  lineSubtotal: numeric("lineSubtotal").notNull(),
  lineVat: numeric("lineVat").notNull(),
  lineTotal: numeric("lineTotal").notNull(),
  /** The client may change this quantity on the public page before signing. */
  clientAdjustable: boolean("clientAdjustable").notNull().default(false),
  minQty: numeric("minQty"),
  maxQty: numeric("maxQty"),
  /** Volume pricing: [{ minQty, unitPrice }]. Resolved at approve time. */
  tiers: jsonb("tiers"),
});

export const crmProposalAssets = pgTable("crm_Proposal_Assets", {
  id: uuid("id").primaryKey(),
  proposalId: uuid("proposalId").notNull(),
  position: integer("position").notNull().default(0),
  kind: text("kind").notNull().default("PDF"),
  title: text("title"),
  storageKey: text("storageKey").notNull(),
  previewStorageKey: text("previewStorageKey"),
  pageCount: integer("pageCount"),
  fileSize: integer("fileSize"),
  category: text("category").notNull().default("GENERAL"),
  featured: boolean("featured").notNull().default(false),
  externalUrl: text("externalUrl"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

export const crmProposalActivity = pgTable("crm_Proposal_Activity", {
  id: uuid("id").primaryKey(),
  proposalId: uuid("proposalId").notNull(),
  actorId: uuid("actorId"),
  action: text("action").notNull(),
  meta: jsonb("meta"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull().defaultNow(),
});

/**
 * One row per "Draft with AI" / "Redraft" press.
 *
 * Drafting takes a minute or two, which is too long to hold a request open and
 * far too long to sit on a spinner. The button enqueues a job and returns; the
 * browser polls this row. Same shape as the lead-enrichment audit table, for
 * the same reason — the work outlives the request that asked for it.
 *
 * Status: PENDING | RUNNING | COMPLETED | FAILED. `proposalId` is null until
 * the draft is written, and stays null on failure, so a failed job never
 * leaves a half-built proposal behind.
 */
export const crmProposalAiJobs = pgTable("crm_Proposal_AI_Jobs", {
  id: uuid("id").primaryKey(),
  leadId: uuid("lead_id"),
  /** Set upfront for a redraft, on completion for a new draft. */
  proposalId: uuid("proposal_id"),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  error: text("error"),
  warnings: jsonb("warnings"),
  meta: jsonb("meta"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

/** Singleton row: branding, bank details, defaults. */
export const proposalSettings = pgTable("Proposal_Settings", {
  id: uuid("id").primaryKey(),
  baseCurrency: varchar("baseCurrency", { length: 3 }).notNull(),
  defaultExpiryDays: integer("defaultExpiryDays").notNull().default(30),
  defaultTaxRateId: uuid("defaultTaxRateId"),
  defaultTermsHtml: text("defaultTermsHtml"),
  logoStorageKey: text("logoStorageKey"),
  brandColor: text("brandColor"),
  accentColor: text("accentColor"),
  fontFamily: text("fontFamily"),
  clientAvatars: jsonb("clientAvatars"),
  companyName: text("companyName"),
  companyAddress: text("companyAddress"),
  companyEmail: text("companyEmail"),
  companyPhone: text("companyPhone"),
  companyWebsite: text("companyWebsite"),
  footerText: text("footerText"),
  bankName: text("bankName"),
  bankAccountName: text("bankAccountName"),
  bankAccountNumber: text("bankAccountNumber"),
  bankIban: text("bankIban"),
  bankSwift: text("bankSwift"),
  bankRouting: text("bankRouting"),
  bankInstructions: text("bankInstructions"),
  scheduleCallUrl: text("scheduleCallUrl"),
  stripeFeePercent: numeric("stripeFeePercent"),
  postSignRedirectUrl: text("postSignRedirectUrl"),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
});

/* ---------------------------------------------------------------------------
 * Orders, customers and the customer portal.
 *
 * Created by drizzle/nv_orders.sql (applied with `db:crm-apply`), because the
 * CRM schema is introspected rather than migrated. Declared here so app code
 * gets the same typed access as the rest of the CRM tables.
 * ------------------------------------------------------------------------- */

export const nvCustomers = pgTable("nv_customers", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  organization: text("organization"),
  phone: text("phone"),
  portalUserId: text("portal_user_id"),
  /** manual | inbound | invoice */
  source: text("source").notNull(),
  /** The cockpit's sample_leads.id when this came from a website form. */
  inboundLeadId: integer("inbound_lead_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
});

export const nvOrders = pgTable("nv_orders", {
  id: uuid("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  customerId: uuid("customer_id").notNull(),
  /**
   * pending_payment | paid | awaiting_dispatch | dispatched | delivered |
   * refunded | cancelled — the vocabulary from the 2026-08-03 call.
   */
  status: text("status").notNull(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  notes: text("notes"),
  trackingNumber: text("tracking_number"),
  placedAt: timestamp("placed_at", { withTimezone: true, mode: "date" }),
  paidAt: timestamp("paid_at", { withTimezone: true, mode: "date" }),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true, mode: "date" }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
});

export const nvOrderItems = pgTable("nv_order_items", {
  id: uuid("id").primaryKey(),
  orderId: uuid("order_id").notNull(),
  productName: text("product_name").notNull(),
  sku: text("sku"),
  quantity: integer("quantity").notNull(),
  unitAmountCents: integer("unit_amount_cents").notNull(),
});

export const nvCustomerAssets = pgTable("nv_customer_assets", {
  id: uuid("id").primaryKey(),
  customerId: uuid("customer_id"),
  orderId: uuid("order_id"),
  /** worksheet | webinar | zoom | deck | infographic */
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  url: text("url"),
  releasedAt: timestamp("released_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
});

export const nvPortalGrants = pgTable("nv_portal_grants", {
  token: text("token").primaryKey(),
  customerId: uuid("customer_id").notNull(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
});

/**
 * LinkedIn content scheduler. See drizzle/nv_linkedin.sql for the DDL and the
 * reasoning; src/linkedin/statuses.ts owns the status vocabulary.
 */
export const nvLinkedinPosts = pgTable("nv_linkedin_posts", {
  id: uuid("id").primaryKey(),
  /**
   * draft | pending_approval | needs_changes | approved | published | failed.
   * Text rather than pgEnum, like every other status in this schema.
   */
  status: text("status").notNull(),
  /** Internal label for the calendar. Never published. */
  title: text("title"),
  body: text("body").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "date" }),
  /** The wall clock `scheduledAt` was chosen in — see the SQL file. */
  timezone: text("timezone").notNull(),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
  shareToken: text("share_token"),
  /** Pasted in after publishing by hand. */
  linkedinPostUrl: text("linkedin_post_url"),
  /** Written by the auto-publisher. Its presence means "we really posted it". */
  linkedinPostUrn: text("linkedin_post_urn"),
  publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
  publishError: text("publish_error"),
  publishAttempts: integer("publish_attempts").notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
});

export const nvLinkedinPostMedia = pgTable("nv_linkedin_post_media", {
  id: uuid("id").primaryKey(),
  postId: uuid("post_id").notNull(),
  /** image | video */
  kind: text("kind").notNull(),
  fileName: text("file_name").notNull(),
  url: text("url").notNull(),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes"),
  sortOrder: integer("sort_order").notNull(),
  linkedinAssetUrn: text("linkedin_asset_urn"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
});

export const nvLinkedinEvents = pgTable("nv_linkedin_events", {
  id: uuid("id").primaryKey(),
  postId: uuid("post_id").notNull(),
  author: text("author"),
  /** comment | change_request | approval | system */
  kind: text("kind").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }),
});
