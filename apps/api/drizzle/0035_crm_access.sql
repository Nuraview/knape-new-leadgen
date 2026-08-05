-- Explicit per-user CRM entitlement.
--
-- CRM access used to be inferred from workspace role: owner|admin => full CRM.
-- That let any path which produced an `owner` row grant the lead pipeline —
-- including creating a workspace, which better-auth lets the creator own.
-- Verified on production: a `member` account created a workspace and went from
-- 403 to 200 on /api/lead/view.
--
-- Additive only: a new table, no changes to existing ones. Owners/admins of the
-- instance workspace still get full access without a row here, so nothing
-- changes for the existing admin.
CREATE TABLE IF NOT EXISTS "crm_access" (
  "user_id"    text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  -- 'full' | 'leads_kanban'. Unrecognised values are treated as no access by
  -- the application, so a typo fails closed.
  "level"      text NOT NULL,
  "granted_at" timestamp NOT NULL DEFAULT now()
);
