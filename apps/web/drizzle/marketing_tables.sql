-- NuraView Marketer tables, migrated into nextcrm's Neon database.
--
-- Idempotent + additive: safe to run multiple times, touches only mkt_* objects.
-- Apply out-of-band (NOT via drizzle-kit, to keep it off the migration journal):
--   psql "$DATABASE_URL_UNPOOLED" -f drizzle/marketing_tables.sql
--
-- Matches drizzle/marketing-schema.ts.

-- ── Enums (guarded; CREATE TYPE has no IF NOT EXISTS) ──────────────
DO $$ BEGIN
  CREATE TYPE "mkt_email_status" AS ENUM
    ('draft','queued','sent','delivered','opened','clicked','bounced','complained','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "mkt_sequence_status" AS ENUM ('active','cancelled','complete','paused');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "mkt_sequence_item_status" AS ENUM
    ('pending','scheduled','sent','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tables ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "mkt_users" (
  "id" serial PRIMARY KEY NOT NULL,
  "first_name" varchar(50),
  "last_name" varchar(50),
  "email" varchar(255) NOT NULL,
  "job_title" varchar(100),
  "company" varchar(100),
  "location" varchar(100),
  "twitter" varchar(100),
  "linkedin" varchar(100),
  "github" varchar(100),
  "avatar_url" varchar(255)
);
CREATE UNIQUE INDEX IF NOT EXISTS "mkt_email_idx" ON "mkt_users" ("email");

CREATE TABLE IF NOT EXISTS "mkt_threads" (
  "id" serial PRIMARY KEY NOT NULL,
  "subject" varchar(255),
  "last_activity_date" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "mkt_emails" (
  "id" serial PRIMARY KEY NOT NULL,
  "thread_id" integer REFERENCES "mkt_threads"("id"),
  "sender_id" integer REFERENCES "mkt_users"("id"),
  "recipient_id" integer REFERENCES "mkt_users"("id"),
  "subject" varchar(255),
  "body" text,
  "body_html" text,
  "sent_date" timestamp DEFAULT now(),
  "resend_id" varchar(255),
  "status" "mkt_email_status" DEFAULT 'draft',
  "delivered_at" timestamp,
  "opened_at" timestamp,
  "clicked_at" timestamp,
  "bounced_at" timestamp,
  "opened_count" integer DEFAULT 0,
  "clicked_count" integer DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "mkt_thread_id_idx" ON "mkt_emails" ("thread_id");
CREATE INDEX IF NOT EXISTS "mkt_sender_id_idx" ON "mkt_emails" ("sender_id");
CREATE INDEX IF NOT EXISTS "mkt_recipient_id_idx" ON "mkt_emails" ("recipient_id");
CREATE INDEX IF NOT EXISTS "mkt_sent_date_idx" ON "mkt_emails" ("sent_date");
CREATE INDEX IF NOT EXISTS "mkt_resend_id_idx" ON "mkt_emails" ("resend_id");
CREATE INDEX IF NOT EXISTS "mkt_status_idx" ON "mkt_emails" ("status");

CREATE TABLE IF NOT EXISTS "mkt_folders" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS "mkt_user_folders" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer REFERENCES "mkt_users"("id"),
  "folder_id" integer REFERENCES "mkt_folders"("id")
);

CREATE TABLE IF NOT EXISTS "mkt_thread_folders" (
  "id" serial PRIMARY KEY NOT NULL,
  "thread_id" integer REFERENCES "mkt_threads"("id"),
  "folder_id" integer REFERENCES "mkt_folders"("id")
);

CREATE TABLE IF NOT EXISTS "mkt_email_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "resend_id" varchar(255) NOT NULL,
  "email_id" integer REFERENCES "mkt_emails"("id"),
  "event_type" varchar(50) NOT NULL,
  "payload" jsonb,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "mkt_event_resend_id_idx" ON "mkt_email_events" ("resend_id");
CREATE INDEX IF NOT EXISTS "mkt_event_email_id_idx" ON "mkt_email_events" ("email_id");
CREATE INDEX IF NOT EXISTS "mkt_event_type_idx" ON "mkt_email_events" ("event_type");

CREATE TABLE IF NOT EXISTS "mkt_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(100) NOT NULL,
  "subject" varchar(255),
  "body_html" text,
  "body_text" text,
  "variables" jsonb,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "mkt_contacts" (
  "id" serial PRIMARY KEY NOT NULL,
  "first_name" varchar(100),
  "last_name" varchar(100),
  "email" varchar(255) NOT NULL,
  "company" varchar(100),
  "tags" jsonb,
  "last_engagement" timestamp,
  "created_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "mkt_contact_email_idx" ON "mkt_contacts" ("email");

CREATE TABLE IF NOT EXISTS "mkt_sequences" (
  "id" serial PRIMARY KEY NOT NULL,
  "campaign" varchar(255),
  "initiator_user_id" integer REFERENCES "mkt_users"("id"),
  "status" "mkt_sequence_status" DEFAULT 'active',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "mkt_sequence_status_idx" ON "mkt_sequences" ("status");
CREATE INDEX IF NOT EXISTS "mkt_sequence_created_at_idx" ON "mkt_sequences" ("created_at");

CREATE TABLE IF NOT EXISTS "mkt_sequence_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "sequence_id" integer REFERENCES "mkt_sequences"("id"),
  "contact_email" varchar(255) NOT NULL,
  "step_number" integer NOT NULL,
  "subject" varchar(255),
  "body" text,
  "body_html" text,
  "scheduled_at" timestamp NOT NULL,
  "sent_at" timestamp,
  "status" "mkt_sequence_item_status" DEFAULT 'pending',
  "resend_id" varchar(255),
  "message_id_header" varchar(255),
  "parent_message_id" varchar(255),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "mkt_sequence_item_sequence_id_idx" ON "mkt_sequence_items" ("sequence_id");
CREATE INDEX IF NOT EXISTS "mkt_sequence_item_email_idx" ON "mkt_sequence_items" ("contact_email");
CREATE INDEX IF NOT EXISTS "mkt_sequence_item_scheduled_idx" ON "mkt_sequence_items" ("scheduled_at");
CREATE INDEX IF NOT EXISTS "mkt_sequence_item_status_idx" ON "mkt_sequence_items" ("status");

CREATE TABLE IF NOT EXISTS "mkt_sequence_exclusions" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" varchar(255) NOT NULL,
  "reason" text,
  "added_by" integer REFERENCES "mkt_users"("id"),
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "mkt_exclusion_email_idx" ON "mkt_sequence_exclusions" ("email");

CREATE TABLE IF NOT EXISTS "mkt_sequence_job_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "sequence_item_id" integer REFERENCES "mkt_sequence_items"("id"),
  "event" varchar(50) NOT NULL,
  "message" text,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "mkt_job_log_sequence_item_idx" ON "mkt_sequence_job_logs" ("sequence_item_id");
CREATE INDEX IF NOT EXISTS "mkt_job_log_created_at_idx" ON "mkt_sequence_job_logs" ("created_at");

-- Seed the default folders the Marketer UI expects.
INSERT INTO "mkt_folders" ("name")
SELECT v FROM (VALUES ('Inbox'),('Sent'),('Flagged'),('Archive'),('Trash')) AS t(v)
WHERE NOT EXISTS (SELECT 1 FROM "mkt_folders" WHERE "mkt_folders"."name" = t.v);
