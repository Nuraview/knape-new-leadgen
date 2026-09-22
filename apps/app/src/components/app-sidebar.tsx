import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
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
  const { toggleSidebar, isMobile, setOpenMobile } = useSidebar();

  /*
   * Close the drawer once navigation has happened.
   *
   * On a phone the sidebar is a Sheet over the page, and nothing was
   * dismissing it — so tapping "Pipeline" changed the route BEHIND the open
   * drawer and left the reader looking at the menu they had just used, with
   * the page they asked for hidden underneath. Every nav item in here, in
   * NavCrm, NavMain and NavProjects, is an ordinary <Link>; putting the
   * dismissal on the route instead of on each link means a new menu entry
   * cannot forget it.
   *
   * Desktop is untouched: there the sidebar is a persistent column, and
   * collapsing it on every click would be actively hostile.
   */
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [pathname, isMobile, setOpenMobile]);
  const { data: access } = useMyAccess();
  const brand = useBrand();
  /*
   * The Business group: the project list, members and invitations.
   *
   * Two independent gates, and both must pass:
   *   - per USER, canAccessProjects — a lead-gen account has none of this.
   *   - per INSTANCE, brand.showProjectManagement.
   *
   * VK said on 2026-08-03 "we don't need this project management, right? No,
   * no, no", and on 2026-09-22 the opposite: Knape's own board, with Peter on
   * it and two of his team beside him. That is what the flag is for — it is an
   * instance setting, not a fact about the product, so the reversal is one
   * variable and not a code change.
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
          the sidebar. On Peter's CRM it would be the first item he sees, asking
          him to clock in to his own business.

          On its OWN flag (BRAND_HIDE_WORK_CLOCK), no longer sharing
          BRAND_HIDE_PROJECTS. The two rode together while no client had boards,
          and the moment one did — Knape, 2026-09-22 — turning the boards on
          would have handed them the vendor's timesheet as well.
        */}
        {brand.showWorkClock && <WorkClock />}
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

          Gated on brand.showWorkClock, NOT showTeamSurfaces: the latter also
          requires canAccessProjects, and a lead-gen account on NuraView's own
          instance is exactly who this panel is for — calls made and emails sent
          are their whole job. It rides with the clock rather than with the
          boards because it is the same vendor-staff readout, counted per person.
        */}
        {brand.showWorkClock && <NavActivityToday />}
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
