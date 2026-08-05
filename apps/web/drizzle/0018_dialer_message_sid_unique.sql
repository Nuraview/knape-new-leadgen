-- Align DB to dialer-schema.ts: message_sid (Twilio SID) must be unique.
-- Verified 0 duplicate non-null values before applying. Postgres allows
-- multiple NULLs under UNIQUE, so nullable rows are unaffected.
ALTER TABLE "dialer_sms_messages"
  ADD CONSTRAINT "dialer_sms_messages_message_sid_unique" UNIQUE ("message_sid");
