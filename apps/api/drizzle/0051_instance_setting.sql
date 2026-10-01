-- Instance-wide settings, one JSON value per key. The first users are the mail
-- server that @mention emails go out through ("smtp") and the address their
-- "Open task" button links to ("app_url"). Additive: a new, empty table.
CREATE TABLE "instance_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
