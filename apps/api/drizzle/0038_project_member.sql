-- Per-project assignment (client meeting 2026-07-28).
--
-- VK: "you should only be able to access this, like the one which says Javed.
-- The moment he logs in, he should just get this... At all times he will have
-- one board. That's it."
--
-- Until now workspace membership implied access to EVERY board, so Javed could
-- see Habib's work and vice versa. This table is the allow-list.
--
-- Admins and owners are deliberately NOT listed here: they see everything by
-- role, so an empty table means "nobody is restricted yet" rather than "nobody
-- can see anything", and adding the first row cannot accidentally lock the
-- owner out of their own workspace.
CREATE TABLE IF NOT EXISTS "project_member" (
  "id"         text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "project"("id") ON DELETE CASCADE,
  "user_id"    text NOT NULL REFERENCES "user"("id")    ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- One row per pairing; re-assigning is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "project_member_unique_idx"
  ON "project_member" ("project_id", "user_id");

-- The hot query is "which projects may this user see".
CREATE INDEX IF NOT EXISTS "project_member_user_idx"
  ON "project_member" ("user_id");
