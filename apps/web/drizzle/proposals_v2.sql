-- Proposal v2 (June 18 meeting) — additive columns. Idempotent.
-- Apply:  bun run db:apply drizzle/proposals_v2.sql
-- (proposal tables are in drizzle/schema.ts, but db:migrate is out-of-sync and
--  db:generate gets polluted with unrelated crm_Leads drift, so apply by hand.)

-- crm_Proposals: client details, presentation/media, payment method + fee
ALTER TABLE "crm_Proposals" ADD COLUMN IF NOT EXISTS "clientEmail" text;
ALTER TABLE "crm_Proposals" ADD COLUMN IF NOT EXISTS "clientAddress" text;
ALTER TABLE "crm_Proposals" ADD COLUMN IF NOT EXISTS "theme" text DEFAULT 'creative';
ALTER TABLE "crm_Proposals" ADD COLUMN IF NOT EXISTS "videoUrl" text;
ALTER TABLE "crm_Proposals" ADD COLUMN IF NOT EXISTS "scheduleCallUrl" text;
ALTER TABLE "crm_Proposals" ADD COLUMN IF NOT EXISTS "paymentMethod" text;
ALTER TABLE "crm_Proposals" ADD COLUMN IF NOT EXISTS "processingFee" numeric(14,2) DEFAULT '0' NOT NULL;
ALTER TABLE "crm_Proposals" ADD COLUMN IF NOT EXISTS "paypalCaptureId" text;

-- crm_Proposal_Assets: categorized interactive portfolio
ALTER TABLE "crm_Proposal_Assets" ADD COLUMN IF NOT EXISTS "category" text DEFAULT 'GENERAL' NOT NULL;
ALTER TABLE "crm_Proposal_Assets" ADD COLUMN IF NOT EXISTS "featured" boolean DEFAULT false NOT NULL;
ALTER TABLE "crm_Proposal_Assets" ADD COLUMN IF NOT EXISTS "externalUrl" text;

-- Proposal_Settings: direct-transfer bank details, scheduling, Stripe fee %
ALTER TABLE "Proposal_Settings" ADD COLUMN IF NOT EXISTS "bankName" text;
ALTER TABLE "Proposal_Settings" ADD COLUMN IF NOT EXISTS "bankAccountName" text;
ALTER TABLE "Proposal_Settings" ADD COLUMN IF NOT EXISTS "bankAccountNumber" text;
ALTER TABLE "Proposal_Settings" ADD COLUMN IF NOT EXISTS "bankIban" text;
ALTER TABLE "Proposal_Settings" ADD COLUMN IF NOT EXISTS "bankSwift" text;
ALTER TABLE "Proposal_Settings" ADD COLUMN IF NOT EXISTS "bankRouting" text;
ALTER TABLE "Proposal_Settings" ADD COLUMN IF NOT EXISTS "bankInstructions" text;
ALTER TABLE "Proposal_Settings" ADD COLUMN IF NOT EXISTS "scheduleCallUrl" text;
ALTER TABLE "Proposal_Settings" ADD COLUMN IF NOT EXISTS "stripeFeePercent" numeric(5,2) DEFAULT '3.5';
