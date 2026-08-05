-- Per-lead Cap video share link (Loom replacement): recorded from the lead
-- card/drawer, embedded as a GIF thumbnail card in outreach emails.
ALTER TABLE "crm_Leads" ADD COLUMN IF NOT EXISTS "video_link" text;
