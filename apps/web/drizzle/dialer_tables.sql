-- NuraView Dialer (Twilio voice + SMS) tables, migrated into nextcrm's Neon database.
--
-- Idempotent + additive: safe to run multiple times, touches only dialer_*
-- objects (plus one functional index on crm_Leads for phone lookup).
-- Apply out-of-band (NOT via drizzle-kit, to keep it off the migration journal):
--   psql "$DATABASE_URL_UNPOOLED" -f drizzle/dialer_tables.sql
--
-- Matches drizzle/dialer-schema.ts.

-- ── Enums (guarded; CREATE TYPE has no IF NOT EXISTS) ──────────────
DO $$ BEGIN
  CREATE TYPE "dialer_call_status" AS ENUM
    ('initiated','ringing','in-progress','completed','busy','no-answer','failed','canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "dialer_call_direction" AS ENUM ('inbound','outbound-api','outbound-dial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "dialer_message_direction" AS ENUM ('inbound','outbound');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "dialer_message_type" AS ENUM ('sms','whatsapp');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tables ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "dialer_contacts" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "phone" text NOT NULL UNIQUE,
  "email" text,
  "requirement_tag" text,
  "sms_enabled" boolean DEFAULT true,
  "whatsapp_enabled" boolean DEFAULT false,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "dialer_contacts_name_idx" ON "dialer_contacts" ("name");

CREATE TABLE IF NOT EXISTS "dialer_calls" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" uuid REFERENCES "crm_Leads"("id") ON DELETE SET NULL,
  "phone_number" text NOT NULL,
  "call_sid" text NOT NULL UNIQUE,
  "status" "dialer_call_status" NOT NULL,
  "direction" "dialer_call_direction" NOT NULL,
  "duration" integer,
  "agent_identity" text,
  "activity_id" uuid REFERENCES "crm_Activities"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "dialer_calls_lead_id_idx" ON "dialer_calls" ("lead_id");
CREATE INDEX IF NOT EXISTS "dialer_calls_created_at_idx" ON "dialer_calls" ("created_at");
CREATE INDEX IF NOT EXISTS "dialer_calls_phone_idx" ON "dialer_calls" ("phone_number");
CREATE INDEX IF NOT EXISTS "dialer_calls_agent_status_idx" ON "dialer_calls" ("agent_identity", "status");

CREATE TABLE IF NOT EXISTS "dialer_message_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "message_body" text NOT NULL,
  "message_type" "dialer_message_type" NOT NULL DEFAULT 'sms',
  "is_active" boolean DEFAULT true,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "dialer_sms_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "lead_id" uuid REFERENCES "crm_Leads"("id") ON DELETE SET NULL,
  "phone_number" text NOT NULL,
  "message_sid" text NOT NULL UNIQUE,
  "message_body" text NOT NULL,
  "message_status" text NOT NULL,
  "direction" "dialer_message_direction" NOT NULL,
  "message_type" "dialer_message_type" NOT NULL DEFAULT 'sms',
  "call_id" integer REFERENCES "dialer_calls"("id"),
  "template_id" integer REFERENCES "dialer_message_templates"("id"),
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "dialer_sms_lead_created_idx" ON "dialer_sms_messages" ("lead_id", "created_at");
CREATE INDEX IF NOT EXISTS "dialer_sms_phone_idx" ON "dialer_sms_messages" ("phone_number");

CREATE TABLE IF NOT EXISTS "dialer_client_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "identity" text NOT NULL UNIQUE,
  "user_id" uuid REFERENCES "Users"("id") ON DELETE CASCADE,
  "last_heartbeat" timestamptz NOT NULL DEFAULT now(),
  "user_agent" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "dialer_push_subscriptions" (
  "id" serial PRIMARY KEY NOT NULL,
  "endpoint" text NOT NULL UNIQUE,
  "p256dh_key" text NOT NULL,
  "auth_key" text NOT NULL,
  "user_id" uuid REFERENCES "Users"("id") ON DELETE CASCADE,
  "user_agent" text,
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

-- ── Phone lookup index on leads (digit-normalized suffix match) ────
CREATE INDEX IF NOT EXISTS "crm_Leads_phone_digits_idx"
  ON "crm_Leads" (regexp_replace(coalesce("phone", ''), '\D', '', 'g'));
