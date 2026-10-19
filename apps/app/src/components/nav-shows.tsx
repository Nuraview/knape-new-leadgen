/**
 * The "SHOWS" sidebar group: one entry per trade show, each opening into its
 * Exhibitors and Attendees lists.
 *
 * Modelled on nav-crm.tsx and ported in spirit from the tec5 lead-gen app, whose
 * sidebar had exactly this group. The shows come from the EVENTS registry, so a
 * new show is one registry entry and needs no change here. Both sub-items point
 * at the one show-detail route (/events/<slug>) with a ?view= that picks the
 * Exhibitors table or the Attendees card grid.
 *
 * Shown only where a lead-gen cockpit is connected (config.hasLeadgen) and the
 * account can read leads, the same gate the flat "Events" entry used before it
 * moved here.
 */
import { useNavigate } from "@tanstack/react-router";
import {
	CalendarDays,
	ChevronRight,
	Cpu,
	type LucideIcon,
	Ship,
	Waves,
} from "lucide-react";
import { useState } from "react";
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
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { useMyAccess } from "@/hooks/queries/use-my-access";
import { cn } from "@/lib/cn";
import { EVENTS } from "@/lib/events/registry";

/** A face per show; anything unmapped falls back to the calendar glyph. */
const SHOW_ICONS: Record<string, LucideIcon> = {
	"weftec-2026": Waves,
	"workboat-2026": Ship,
	"semicon-2026": Cpu,
};

const SUB_ITEMS = [
	["exhibitors", "Exhibitors"],
	["attendees", "Attendees"],
] as const;

export function NavShows() {
	const navigate = useNavigate();
	const { data: access } = useMyAccess();
	const { data: config } = useGetConfig();

	const pathname = window.location.pathname;
	const search = window.location.search;
	const activeSlug = pathname.startsWith("/events/")
		? pathname.slice("/events/".length)
		: "";
	// Open the show whose page is on screen; otherwise start on SEMICON West,
	// the one that actually has a list loaded.
	const [expanded, setExpanded] = useState<string | null>(
		activeSlug || "semicon-2026",
	);

	// Only on a cockpit instance, and only for an account that can read leads.
	if (
		!access?.canReadLeads ||
		config?.hasLeadgen !== true ||
		access.crmLevel !== "full"
	) {
		return null;
	}

	return (
		<Collapsible defaultOpen className="group/collapsible">
			<SidebarGroup className="gap-1 p-2">
				<CollapsibleTrigger
					className="data-panel-open:[&_svg]:rotate-90"
					render={
						<SidebarGroupLabel className="h-7 cursor-pointer justify-between px-0 text-sidebar-accent-foreground" />
					}
				>
					<span>SHOWS</span>
					<ChevronRight className="h-3.5 w-3.5 text-sidebar-foreground/60 transition-transform duration-200" />
				</CollapsibleTrigger>
				<CollapsiblePanel>
					<SidebarGroupContent>
						<SidebarMenu className="gap-0.5">
							{EVENTS.map((ev) => {
								const Icon = SHOW_ICONS[ev.slug] ?? CalendarDays;
								const isOpen = expanded === ev.slug;
								const onShow = activeSlug === ev.slug;
								return (
									<SidebarMenuItem key={ev.slug}>
										<SidebarMenuButton
											tooltip={ev.name}
											isActive={onShow}
											size="default"
											className="h-8 ps-3.5 text-sm hover:bg-transparent hover:text-sidebar-accent-foreground active:bg-transparent"
											onClick={() =>
												setExpanded((cur) =>
													cur === ev.slug ? null : ev.slug,
												)
											}
										>
											<Icon className="size-4" />
											<span>{ev.shortName}</span>
											<ChevronRight
												className={cn(
													"ml-auto size-3.5 text-sidebar-foreground/50 transition-transform",
													isOpen && "rotate-90",
												)}
											/>
										</SidebarMenuButton>

										{isOpen ? (
											<ul className="ms-6 mt-0.5 space-y-0.5 border-s border-sidebar-border/60 ps-2">
												{SUB_ITEMS.map(([v, label]) => {
													const wantsAttendees = v === "attendees";
													const active =
														onShow &&
														wantsAttendees ===
															search.includes("view=attendees");
													return (
														<li key={v}>
															<button
																type="button"
																onClick={() =>
																	navigate({
																		to: "/events/$slug",
																		params: { slug: ev.slug },
																		search: { view: v },
																	})
																}
																className={cn(
																	"w-full rounded px-2 py-1 text-start text-[13px] text-sidebar-foreground/80 hover:text-sidebar-accent-foreground",
																	active &&
																		"bg-sidebar-accent/60 font-medium text-sidebar-accent-foreground",
																)}
															>
																{label}
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
