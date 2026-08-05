-- Align dialer unique-constraint NAMES to drizzle ORM's convention
-- (<table>_<column>_unique). The DB created them inline as <table>_<column>_key
-- (Postgres default), so drizzle-kit push kept wanting to add _unique-named
-- duplicates. These are metadata-only renames — no data touched, uniqueness
-- still enforced throughout.

-- sms_messages already has the _unique (added in 0018); drop the redundant _key.
ALTER TABLE "dialer_sms_messages" DROP CONSTRAINT "dialer_sms_messages_message_sid_key";

ALTER TABLE "dialer_calls" RENAME CONSTRAINT "dialer_calls_call_sid_key" TO "dialer_calls_call_sid_unique";
ALTER TABLE "dialer_client_sessions" RENAME CONSTRAINT "dialer_client_sessions_identity_key" TO "dialer_client_sessions_identity_unique";
ALTER TABLE "dialer_contacts" RENAME CONSTRAINT "dialer_contacts_phone_key" TO "dialer_contacts_phone_unique";
ALTER TABLE "dialer_push_subscriptions" RENAME CONSTRAINT "dialer_push_subscriptions_endpoint_key" TO "dialer_push_subscriptions_endpoint_unique";
