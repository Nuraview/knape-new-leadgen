/**
 * Event detail: one trade show's leads, as a sortable, filterable table.
 *
 * The sibling of events.tsx (the overview). Kept at its own flattened route
 * (events_.$slug) rather than nested, so the overview stays a plain grid with no
 * <Outlet>. Rows are ACCOUNTS, not people: an event pool is mostly companies
 * until it is enriched (WEFTEC is ~1,150 companies behind a handful of
 * contacts), so an accounts table is what actually fills, and every row opens
 * the normal lead detail where its contacts, research and outreach already live.
 *
 * Paging, search, the tier filter and the has-contacts / has-email filters are
 * all server-side (cockpit GET /api/accounts), so they hold across the whole
 * pool, not just the rows on screen. The tier chips' counts come from
 * GET /api/events, which counts the whole pool.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ChevronLeft,
	Download,
	ExternalLink,
	Mail,
	Search,
	Users,
} from "lucide-react";
import { useState } from "react";
import Layout from "@/components/common/layout";
import { LeadsPager } from "@/components/leadgen/leads-pager";
import { TierChip } from "@/components/leadgen/tier-chip";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";
import type {
	Account,
	AccountsResponse,
	EventsResponse,
} from "@/fetchers/leadgen/types";
import { cn } from "@/lib/cn";
import { downloadCsv, toCsv } from "@/lib/csv";
import { eventBySlug, TIERS, tierByKey } from "@/lib/events/registry";

const PAGE_SIZE = 200;
/** One request covers the whole pool for export: well under MAX_PAGE_SIZE 2000. */
const EXPORT_PAGE_SIZE = 2000;

/** Six columns on desktop; Tier / Company / ICP on phones (the rest hide). */
const COLS = "88px minmax(0,1.6fr) minmax(0,1fr) 92px 84px 76px";

type ListFilter = "all" | "contacts" | "email";

function scoreTone(score: number | undefined): string {
	const s = score ?? 0;
	if (s >= 8) return "bg-emerald-500/15 text-emerald-500";
	if (s >= 6) return "bg-amber-500/15 text-amber-500";
	return "bg-muted text-muted-foreground";
}

function cockpitHost(website: string): string {
	try {
		return new URL(website).host.replace(/^www\./, "");
	} catch {
		return website;
	}
}

function accountParams(
	slug: string,
	opts: { tier: string; filter: ListFilter; q: string },
): Record<string, string | number | undefined> {
	const params: Record<string, string | number | undefined> = {
		data_batch: slug,
		mode: "accounts",
		min_icp: 0,
		sort: "icp",
	};
	if (opts.tier) params.tier = opts.tier;
	if (opts.q.trim()) params.q = opts.q.trim();
	if (opts.filter === "contacts") params.contact_filter = "has";
	if (opts.filter === "email") params.email_filter = "has";
	return params;
}

function RouteComponent() {
	const { slug } = Route.useParams();
	const ev = eventBySlug(slug);

	const [tier, setTier] = useState("");
	const [filter, setFilter] = useState<ListFilter>("all");
	const [q, setQ] = useState("");
	const [page, setPage] = useState(1);
	const [exporting, setExporting] = useState(false);

	// Shared with the overview's cache: the pool's whole-pool counts and the
	// tier breakdown the chips report.
	const pools = useQuery({
		queryKey: ["events", "pools"],
		queryFn: () => leadgen.get<EventsResponse>("/api/events"),
	});
	const pool = pools.data?.pools.find((p) => p.slug === slug);

	const list = useQuery({
		queryKey: ["events", "accounts", slug, tier, filter, q, page],
		queryFn: () =>
			leadgen.get<AccountsResponse>("/api/accounts", {
				...accountParams(slug, { tier, filter, q }),
				page,
				page_size: PAGE_SIZE,
			}),
		placeholderData: (prev) => prev,
	});

	const rows: Account[] =
		list.data && list.data.mode === "accounts" ? list.data.items : [];
	const pageInfo = {
		page: list.data?.page ?? page,
		pageSize: list.data?.page_size ?? PAGE_SIZE,
		total: list.data?.total ?? 0,
		pages: list.data?.pages ?? 1,
	};

	const title = ev?.name ?? pool?.name ?? slug;
	const total = pool?.total ?? pageInfo.total;
	const metaParts = ev
		? [ev.vertical, ev.dates, ev.location].filter(Boolean)
		: [];

	function reset(change: () => void) {
		change();
		setPage(1);
	}

	async function exportCsv() {
		setExporting(true);
		try {
			const res = await leadgen.get<AccountsResponse>("/api/accounts", {
				...accountParams(slug, { tier, filter, q }),
				page: 1,
				page_size: EXPORT_PAGE_SIZE,
			});
			const items = res.mode === "accounts" ? res.items : [];
			const headers = [
				"Tier",
				"Company",
				"Industry",
				"Segment",
				"Website",
				"Contacts",
				"Emails",
				"ICP",
				"Your rating",
			];
			const body = items.map((a) => [
				tierByKey(a.tier).label,
				a.company,
				a.industry ?? "",
				a.segment ?? "",
				a.website ?? "",
				a.contacts_count ?? 0,
				a.emails_count ?? 0,
				a.score?.toFixed(1) ?? "",
				a.client_rating ?? "",
			]);
			downloadCsv(`${slug}-leads.csv`, toCsv(headers, body));
		} finally {
			setExporting(false);
		}
	}

	const availableTiers = TIERS.filter(
		(t) => !t.excluded && (pool?.tiers?.[t.key] ?? 0) > 0,
	);

	return (
		<Layout>
			<PageTitle title={title} />

			<header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 sm:gap-3 sm:px-5">
				<SidebarTrigger className="-ms-1" />
				<Link
					to="/events"
					className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ChevronLeft className="size-4" />
					Events
				</Link>
				<span className="truncate font-medium text-sm text-foreground/80">
					/ {ev?.shortName ?? title}
				</span>
				<Button
					className="ms-auto"
					variant="outline"
					onClick={exportCsv}
					disabled={exporting || total === 0}
				>
					<Download className="size-4" />
					{exporting ? "Exporting…" : "Export CSV"}
				</Button>
			</header>

			<div className="flex flex-1 flex-col overflow-y-auto">
				{/* Title block */}
				<div className="px-3 pt-4 sm:px-5">
					<h1 className="font-semibold text-xl tracking-tight">{title}</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{[...metaParts, `${total.toLocaleString()} leads`].join(" · ")}
					</p>
				</div>

				{/* Toolbar */}
				<div className="flex flex-col gap-3 px-3 py-3 sm:px-5">
					<div className="relative w-full sm:w-72">
						<Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
						<input
							value={q}
							onChange={(e) => reset(() => setQ(e.target.value))}
							placeholder="Search company…"
							className="h-9 w-full rounded-md border border-border bg-background ps-8 pe-3 text-sm"
						/>
					</div>

					<div className="flex flex-wrap items-center gap-1.5">
						{/* Tier chips */}
						<button
							type="button"
							onClick={() => reset(() => setTier(""))}
							className={cn(
								"rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
								tier === ""
									? "border-foreground bg-foreground text-background"
									: "border-border text-muted-foreground hover:bg-muted",
							)}
						>
							All tiers {total.toLocaleString()}
						</button>
						{availableTiers.map((t) => (
							<button
								key={t.key}
								type="button"
								onClick={() => reset(() => setTier(t.key))}
								title={t.hint}
								className={cn(
									"inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all",
									t.chipClass,
									tier === t.key
										? "ring-2 ring-foreground/30"
										: "opacity-80 hover:opacity-100",
								)}
							>
								{t.label}
								<span className="tabular-nums">{pool?.tiers?.[t.key]}</span>
							</button>
						))}

						<span className="mx-1 h-5 w-px self-center bg-border" />

						{/* Has-contacts / has-email filters */}
						{(
							[
								["all", "All", total],
								["contacts", "Has contacts", pool?.with_contacts ?? 0],
								["email", "Has email", pool?.with_email ?? 0],
							] as [ListFilter, string, number][]
						).map(([key, label, count]) => (
							<button
								key={key}
								type="button"
								onClick={() => reset(() => setFilter(key))}
								className={cn(
									"rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
									filter === key
										? "border-foreground bg-foreground text-background"
										: "border-border text-muted-foreground hover:bg-muted",
								)}
							>
								{label} {count.toLocaleString()}
							</button>
						))}
					</div>
				</div>

				{/* Table */}
				<div className="px-3 pb-4 sm:px-5">
					{list.isLoading ? (
						<div className="flex flex-col gap-2">
							{[0, 1, 2, 3, 4, 5].map((i) => (
								<Skeleton key={i} className="h-12 w-full rounded-md" />
							))}
						</div>
					) : list.error ? (
						<p className="text-sm text-destructive">
							Could not load leads: {(list.error as Error).message}
						</p>
					) : rows.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No leads match these filters.
						</p>
					) : (
						<div
							className="overflow-hidden rounded-xl border border-border"
							style={{ ["--cols" as string]: COLS }}
						>
							{/* Header */}
							<div className="grid items-center gap-2 bg-muted/50 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground max-md:grid-cols-[88px_1fr_76px] md:grid-cols-[var(--cols)]">
								<span>Tier</span>
								<span>Company</span>
								<span className="max-md:hidden">Website</span>
								<span className="max-md:hidden text-right">Contacts</span>
								<span className="max-md:hidden text-right">Emails</span>
								<span className="text-right">ICP</span>
							</div>

							<ul
								className={cn(
									"divide-y divide-border",
									list.isFetching && "opacity-60 transition-opacity",
								)}
							>
								{rows.map((a) => (
									<li key={a.id}>
										<Link
											to="/pipeline/$accountId"
											params={{ accountId: String(a.id) }}
											className="grid items-center gap-2 px-3 py-2.5 transition-colors hover:bg-muted/40 max-md:grid-cols-[88px_1fr_76px] md:grid-cols-[var(--cols)]"
										>
											<span>
												<TierChip tierKey={a.tier} />
											</span>

											<span className="min-w-0">
												<span className="block truncate font-medium">
													{a.company}
												</span>
												{a.industry || a.segment ? (
													<span className="block truncate text-xs text-muted-foreground">
														{[a.industry, a.segment]
															.filter(Boolean)
															.join(" · ")}
													</span>
												) : null}
											</span>

											<span className="max-md:hidden min-w-0 text-sm text-muted-foreground">
												{a.website ? (
													<span className="inline-flex items-center gap-1 truncate">
														{cockpitHost(a.website)}
														<ExternalLink className="size-3 shrink-0 opacity-70" />
													</span>
												) : (
													"—"
												)}
											</span>

											<span className="max-md:hidden flex items-center justify-end gap-1 text-sm text-muted-foreground tabular-nums">
												<Users className="size-3.5" />
												{a.contacts_count ?? 0}
											</span>

											<span className="max-md:hidden flex items-center justify-end gap-1 text-sm text-muted-foreground tabular-nums">
												<Mail className="size-3.5" />
												{a.emails_count ?? 0}
											</span>

											<span className="text-right">
												<span
													className={cn(
														"rounded px-1.5 py-0.5 text-xs tabular-nums",
														scoreTone(a.score),
													)}
												>
													{a.score?.toFixed(1) ?? "—"}
												</span>
											</span>
										</Link>
									</li>
								))}
							</ul>
						</div>
					)}

					{!list.isLoading && !list.error && rows.length > 0 ? (
						<LeadsPager
							info={pageInfo}
							onPage={setPage}
							busy={list.isFetching}
							noun="companies"
						/>
					) : null}
				</div>
			</div>
		</Layout>
	);
}

export const Route = createFileRoute("/_layout/_authenticated/events_/$slug")({
	component: RouteComponent,
});
