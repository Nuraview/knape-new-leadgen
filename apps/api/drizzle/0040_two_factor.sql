-- Two-factor authentication (TOTP) and forced password rotation.
--
-- VK 2026-07-28: "for the admin access I would like a 2FA to be added over
-- there... let me use authenticator app", and "only for me, not for everyone".
-- So this is capability, not policy: the tables exist for every user, but only
-- accounts that actually enrol get challenged.
--
-- `two_factor` is better-auth's schema for its twoFactor plugin — the column
-- names are dictated by the plugin, not chosen here.
CREATE TABLE IF NOT EXISTS "two_factor" (
  "id"            text PRIMARY KEY NOT NULL,
  "secret"        text NOT NULL,
  "backup_codes"  text NOT NULL,
  "user_id"       text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "two_factor_user_idx" ON "two_factor" ("user_id");

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false;

-- Forced rotation. Set when an operator provisions or resets an account with a
-- temporary password: the holder must choose their own before they can use the
-- app, so the temporary one never becomes the real one and whoever issued it
-- never learns the replacement.
ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false;
