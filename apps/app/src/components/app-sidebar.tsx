import type * as React from "react";

import { NavActivityToday } from "@/components/nav-activity-today";
import { WorkClock } from "@/components/work-clock";
import { NavCrm } from "@/components/nav-crm";
import { NavMain } from "@/components/nav-main";
import { NavProjects } from "@/components/nav-projects";
import { ThemeToggleDropdown } from "@/components/theme-toggle-dropdown";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { VersionDisplay } from "@/components/version-display";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { shortcuts } from "@/constants/shortcuts";
import { useMyAccess } from "@/hooks/queries/use-my-access";
import useBrand from "@/hooks/use-brand";
import { BrandWordmark } from "@/components/brand-wordmark";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import Search from "./search";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { toggleSidebar } = useSidebar();
  const { data: access } = useMyAccess();
  const brand = useBrand();
  /*
   * Team-management surfaces: the work clock, the Business group and the
   * project list.
   *
   * Two independent gates, and both must pass:
   *   - per USER, canAccessProjects — a lead-gen account has none of this.
   *   - per INSTANCE, brand.showProjectManagement — a white-labelled client
   *     runs their own business and does not manage our team inside their CRM.
   *     VK, 2026-08-03: "we don't need this project management, right? No, no,
   *     no. Why does he need that?"
   *
   * Gated at the mount point, not just inside each component. NavMain and
   * NavProjects fire their queries (/invitation, /project) during render, and
   * those endpoints 403 for a lead-gen account — so returning null from inside
   * them would still fill the console with rejected requests on every load.
   */
  const showTeamSurfaces =
    access?.canAccessProjects === true && brand.showProjectManagement;

  useRegisterShortcuts({
    modifierShortcuts: {
      [shortcuts.sidebar.prefix]: {
        [shortcuts.sidebar.toggle]: toggleSidebar,
      },
    },
  });

  return (
    <Sidebar
      collapsible="offcanvas"
      variant="inset"
      className="border-none pt-1.5"
      {...props}
    >
      <SidebarHeader className="pt-1 pb-1.5">
        {/*
          The brand mark, above the workspace switcher.
          The switcher renders the WORKSPACE name and truncates it ("Win the
          Da…"), so before this the product had no logo anywhere in the shell —
          branding stopped at the browser tab.
        */}
        <div className="flex items-center px-2 pb-1 text-sidebar-foreground">
          <BrandWordmark className="h-7 w-auto max-w-[168px]" />
        </div>
        <WorkspaceSwitcher />
      </SidebarHeader>
      {/*
        overflow-y-auto, NOT overflow-hidden.
        This className overrides SidebarContent's own overflow-auto, so the
        sidebar could not scroll at all: everything past the fold — the work
        clock and Today's Activity — was unreachable on any screen with more
        than a couple of projects. The clock has been shipped and running for
        days; nobody could click it.
      */}
      <SidebarContent className="gap-1 overflow-y-auto py-1">
        <Search />
        {/*
          The clock sits ABOVE the navigation on purpose. It is the first thing
          an employee touches each morning and the last thing at night, and VK
          asked for the dashboard to be pinned open all day precisely so the
          half-hourly prompt lands. Anything that has to be scrolled to is
          something people forget to press.

          Hidden on a client instance. It tracks NuraView STAFF hours — the
          half-hourly "are you still working?" prompt, the penalty rules, the
          overnight auto-close — and it is the single most prominent thing in
          the sidebar. On Dan's CRM it would be the first item he sees, asking
          him to clock in to his own business. Gated on the same flag that
          hides Projects/Members/Employees, since it is the same team-management
          surface (BRAND_HIDE_PROJECTS).
        */}
        {showTeamSurfaces && <WorkClock />}
        <NavCrm />
        {showTeamSurfaces && (
          <>
            <NavMain />
            <NavProjects />
          </>
        )}
        {/*
          Today's Activity is NuraView's own productivity readout — calls,
          emails and PROJECTS VIEWED, counted per staff member so VK can see
          whether the day's outreach happened. On a client instance it is three
          numbers about somebody else's team, sitting under a sidebar that has
          had every other team surface removed.

          Gated on brand.showProjectManagement alone, NOT showTeamSurfaces: that
          also requires canAccessProjects, and a lead-gen account on NuraView's
          own instance is exactly who this panel is for — calls made and emails
          sent are their whole job.
        */}
        {brand.showProjectManagement && <NavActivityToday />}
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center justify-between">
          <VersionDisplay />
          <ThemeToggleDropdown />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
