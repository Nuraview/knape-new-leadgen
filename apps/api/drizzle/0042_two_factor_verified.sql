-- better-auth's twoFactor plugin needs a `verified` flag on the two_factor row.
--
-- Missing it does not fail at startup or typecheck — enrolment simply 500s with
-- "The field verified does not exist in the twoFactor Drizzle schema", which is
-- only visible in the API log. The plugin's expected shape is
-- (id, secret, backup_codes, user_id, verified); 0040 shipped the first four.
--
-- Defaults false: a row exists from the moment enrolment STARTS, and the secret
-- must not count as active until a code from the authenticator has been
-- checked. Enabling on creation is how someone locks themselves out with a QR
-- they never successfully scanned.
ALTER TABLE "two_factor"
  ADD COLUMN IF NOT EXISTS "verified" boolean NOT NULL DEFAULT false;
