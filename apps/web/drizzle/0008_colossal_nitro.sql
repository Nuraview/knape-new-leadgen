ALTER TABLE "crm_Leads" ADD COLUMN "reminder_first_sent_at" timestamp(3);--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "reminder_followup_pending" boolean DEFAULT false NOT NULL;