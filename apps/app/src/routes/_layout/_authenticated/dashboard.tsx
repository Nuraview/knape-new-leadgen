import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import { fetchMyAccess, landingPathFor } from "@/lib/landing-path";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

export const Route = createFileRoute("/_layout/_authenticated/dashboard")({
  // Every project-board route hangs off this one, so guarding here covers the
  // boards, the member list, invitations and settings in a single place. The
  // API refuses them independently; this stops a typed URL from rendering a
  // shell full of failed requests.
  beforeLoad: async () => {
    const access = await fetchMyAccess().catch(() => null);
    if (!access || access.canAccessProjects) return;

    const target = landingPathFor(access);
    // An account with neither projects nor leads has nowhere else to be, and
    // landingPathFor would send it straight back here — redirecting would spin.
    if (target === "/dashboard") return;

    throw redirect({ to: target });
  },
  component: DashboardLayoutComponent,
});

function DashboardLayoutComponent() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();

  return (
    <>
      <PageTitle
        title={t("navigation:page.projectsTitle")}
        hideAppName={!workspace?.name}
      />
      <Outlet />
    </>
  );
}
