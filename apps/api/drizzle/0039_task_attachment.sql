-- Task attachments as a real structure.
--
-- The Trello import previously appended files to the task DESCRIPTION as a
-- markdown list, alongside the checklist, alongside the card's own body. Three
-- distinct things flattened into one field, which is exactly why an imported
-- card reads as a wall of text next to the Trello original — Trello renders
-- attachments as their own panel with file-type icons, size and date.
--
-- `storage_key` is the MinIO object key; `source_url` keeps the original
-- Trello link so provenance survives even for files we could not mirror.
CREATE TABLE IF NOT EXISTS "task_attachment" (
  "id"           text PRIMARY KEY NOT NULL,
  "task_id"      text NOT NULL REFERENCES "task"("id") ON DELETE CASCADE,
  "name"         text NOT NULL,
  "storage_key"  text,
  "source_url"   text,
  "content_type" text,
  "bytes"        integer,
  "uploaded_by"  text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"   timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "task_attachment_task_idx"
  ON "task_attachment" ("task_id");
