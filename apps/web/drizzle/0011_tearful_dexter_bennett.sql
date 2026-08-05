CREATE TABLE "crm_Activity_Events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"lead_id" uuid,
	"created_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_Activity_Events" ADD CONSTRAINT "crm_Activity_Events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."Users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Activity_Events" ADD CONSTRAINT "crm_Activity_Events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_Leads"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "crm_Activity_Events_user_id_created_at_idx" ON "crm_Activity_Events" USING btree ("user_id" uuid_ops,"created_at" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Activity_Events_type_created_at_idx" ON "crm_Activity_Events" USING btree ("type" text_ops,"created_at" timestamp_ops);