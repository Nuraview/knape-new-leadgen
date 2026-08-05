-- LinkedIn content scheduler.
--
-- We draft posts ahead of time — primary text plus creatives — and Dan reviews
-- each one in the CRM against a feed-accurate preview, then approves it or asks
-- for a change. Approved posts go out at their scheduled time: by hand today
-- (the live URL comes back into `linkedin_post_url`), automatically once a
-- LinkedIn account is connected (`linkedin_post_urn`).
--
-- Lives in the CRM database (CRM_DATABASE_URL) beside nv_orders rather than in
-- the app database, for the same reason those do: it is client business
-- data, and the app DB is workspace-scoped in a way this instance barely uses.
--
-- Applied with `bun run --filter @nuraview/api db:crm-apply`. The CRM schema is
-- introspected rather than migrated (see crm-schema.ts), so it gets plain SQL
-- instead of a Drizzle migration — every statement is IF NOT EXISTS so the file
-- is safe to re-run.

CREATE TABLE IF NOT EXISTS "nv_linkedin_posts" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- draft | pending_approval | needs_changes | approved | published | failed.
  -- Text, not an enum, matching the rest of this schema: re-declaring a pgEnum
  -- invites drizzle-kit to propose creating a type that already exists. The
  -- vocabulary and the legal transitions live in src/linkedin/statuses.ts.
  "status"        text NOT NULL DEFAULT 'draft',
  -- Ours, not LinkedIn's. Names the post in the calendar; never published.
  "title"         text,
  -- The post exactly as it will read in the feed. LinkedIn caps this at 3,000
  -- characters and so do we, on the way in.
  "body"          text NOT NULL,
  -- When it goes out, as an absolute instant, plus the wall clock that instant
  -- was chosen in. Both are needed: the instant is what the publisher compares
  -- against, and the zone is what "9am" meant, which is what has to survive
  -- when the post is dragged to another day across a DST boundary.
  "scheduled_at"  timestamptz,
  "timezone"      text NOT NULL DEFAULT 'America/New_York',
  "approved_by"   text,
  "approved_at"   timestamptz,
  -- Capability for the public preview link. Nullable, revocable, and unique
  -- only where present — hence the partial index rather than a UNIQUE column.
  "share_token"   text,
  -- Two different facts, deliberately two columns: a URL pasted in by whoever
  -- published by hand, and the URN LinkedIn returns when we published it
  -- ourselves. Keeping them apart is what makes "was this automatic?"
  -- answerable, which decides whether un-publishing here is honest.
  "linkedin_post_url" text,
  "linkedin_post_urn" text,
  "published_at"  timestamptz,
  "publish_error" text,
  "publish_attempts" integer NOT NULL DEFAULT 0,
  "created_by"    text,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  -- Soft delete: a post that was reviewed and discussed should not take its
  -- timeline with it.
  "deleted_at"    timestamptz
);

-- The due-work query: status='approved' AND scheduled_at <= now().
CREATE INDEX IF NOT EXISTS "nv_linkedin_posts_due_idx"
  ON "nv_linkedin_posts" ("status", "scheduled_at");
-- The calendar window query.
CREATE INDEX IF NOT EXISTS "nv_linkedin_posts_scheduled_idx"
  ON "nv_linkedin_posts" ("scheduled_at");
CREATE UNIQUE INDEX IF NOT EXISTS "nv_linkedin_posts_share_idx"
  ON "nv_linkedin_posts" ("share_token")
  WHERE "share_token" IS NOT NULL;

-- Creatives. The bytes live in object storage; this row is the record of what
-- was attached, in what order, so the feed preview can tile them the way
-- LinkedIn will.
CREATE TABLE IF NOT EXISTS "nv_linkedin_post_media" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "post_id"      uuid NOT NULL REFERENCES "nv_linkedin_posts"("id") ON DELETE CASCADE,
  -- image | video. LinkedIn allows many images or one video, never both.
  "kind"         text NOT NULL DEFAULT 'image',
  "file_name"    text NOT NULL,
  "url"          text NOT NULL,
  "content_type" text,
  "size_bytes"   integer,
  "sort_order"   integer NOT NULL DEFAULT 0,
  -- Set by the auto-publisher once the asset has been uploaded to LinkedIn.
  "linkedin_asset_urn" text,
  "created_at"   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "nv_linkedin_post_media_post_idx"
  ON "nv_linkedin_post_media" ("post_id", "sort_order");

-- The review trail: comments, change requests and approvals in one ordered
-- list, because the useful question is "what happened to this post", not "what
-- happened to it of each separate kind".
CREATE TABLE IF NOT EXISTS "nv_linkedin_events" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "post_id"    uuid NOT NULL REFERENCES "nv_linkedin_posts"("id") ON DELETE CASCADE,
  "author"     text,
  -- comment | change_request | approval | system
  "kind"       text NOT NULL DEFAULT 'comment',
  "body"       text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "nv_linkedin_events_post_idx"
  ON "nv_linkedin_events" ("post_id", "created_at");
