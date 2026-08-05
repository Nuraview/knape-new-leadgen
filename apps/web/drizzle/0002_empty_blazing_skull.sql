CREATE TABLE "scrape_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tick_id" text NOT NULL,
	"query" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"jobs_expected" integer,
	"jobs_found" integer,
	"jobs_inserted" integer,
	"jobs_updated" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "scraper_heartbeat" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cookies_count" integer,
	"cookies_present" boolean,
	"cookies_min_expiry" timestamp with time zone,
	"cookies_hard_expired" boolean,
	"cookies_working" boolean,
	"cookies_signal" text,
	"cookies_client_info_rate" numeric(5, 4),
	"scraper_healthy" boolean,
	"scraper_version" text,
	"gemini_enabled" boolean,
	"keywords" jsonb,
	"current_keyword" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "whatsapp_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text,
	"direction" text NOT NULL,
	"jid" text NOT NULL,
	"pushname" text,
	"body" text,
	"has_media" boolean DEFAULT false NOT NULL,
	"wa_timestamp" bigint,
	"lead_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_jid" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"message_id" text,
	"error" text,
	"enqueued_by" text,
	"lead_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempted_at" timestamp with time zone,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whatsapp_session" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"connected" boolean,
	"jid" text,
	"last_seen_at" timestamp with time zone,
	"qr_data_url" text,
	"qr_issued_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "scrape_runs_started_at_idx" ON "scrape_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scrape_runs_status_started_idx" ON "scrape_runs" USING btree ("status","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scrape_runs_query_started_idx" ON "scrape_runs" USING btree ("query","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "whatsapp_message_jid_idx" ON "whatsapp_message" USING btree ("jid","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "whatsapp_message_lead_idx" ON "whatsapp_message" USING btree ("lead_id") WHERE lead_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "whatsapp_outbox_pending_idx" ON "whatsapp_outbox" USING btree ("created_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "whatsapp_outbox_lead_idx" ON "whatsapp_outbox" USING btree ("lead_id") WHERE lead_id IS NOT NULL;