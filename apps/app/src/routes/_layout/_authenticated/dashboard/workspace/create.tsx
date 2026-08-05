/**
 * Workspace creation is disabled on this instance.
 *
 * NuraView is single-tenant: one workspace, provisioned by
 * apps/api/scripts/seed-instance.ts. Upstream is multi-tenant SaaS, where
 * better-auth makes whoever creates an organization its OWNER — and CRM access
 * was derived from workspace role, so any employee could use this page to
 * promote themselves and read the whole lead pipeline.
 *
 * The server refuses now (allowUserToCreateOrganization: false in
 * apps/api/src/auth.ts). The route is kept as a redirect rather than deleted so
 * an old link or bookmark lands somewhere sensible instead of on a blank
 * router error.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/create",
)({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
