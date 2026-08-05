-- Card-level public sharing. Additive only: a nullable column plus a unique
-- index, so existing rows and the running app are unaffected.
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "public_share_id" text;
ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "public_shared_at" timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS "task_public_share_id_uidx"
  ON "task" ("public_share_id") WHERE "public_share_id" IS NOT NULL;
