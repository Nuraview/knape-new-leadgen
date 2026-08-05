-- The REST of better-auth's twoFactor schema, in one go.
--
-- Authority is node_modules/better-auth/dist/plugins/two-factor/schema.d.mts,
-- which declares six fields: secret, backupCodes, userId, verified,
-- failedVerificationCount, lockedUntil. 0040 shipped four, 0042 added verified,
-- and enrolment still 500'd on the next missing one.
--
-- Adding a column per failed deploy is what wasted an evening: none of these
-- fail typecheck or startup, they only surface as a 500 and one line in the
-- API log. Reading the plugin's own schema takes a minute and ends it.
--
-- failed_verification_count backs the lockout counter; locked_until is when the
-- lock expires. Both are plugin-managed — nothing in this app writes them.
ALTER TABLE "two_factor"
  ADD COLUMN IF NOT EXISTS "failed_verification_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "two_factor"
  ADD COLUMN IF NOT EXISTS "locked_until" timestamp;
