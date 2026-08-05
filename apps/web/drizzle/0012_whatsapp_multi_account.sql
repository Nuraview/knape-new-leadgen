-- Multi-account WhatsApp.
--
-- whatsapp_session was a hard singleton (id = 1, CHECK enforced). Convert it
-- into one row per paired account, keyed by a stable `account` slug
-- ('primary', 'secondary', …). The existing paired number becomes 'primary'
-- — the ADD COLUMN ... DEFAULT 'primary' backfills the existing row, so its
-- Baileys auth creds and pairing stay valid with NO re-scan.
ALTER TABLE "whatsapp_session" DROP CONSTRAINT IF EXISTS "whatsapp_session_id_check";--> statement-breakpoint
ALTER TABLE "whatsapp_session" DROP CONSTRAINT IF EXISTS "whatsapp_session_pkey";--> statement-breakpoint
ALTER TABLE "whatsapp_session" ADD COLUMN "account" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_session" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "whatsapp_session" ADD CONSTRAINT "whatsapp_session_pkey" PRIMARY KEY ("account");--> statement-breakpoint
ALTER TABLE "whatsapp_session" DROP COLUMN "id";--> statement-breakpoint
-- crm_Leads: which paired account a lead's reminder sends from (NULL = primary).
ALTER TABLE "crm_Leads" ADD COLUMN "reminder_account" text;--> statement-breakpoint
-- whatsapp_outbox: which account must send each queued message. Default keeps
-- existing rows + callers that don't specify an account working unchanged.
ALTER TABLE "whatsapp_outbox" ADD COLUMN "account" text DEFAULT 'primary' NOT NULL;--> statement-breakpoint
CREATE INDEX "whatsapp_outbox_account_pending_idx" ON "whatsapp_outbox" USING btree ("account","created_at") WHERE status = 'pending';
