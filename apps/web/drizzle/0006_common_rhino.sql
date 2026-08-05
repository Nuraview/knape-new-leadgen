CREATE TABLE "crm_Lead_Views" (
	"lead_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"viewed_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "crm_Lead_Views_pkey" PRIMARY KEY("lead_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "crm_Lead_Views" ADD CONSTRAINT "crm_Lead_Views_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_Leads"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Lead_Views" ADD CONSTRAINT "crm_Lead_Views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."Users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "crm_Lead_Views_user_id_viewed_at_idx" ON "crm_Lead_Views" USING btree ("user_id" uuid_ops,"viewed_at" timestamp_ops);