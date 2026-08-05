ALTER TABLE "crm_Leads" ADD COLUMN "irrelevant_at" timestamp(3);--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "irrelevant_by" uuid;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "irrelevant_reason" text;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD CONSTRAINT "crm_Leads_irrelevant_by_fkey" FOREIGN KEY ("irrelevant_by") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "crm_Leads_irrelevant_at_idx" ON "crm_Leads" USING btree ("irrelevant_at" timestamp_ops) WHERE irrelevant_at IS NOT NULL;