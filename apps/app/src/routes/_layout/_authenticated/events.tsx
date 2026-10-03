/**
 * Events: trade-show lead pools (WEFTEC, WorkBoat, and more).
 *
 * Each pool is the set of accounts a show contributed: exhibitors read from the
 * show's public directory, plus the client's own booth scans. They are tagged in
 * the cockpit with lead_source_bucket = "event:<slug>" and kept apart from the
 * main discovery pipeline, so this page is their own home rather than more rows
 * mixed into Leads.
 *
 * This route is the OVERVIEW: one card per show. The per-show table lives at its
 * own route, events_.$slug.tsx. The list of shows comes from the registry
 * (lib/events/registry.ts), not from the data, so a show the team is preparing
 * for appears before its first lead is collected; live counts from
 * GET /api/events are merged in by slug.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";
import type { EventPool, EventsResponse } from "@/fetchers/leadgen/types";
import { cn } from "@/lib/cn";
import { EVENTS, type EventDef, TIERS } from "@/lib/events/registry";

const STATUS_LABEL: Record<EventDef["status"], string> = {
	"post-show": "Post-show",
	planning: "Planning",
	upcoming: "Upcoming",
};

const STATUS_CLASS: Record<EventDef["status"], string> = {
	"post-show": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
	planning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
	upcoming: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
};

function metaLine(ev: EventDef): string {
	return [ev.vertical, ev.dates, ev.location].filter(Boolean).join(" · ");
}

function EventCard({ ev, pool }: { ev: EventDef; pool?: EventPool }) {
	const total = pool?.total ?? 0;
	const tiers = pool?.tiers ?? {};

	return (
		<Link
			to="/events/$slug"
			params={{ slug: ev.slug }}
			className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card text-start transition-colors hover:border-primary hover:bg-muted/40"
		>
			<div className={cn("h-1.5 w-full", ev.accentClass)} />
			<div className="flex flex-1 flex-col gap-3 p-4">
				<div className="flex items-start justify-between gap-2">
					<div className="flex items-center gap-2">
						<CalendarDays className="size-4 text-primary" />
						<span className="font-semibold text-base">{ev.name}</span>
					</div>
					<span
						className={cn(
							"rounded-full px-2 py-0.5 text-[11px] font-medium",
							STATUS_CLASS[ev.status],
						)}
					>
						{STATUS_LABEL[ev.status]}
					</span>
				</div>

				<p className="text-sm text-muted-foreground">{metaLine(ev)}</p>

				<div className="flex items-baseline gap-1">
					<span className="font-semibold text-2xl tabular-nums">
						{total.toLocaleString()}
					</span>
					<span className="text-sm text-muted-foreground">leads</span>
				</div>

				{total > 0 ? (
					<>
						<p className="text-xs text-muted-foreground">
							{(pool?.with_contacts ?? 0).toLocaleString()} with contacts ·{" "}
							{(pool?.with_email ?? 0).toLocaleString()} with email
						</p>
						<div className="flex flex-wrap gap-1.5">
							{TIERS.filter((t) => !t.excluded && (tiers[t.key] ?? 0) > 0).map(
								(t) => (
									<span
										key={t.key}
										className={cn(
											"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
											t.chipClass,
										)}
									>
										{t.label}
										<span className="tabular-nums opacity-80">
											{tiers[t.key]}
										</span>
									</span>
								),
							)}
						</div>
					</>
				) : (
					<p className="text-xs text-muted-foreground">
						No leads yet. Exhibitors and booth scans for this show appear here
						once collected.
					</p>
				)}

				<p className="mt-auto pt-1 text-sm text-muted-foreground">
					{ev.description}
				</p>
			</div>
		</Link>
	);
}

function EventsOverview() {
	const { data, isLoading, error } = useQuery({
		queryKey: ["events", "pools"],
		queryFn: () => leadgen.get<EventsResponse>("/api/events"),
	});

	if (isLoading) {
		return (
			<div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
				{[0, 1, 2].map((i) => (
					<Skeleton key={i} className="h-56 w-full rounded-lg" />
				))}
			</div>
		);
	}
	if (error) {
		return (
			<p className="p-5 text-sm text-destructive">
				Could not load events: {(error as Error).message}
			</p>
		);
	}

	const bySlug = new Map((data?.pools ?? []).map((p) => [p.slug, p]));
	// Any event pool in the data that the registry does not know about is still
	// worth showing, appended after the curated list with a minimal definition.
	const extras: EventDef[] = (data?.pools ?? [])
		.filter((p) => !EVENTS.some((e) => e.slug === p.slug))
		.map((p) => ({
			slug: p.slug,
			name: p.name,
			shortName: p.name,
			vertical: "",
			location: "",
			dates: "",
			status: "post-show",
			description: "",
			accentClass: "bg-zinc-400",
		}));

	return (
		<div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
			{[...EVENTS, ...extras].map((ev) => (
				<EventCard key={ev.slug} ev={ev} pool={bySlug.get(ev.slug)} />
			))}
		</div>
	);
}

function EventsPage() {
	return (
		<Layout>
			<PageTitle title="Events" />
			<header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:gap-3 sm:px-5">
				<SidebarTrigger className="-ms-1" />
				<h1 className="min-w-0 truncate font-semibold text-lg sm:text-xl">
					Events
				</h1>
			</header>
			<div className="flex flex-1 flex-col overflow-y-auto">
				<EventsOverview />
			</div>
		</Layout>
	);
}

export const Route = createFileRoute("/_layout/_authenticated/events")({
	component: EventsPage,
});
