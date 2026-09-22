-- Work streams: the "Project" a card belongs to, as distinct from the board it
-- sits on. Two different things wearing the same word — the board is
-- `project`, this is the stream a card is tagged with, and a stream spans
-- boards within a workspace.
--
-- Additive: the column is nullable and every existing card keeps a NULL, which
-- renders as no chip. Nothing has to be backfilled.
CREATE TABLE "task_project" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "task_project_id" text;--> statement-breakpoint
ALTER TABLE "task_project" ADD CONSTRAINT "task_project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "task_project_workspace_id_idx" ON "task_project" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_project_workspace_name_unique" ON "task_project" USING btree ("workspace_id","name");--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_task_project_id_task_project_id_fk" FOREIGN KEY ("task_project_id") REFERENCES "public"."task_project"("id") ON DELETE set null ON UPDATE cascade;
