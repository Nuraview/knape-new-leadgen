CREATE TABLE "scraper_cookies" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" uuid,
	"cookies" jsonb NOT NULL,
	CONSTRAINT "scraper_cookies_id_check" CHECK ("scraper_cookies"."id" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "crm_Leads_upwork_job_url_unique" ON "crm_Leads" USING btree ("upwork_job_url") WHERE upwork_job_url IS NOT NULL;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_status_check" CHECK ("scrape_runs"."status" IN ('running', 'completed', 'failed', 'skipped'));--> statement-breakpoint
ALTER TABLE "scraper_heartbeat" ADD CONSTRAINT "scraper_heartbeat_id_check" CHECK ("scraper_heartbeat"."id" = 1);--> statement-breakpoint
ALTER TABLE "whatsapp_message" ADD CONSTRAINT "whatsapp_message_direction_check" CHECK ("whatsapp_message"."direction" IN ('in', 'out'));--> statement-breakpoint
ALTER TABLE "whatsapp_outbox" ADD CONSTRAINT "whatsapp_outbox_status_check" CHECK ("whatsapp_outbox"."status" IN ('pending', 'sending', 'sent', 'failed'));--> statement-breakpoint
ALTER TABLE "whatsapp_session" ADD CONSTRAINT "whatsapp_session_id_check" CHECK ("whatsapp_session"."id" = 1);