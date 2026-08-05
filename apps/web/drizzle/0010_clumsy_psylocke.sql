CREATE TABLE "crm_Lead_Enrichment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"leadId" uuid NOT NULL,
	"status" "crm_Enrichment_Status" DEFAULT 'PENDING' NOT NULL,
	"mode" text,
	"fields" text[],
	"result" jsonb,
	"cost_usd" numeric(10, 4) DEFAULT '0',
	"error" text,
	"triggeredBy" uuid,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "enrichment_status" "crm_Enrichment_Status";--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD COLUMN "enriched_at" timestamp(3);--> statement-breakpoint
ALTER TABLE "crm_Lead_Enrichment" ADD CONSTRAINT "crm_Lead_Enrichment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "public"."crm_Leads"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Lead_Enrichment" ADD CONSTRAINT "crm_Lead_Enrichment_triggeredBy_fkey" FOREIGN KEY ("triggeredBy") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "crm_Lead_Enrichment_leadId_idx" ON "crm_Lead_Enrichment" USING btree ("leadId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Lead_Enrichment_createdAt_idx" ON "crm_Lead_Enrichment" USING btree ("createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Lead_Enrichment_status_idx" ON "crm_Lead_Enrichment" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "crm_Lead_Enrichment_triggeredBy_idx" ON "crm_Lead_Enrichment" USING btree ("triggeredBy" uuid_ops);