-- Per-user access now covers two independent areas, not just the CRM:
--
--   level               none | leads_kanban | full   (lead pipeline)
--   can_access_projects boolean                      (project boards / PM)
--
-- A lead-gen employee needs the leads kanban and nothing else — no project
-- boards, no workspace member list, no invitations. Those are separate products
-- inside one app, so one flag cannot express both.
--
-- Renamed from crm_access because the table is no longer CRM-specific. It was
-- created hours ago and holds a handful of rows, so the rename is cheap now and
-- avoids a permanently misleading name.
ALTER TABLE "crm_access" RENAME TO "user_access";

-- Defaults to true so every existing account keeps project access, including
-- the projects-only employees who have no row here at all (absence of a row is
-- read as: no CRM, projects allowed).
ALTER TABLE "user_access"
  ADD COLUMN IF NOT EXISTS "can_access_projects" boolean NOT NULL DEFAULT true;
