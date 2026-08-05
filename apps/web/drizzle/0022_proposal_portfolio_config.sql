-- Editable portfolio titles + CTA link box, stored as one JSONB blob.
ALTER TABLE "crm_Proposals" ADD COLUMN IF NOT EXISTS "portfolioConfig" jsonb;
