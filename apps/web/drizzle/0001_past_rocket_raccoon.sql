ALTER TABLE "crm_Contacts" DROP CONSTRAINT "crm_Contacts_created_by_fkey";
--> statement-breakpoint
ALTER TABLE "crm_Opportunities" DROP CONSTRAINT "crm_Opportunities_created_by_fkey";
--> statement-breakpoint
DROP INDEX "crm_Contacts_created_by_idx";--> statement-breakpoint
DROP INDEX "crm_Opportunities_created_by_idx";--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "upwork_job_url" text;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "upwork_job_id" text;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "extracted_at" timestamp(3);--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "source_payload" jsonb;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "highlighted_at" timestamp(3);--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "highlighted_by" uuid;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "last_contacted_at" timestamp(3);--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "last_contacted_by" uuid;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "reminder_at" timestamp(3);--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "reminder_sent_at" timestamp(3);--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "reminder_note" text;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "has_client_info" boolean;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "posted_at" timestamp(3);--> statement-breakpoint
ALTER TABLE "crm_Contacts" ADD CONSTRAINT "crm_Contacts_created_by_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Opportunities" ADD CONSTRAINT "crm_Opportunities_created_by_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "crm_Contacts_created_by_idx" ON "crm_Contacts" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Opportunities_created_by_idx" ON "crm_Opportunities" USING btree ("createdBy" uuid_ops);