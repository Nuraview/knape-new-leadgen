-- Track how many times a proposal's public page is opened.
ALTER TABLE "crm_Proposals" ADD COLUMN IF NOT EXISTS "viewCount" integer NOT NULL DEFAULT 0;
