import { useNavigate } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useMyAccess } from "@/hooks/queries/use-my-access";
import useBrand from "@/hooks/use-brand";

export function NavMain() {
  const { t } = useTranslation();
  const { data: workspace } = useActiveWorkspace();
  const navigate = useNavigate();
  const { data: access } = useMyAccess();
  const brand = useBrand();

  if (!workspace) return null;

  /*
   * The whole "Business" group is off on a single-operator client instance.
   *
   * Projects / Members / Invitations / Employees describe running a TEAM inside
   * this CRM. Dan is the only user of his — VK on the 2026-08-03 call: "we don't
   * need this project management, right? No, no, no. Why does he need that?"
   * What he does want under CRM is a read-only view of NuraView's work for him,
   * which is a different surface entirely.
   *
   * Gated by BRAND_HIDE_PROJECTS so NuraView's own instance is untouched.
   */
  if (!brand.showProjectManagement) return null;

  // Members, Invitations and Employees are admin surfaces — the API refuses
  // them for everyone else (Employees returns 403), so showing the links would
  // just hand an employee three dead ends.
  const isAdmin = access?.role === "owner" || access?.role === "admin";
  // Projects / Members / Invitations are the project-board surface. A lead-gen
  // account has none of it — the API 403s these routes, so showing the links
  // would only offer dead ends.
  if (!access?.canAccessProjects) return null;

  const navItems = [
    {
      title: t("navigation:sidebar.projects"),
      url: `/dashboard/workspace/${workspace.id}`,
      isActive:
        window.location.pathname === `/dashboard/workspace/${workspace.id}`,
      badge: null,
    },
    {
      title: t("navigation:sidebar.members"),
      url: `/dashboard/workspace/${workspace.id}/members`,
      isActive:
        window.location.pathname ===
        `/dashboard/workspace/${workspace.id}/members`,
      badge: null,
    },
    // Invitations removed at the client's request — the workspace is a fixed
    // set of employees, so a pending-invite queue is noise on every page.
    {
      // VK 2026-07-28: "just add Employees where I can see all these members"
      // with hours worked and whether they are still clocked in.
      title: "Employees",
      url: "/employees",
      isActive: window.location.pathname === "/employees",
      badge: null,
    },
  ];

  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarGroup className="gap-1 p-2">
        <CollapsibleTrigger
          className="data-panel-open:[&_svg]:rotate-90"
          render={
            <SidebarGroupLabel className="h-7 cursor-pointer justify-between px-0 text-sidebar-accent-foreground" />
          }
        >
          {/*
            "Business" replaces "Overview" per VK 2026-07-28: "instead of just
            name this as Overview... under Business: lead gen, marketing
            activity". Hardcoded rather than routed through i18n because the
            translation key still says overview in every locale file and the
            English label is the one the client asked for by name.
          */}
          <span>Business</span>
          <ChevronRight className="h-3.5 w-3.5 text-sidebar-foreground/60 transition-transform duration-200" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {navItems
                .filter((item) => isAdmin || item.title === t("navigation:sidebar.projects"))
                .map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={item.isActive}
                    size="default"
                    className="h-8 ps-3.5 text-sm hover:bg-transparent hover:text-sidebar-accent-foreground active:bg-transparent"
                    onClick={() => navigate({ to: item.url })}
                  >
                    <span>{item.title}</span>
                    {item.badge !== null && (
                      <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-sm border border-sidebar-border/60 px-1 text-[11px] font-medium text-sidebar-foreground/80">
                        {item.badge}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsiblePanel>
      </SidebarGroup>
    </Collapsible>
  );
}
