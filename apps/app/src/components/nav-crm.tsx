/**
 * NuraView CRM navigation.
 *
 * The vendored app only knew about projects/members/invitations, so the ported
 * CRM modules had no way in — the Leads page existed but was an unlinked URL,
 * which made the app look like an untouched Kaneo instance.
 *
 * Modules still living in the legacy Next app are listed and marked, rather
 * than hidden. Showing the real shape of the migration is more useful than a
 * short nav that implies nothing else exists.
 */
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { cn } from "@/lib/cn";
import useBrand from "@/hooks/use-brand";
import { useMyAccess } from "@/hooks/queries/use-my-access";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import {
  CalendarClock,
  ChevronRight,
  /*
   * Icons for the entries commented out below — re-import each alongside the
   * entry it belongs to:
   *   FileText     Proposals
   *   Receipt      Invoices
   *   Phone        Dialer
   *   Package      Orders
   * Administration used Settings, which is still imported for Pipeline settings.
   */
  Inbox,
  KanbanSquare,
  LayoutGrid,
  type LucideIcon,
  Mailbox,
  Radar,
  Send,
  Settings,
  Home,
} from "lucide-react";
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

/**
 * Where un-ported modules still live.
 *
 * Brand-driven rather than hardcoded, because this used to be a fixed
 * `https://crmx1.nuraview.com`. On a white-labelled client instance that is not
 * merely a dead link — it is a link out of the client's own CRM into
 * NuraView's internal one. An instance with no legacy app sets
 * BRAND_LEGACY_BASE_URL="" and the entries are hidden instead of opened.
 */
function useLegacyBase(): string | null {
  return useBrand().legacyBaseUrl;
}

type CrmNavItem = {
  title: string;
  icon: LucideIcon;
  /** Ported to this app. */
  to?: string;
  /** Still served by the legacy Next app. */
  legacyPath?: string;
  /**
   * Sub-entries, mirroring the legacy sidebar. Marketing had these as a nested
   * group and the team navigates by them, so a single flat link loses the map
   * of what the module actually contains.
   */
  children?: { title: string; to: string }[];
};

/**
 * The lead-gen cockpit's own sections, ported into this app.
 *
 * Shown only where a cockpit is actually connected (config.hasLeadgen), so
 * NuraView's instance — whose leads come from the Upwork scraper — never sees
 * them. Names follow the cockpit's sidebar, which is the vocabulary the people
 * running these campaigns already use.
 */
const LEADGEN_ITEMS: CrmNavItem[] = [
  // "Leads" here is the COCKPIT pipeline, not crm_Leads. On a client instance
  // crm_Leads is empty — its rows are NuraView's Upwork scrapes — so the
  // stock Leads/Kanban pages render "0 leads" beside a cockpit holding 1333
  // accounts. This is the list that actually has his pipeline in it.
  // First, and deliberately: the outcome view. Everything below it operates
  // the machine; this one says whether the machine is working.
  { title: "Home", icon: Home, to: "/home" },
  { title: "Leads", icon: Inbox, to: "/pipeline" },
  { title: "Inbound", icon: Inbox, to: "/inbound" },
  { title: "Live Finder", icon: Radar, to: "/finder" },
  { title: "Outreach", icon: Send, to: "/emails" },
  { title: "Inboxes", icon: Mailbox, to: "/inboxes" },
  // The cockpit's own settings registry — scraper cadence, target states,
  // enrichment caps, send caps and the vendor keys. Named "Pipeline settings"
  // to keep it distinct from account/workspace settings.
  { title: "Pipeline settings", icon: Settings, to: "/pipeline-settings" },
  /*
   * The cockpit's kanban board, not this app's own /board.
   *
   * /board reads NuraView's projects through /api/nvprojects and needs an
   * NV_PROJECTS_PROJECT_ID this instance does not have — it is commented out
   * below for exactly that reason. This one reads the cockpit's pm_* tables,
   * which are shared with the client's other dashboard, so it shows the board
   * that already has their cards on it.
   */
  { title: "Projects", icon: KanbanSquare, to: "/projects" },
];

const ITEMS: CrmNavItem[] = [
  { title: "Leads", icon: Inbox, to: "/leads" },
  { title: "Kanban", icon: LayoutGrid, to: "/leads/kanban" },
  /*
   * Activity is gone from the sidebar. It rendered an empty feed that nothing
   * writes to, so it cost a slot in a 15-item list and answered nothing —
   * "it's basically useless because there is nothing here, this is not
   * updated" (VK, 2026-08-05). The route still resolves for anyone holding a
   * link; it simply is not offered.
   */
  /*
   * Dialer is not offered on this instance.
   *
   * Two independent reasons, either one sufficient. Its contact list, call log
   * and SMS threads live in the dialer_* tables, which this CRM database does
   * not have — /api/dialer/contacts answers 500. And placing a call needs the
   * four Twilio credentials behind config.hasDialer, which are not set, so the
   * provider already declines to mint a token.
   *
   * Commented, not deleted: set the Twilio vars and apply the dialer schema and
   * this is one line to restore.
   */
  // { title: "Dialer", icon: Phone, to: "/dialer" },
  /*
   * Proposals and Invoices are not offered on this instance.
   *
   * They read crm_Proposals / Invoices (+ their line-item, asset, activity and
   * settings tables) out of the CRM database. That schema is introspected from
   * a live NuraView database rather than owned by migrations — see
   * src/database/crm-schema.ts and scripts/crm-apply.ts, which creates only the
   * nv_orders and nv_linkedin tables — so on an instance whose CRM database was
   * created fresh, those relations do not exist and both pages answer 500.
   *
   * Commented rather than deleted: nothing about the modules is wrong, they
   * simply have no data to stand on here, and an instance that later gets the
   * schema applied should get its sidebar back by uncommenting two lines.
   *
   * Same treatment as Activity above — the routes still resolve for anyone
   * holding a link; they are just not offered.
   *
   * Original ordering and reasoning, kept so it is not lost:
   *   Invoices sat directly under Proposals because that is the order money
   *   moves in: a signed proposal converts into an invoice, and the non-signer
   *   case starts here (meeting 2026-07-30 — "I should be able to go to the
   *   invoicing and create manually").
   */
  // { title: "Proposals", icon: FileText, to: "/proposals" },
  // { title: "Invoices", icon: Receipt, to: "/invoices" },
  /*
   * Orders is not offered on this instance.
   *
   * Its nv_orders / nv_order_items tables DO exist here — they are the two that
   * scripts/crm-apply.ts creates — so unlike Proposals and Invoices this one
   * answers 200. It answers 200 with an empty list, and nothing in this
   * instance writes to it: orders arrive from a proposal being signed and an
   * invoice being paid, and neither of those surfaces is offered. An always-
   * empty screen at the end of a workflow that does not exist.
   *
   * Original reasoning, kept so it is not lost:
   *   Orders sits after Invoices because that is the order money moves in: an
   *   invoice is paid, then a planner is dispatched. VK, 2026-08-03: "add
   *   proposals, add invoices, and down below, orders and purchases".
   */
  // { title: "Orders", icon: Package, to: "/orders" },
  /*
   * Projects is not offered on this instance.
   *
   * It reads and writes NuraView's own board through /api/nvprojects, keyed by
   * NV_PROJECTS_PROJECT_ID. That is unset here — there is no second dashboard
   * to sync with — so every call answers 503 "NV_PROJECTS_PROJECT_ID is not
   * configured". Note this is the CRM board, NOT the project-management nav
   * group; that one is already hidden by BRAND_HIDE_PROJECTS.
   *
   * Set NV_PROJECTS_PROJECT_ID to restore it.
   *
   * Original reasoning, kept so it is not lost:
   *   The shared project board. NOT a copy of NuraView's — the same rows, read
   *   and written through /api/nvprojects, so a card moved on either dashboard
   *   moves on both. VK, 2026-08-03: "if any updates made it should sync both
   *   ways."
   */
  // { title: "Projects", icon: KanbanSquare, to: "/board" },
  /*
   * LinkedIn posts: drafted ahead of time, reviewed against a feed-accurate
   * preview, approved, then published at their scheduled time. Sits beside the
   * other outbound surfaces rather than under Marketing, which drives the
   * mkt_* tables and is filtered out on lead-gen-only instances.
   */
  { title: "Scheduler", icon: CalendarClock, to: "/scheduler" },
  {
    title: "Marketing",
    icon: Send,
    to: "/marketing",
    children: [
      /*
       * Compose leads the list, as it did in the legacy sidebar. The page was
       * ported and routed, but nothing in the navigation pointed at it — the
       * only way in was a button inside the Marketing view, so writing an email
       * meant first landing somewhere you did not want to be. The other entries
       * are query-param views of /marketing; this one is its own route, which is
       * why it reads differently here.
       */
      { title: "Compose", to: "/marketing/compose" },
      { title: "Dashboard", to: "/marketing?view=dashboard" },
      // "Sent", not "Inbox": this list is what WE sent, and calling it an inbox
        // made it look like incoming mail we were failing to answer.
        { title: "Sent", to: "/marketing?view=sent" },
      { title: "Sequences", to: "/marketing?view=sequences" },
      { title: "Contacts", to: "/marketing?view=contacts" },
      { title: "Templates", to: "/marketing?view=templates" },
    ],
  },
  /*
   * Administration is not offered on this instance — and with it, the WhatsApp
   * bridge, which is the only WhatsApp surface a signed-in user can reach.
   *
   * The page is three sections: the WhatsApp bridge pairing/status panel, the
   * reminder-recipient list (server-side WHATSAPP_RECIPIENTS), and archived
   * settings. All three drive the nuraview-whatsapp container, which this
   * instance does not run, so the bridge reports "never reported in" and the
   * recipient list is empty.
   *
   * The other two WhatsApp touch-points in the app go with the entries they
   * live on: the sms/whatsapp channel picker is inside Dialer, and the
   * whatsapp/recipients field is on the crm_Leads detail panel. Both of those
   * entries are commented out above, so nothing is left pointing at it.
   */
  // { title: "Administration", icon: Settings, to: "/administration" },
];

/** The only entry a `leads_kanban` account may use. */
const KANBAN_ONLY_TITLES = new Set(["Kanban"]);

export function NavCrm() {
  const navigate = useNavigate();
  const { data: access } = useMyAccess();
  const { data: config } = useGetConfig();
  const legacyBase = useLegacyBase();
  // Which module has its sub-menu open. Marketing nests six views and the team
  // navigates by them, exactly as the legacy sidebar did.
  const [expanded, setExpanded] = useState<string | null>("Marketing");

  // Projects-only accounts never see the CRM section. The API returns 403 for
  // them regardless; this keeps the UI honest rather than offering dead links.
  if (!access?.canReadLeads) return null;

  /*
   * Cockpit sections sit directly under Leads: they are the same job (find a
   * lead, research it, write to it), and separating them would make the outreach
   * pipeline look like a different product from the leads it feeds.
   */
  /*
   * On a cockpit instance the stock Leads and Kanban entries are dropped
   * entirely: both read crm_Leads, which holds NuraView's Upwork pipeline and
   * is empty here. Leaving them in the sidebar means two things called "Leads",
   * one of which always says zero.
   */
  const withLeadgen =
    config?.hasLeadgen === true
      ? [
          ...LEADGEN_ITEMS,
          {
            title: "Communications",
            icon: Mailbox,
            to: "/communications",
          } as CrmNavItem,
          ...ITEMS.filter(
            (item) =>
              item.title !== "Leads" &&
              item.title !== "Kanban" &&
              // Marketing drives crm_Leads/mkt_* tables, which are empty here;
              // Communications is the cockpit-backed equivalent.
              item.title !== "Marketing",
          ),
        ]
      : ITEMS;

  const visible =
    access.crmLevel === "full"
      ? withLeadgen
      : withLeadgen.filter((item) => KANBAN_ONLY_TITLES.has(item.title));

  // An entry with no `to` is served by the legacy app. When this instance has
  // none, drop it rather than render a row that cannot go anywhere.
  const items = legacyBase
    ? visible
    : visible.filter((item) => Boolean(item.to));

  const pathname = window.location.pathname;

  return (
    <Collapsible defaultOpen className="group/collapsible">
      <SidebarGroup className="gap-1 p-2">
        <CollapsibleTrigger
          className="data-panel-open:[&_svg]:rotate-90"
          render={
            <SidebarGroupLabel className="h-7 cursor-pointer justify-between px-0 text-sidebar-accent-foreground" />
          }
        >
          <span>CRM</span>
          <ChevronRight className="h-3.5 w-3.5 text-sidebar-foreground/60 transition-transform duration-200" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              {items.map((item) => {
                const Icon = item.icon;
                const isActive = item.to ? pathname === item.to : false;

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      tooltip={
                        item.to
                          ? item.title
                          : `${item.title} — still served by the legacy app`
                      }
                      isActive={isActive}
                      size="default"
                      className="h-8 ps-3.5 text-sm hover:bg-transparent hover:text-sidebar-accent-foreground active:bg-transparent"
                      onClick={() => {
                        if (item.to) {
                          navigate({ to: item.to });
                        } else if (legacyBase) {
                          window.open(
                            `${legacyBase}${item.legacyPath}`,
                            "_blank",
                            "noopener",
                          );
                        }
                      }}
                    >
                      <Icon className="size-4" />
                      <span>{item.title}</span>
                      {item.children ? (
                        <ChevronRight
                          className={cn(
                            "ml-auto size-3.5 text-sidebar-foreground/50 transition-transform",
                            expanded === item.title && "rotate-90",
                          )}
                          onClick={(e) => {
                            // Toggle the sub-list without navigating — the
                            // parent row still opens the module on its own.
                            e.stopPropagation();
                            setExpanded((cur) =>
                              cur === item.title ? null : item.title,
                            );
                          }}
                        />
                      ) : null}
                    </SidebarMenuButton>

                    {item.children && expanded === item.title ? (
                      <ul className="ms-6 mt-0.5 space-y-0.5 border-s border-sidebar-border/60 ps-2">
                        {item.children.map((child) => {
                          const active =
                            pathname + window.location.search === child.to;
                          return (
                            <li key={child.title}>
                              <button
                                type="button"
                                onClick={() => navigate({ to: child.to })}
                                className={cn(
                                  "w-full rounded px-2 py-1 text-start text-[13px] text-sidebar-foreground/80 hover:text-sidebar-accent-foreground",
                                  active &&
                                    "bg-sidebar-accent/60 font-medium text-sidebar-accent-foreground",
                                )}
                              >
                                {child.title}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsiblePanel>
      </SidebarGroup>
    </Collapsible>
  );
}
