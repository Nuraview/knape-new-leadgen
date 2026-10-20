/**
 * Attendees view for a trade show: one card per company, each with the people
 * who registered under it.
 *
 * The tec5 lead-gen app had a dedicated company-card grid for SEMICON West's
 * attendees; this is the same idea on this app's stack and tokens. The cockpit
 * serves people as the `contacts` of an event pool's accounts, so a single
 * request for the pool's accounts-with-contacts (GET /api/accounts with
 * contact_filter=has) gives one row per company plus its people counts, which
 * is exactly a card. The company's individual people are loaded on demand when
 * a card opens (see CompanyDetailSheet). Summing the per-company counts here
 * gives the headline tiles without a second request.
 *
 * The whole roster is fetched once (every page, concatenated) and held in
 * memory, so search, the tier chips, the email-status chips and the sort are
 * all done client-side here: they are instant and need no further request. The
 * filter controls mirror the Exhibitors table so the two tabs feel the same.
 * A roster is otherwise an alphabetical wall of mostly single-person companies,
 * so the default sort is by headcount (the big delegations first), which is
 * what makes it navigable.
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Mail, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { CompanyDetailSheet } from "@/components/leadgen/company-detail-sheet";
import { SignalMeter } from "@/components/leadgen/signal-meter";
import { TierChip } from "@/components/leadgen/tier-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";
import type { Account, AccountsResponse } from "@/fetchers/leadgen/types";
import { cn } from "@/lib/cn";
import { downloadCsv, toCsv } from "@/lib/csv";
import { TIERS, tierByKey } from "@/lib/events/registry";

/** One page covers the whole attendee pool: at the endpoint's 2,000 cap. */
const PAGE_SIZE = 2000;

/** Narrow the grid by whether a company has any emailable person. */
type StatusFilter = "all" | "email" | "noemail";
/** How the cards are ordered. "people" (headcount, high to low) is the default. */
type SortKey = "people" | "company";

/** Map the effective tier to a 0-5 signal, strongest first. */
function signalFromTier(tier: string | undefined): number {
	switch ((tier ?? "").toUpperCase()) {
		case "T0-HOT":
			return 5;
		case "T1-WARM":
			return 4;
		case "T2-ICP":
			return 3;
		case "T3-PARTNER":
			return 3;
		case "T4-UNKNOWN":
			return 1;
		default:
			return 0;
	}
}

/** Booth is carried in the signal_evidence text ("… Booth 5567."), not a column. */
function boothFromEvidence(evidence: string | undefined): string {
	const m = /Booth\s+([^.]+)\./.exec(evidence ?? "");
	return m ? m[1].trim() : "";
}

function cleanHost(website: string): string {
	try {
		return new URL(website).host.replace(/^www\./, "");
	} catch {
		return website;
	}
}

function Stat({
	label,
	value,
	hint,
}: {
	label: string;
	value: string | number;
	hint?: string;
}) {
	return (
		<div className="rounded-lg border border-border bg-card p-4">
			<div className="text-xs uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
				{typeof value === "number" ? value.toLocaleString() : value}
			</div>
			{hint ? (
				<div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
			) : null}
		</div>
	);
}

function CompanyTile({
	a,
	onOpen,
}: {
	a: Account;
	onOpen: () => void;
}) {
	const booth = boothFromEvidence(a.signal_evidence);
	const people = a.contacts_count ?? 0;
	const withEmail = a.emails_count ?? 0;
	return (
		<button
			type="button"
			onClick={onOpen}
			className="group flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-foreground/20 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
		>
			<div className="flex items-start gap-3">
				<div className="min-w-0 flex-1">
					<div className="truncate font-medium text-[15px] leading-5 group-hover:underline group-hover:underline-offset-4">
						{a.company}
					</div>
					<div className="mt-0.5 truncate text-[13px] text-muted-foreground">
						{a.website ? (
							<span className="inline-flex items-center gap-1">
								{cleanHost(a.website)}
								<ExternalLink className="size-3 shrink-0 opacity-70" />
							</span>
						) : (
							(a.segment || "Domain not known")
						)}
					</div>
				</div>
				<SignalMeter value={signalFromTier(a.tier)} />
			</div>

			<div className="flex flex-wrap gap-1.5">
				{a.tier ? <TierChip tierKey={a.tier} /> : null}
				{booth ? (
					<span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
						Booth {booth}
					</span>
				) : null}
			</div>

			<div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-3 text-[13px] text-muted-foreground">
				<span className="inline-flex items-center gap-1">
					<Users className="size-3.5" /> {people.toLocaleString()}{" "}
					{people === 1 ? "person" : "people"}
				</span>
				<span className="inline-flex items-center gap-1">
					<Mail className="size-3.5" /> {withEmail.toLocaleString()} with email
				</span>
			</div>
		</button>
	);
}

export function AttendeesGrid({ slug }: { slug: string }) {
	const [search, setSearch] = useState("");
	const [tier, setTier] = useState("");
	const [status, setStatus] = useState<StatusFilter>("all");
	const [sort, setSort] = useState<SortKey>("people");
	const [open, setOpen] = useState<Account | null>(null);

	const list = useQuery({
		queryKey: ["events", "attendees", slug],
		queryFn: async () => {
			// The cockpit caps a page at 2,000 companies, and a large show (WorkBoat
			// has ~3,750 companies with people) exceeds that. Fetch page 1, then pull
			// the remaining pages and concatenate, so every company is loaded and the
			// stat tiles and chip counts (computed client-side below) cover the
			// whole roster rather than one page of it.
			const base = {
				data_batch: slug,
				mode: "accounts",
				contact_filter: "has",
				min_icp: 0,
				sort: "icp",
				page_size: PAGE_SIZE,
			} as const;
			const first = await leadgen.get<AccountsResponse>("/api/accounts", {
				...base,
				page: 1,
			});
			if (first.mode !== "accounts" || first.pages <= 1) return first;
			const rest = await Promise.all(
				Array.from({ length: first.pages - 1 }, (_, i) =>
					leadgen.get<AccountsResponse>("/api/accounts", {
						...base,
						page: i + 2,
					}),
				),
			);
			const items = [...first.items];
			for (const r of rest) if (r.mode === "accounts") items.push(...r.items);
			return { ...first, items };
		},
	});

	const all: Account[] =
		list.data && list.data.mode === "accounts" ? list.data.items : [];

	// Chip counts over the WHOLE roster, so a chip always shows how many it would
	// select, not how many are left after the other filters.
	const facets = useMemo(() => {
		const tierCounts = new Map<string, number>();
		let withEmail = 0;
		for (const a of all) {
			const key = tierByKey(a.tier).key;
			tierCounts.set(key, (tierCounts.get(key) ?? 0) + 1);
			if ((a.emails_count ?? 0) > 0) withEmail += 1;
		}
		// Only the tiers actually present, in the registry's canonical order.
		const tiers = TIERS.filter((t) => (tierCounts.get(t.key) ?? 0) > 0);
		return {
			tierCounts,
			tiers,
			total: all.length,
			withEmail,
			noEmail: all.length - withEmail,
		};
	}, [all]);

	const rows = useMemo(() => {
		const q = search.trim().toLowerCase();
		const out = all.filter((a) => {
			if (q && !a.company.toLowerCase().includes(q)) return false;
			if (tier && tierByKey(a.tier).key !== tier) return false;
			const emails = a.emails_count ?? 0;
			if (status === "email" && emails === 0) return false;
			if (status === "noemail" && emails > 0) return false;
			return true;
		});
		out.sort((a, b) => {
			if (sort === "people") {
				const d = (b.contacts_count ?? 0) - (a.contacts_count ?? 0);
				if (d !== 0) return d;
			}
			return a.company.localeCompare(b.company);
		});
		return out;
	}, [all, search, tier, status, sort]);

	// The tiles follow the current filter, so "Companies" always matches what is
	// on screen; with no filter they read the whole roster.
	const totals = useMemo(() => {
		let people = 0;
		let withEmail = 0;
		for (const a of rows) {
			people += a.contacts_count ?? 0;
			withEmail += a.emails_count ?? 0;
		}
		return { companies: rows.length, people, withEmail };
	}, [rows]);

	function exportCsv() {
		const headers = [
			"Company",
			"Booth",
			"Website",
			"Segment",
			"Tier",
			"People",
			"With email",
		];
		const body = rows.map((a) => [
			a.company,
			boothFromEvidence(a.signal_evidence),
			a.website ?? "",
			a.segment ?? "",
			tierByKey(a.tier).label,
			a.contacts_count ?? 0,
			a.emails_count ?? 0,
		]);
		downloadCsv(`${slug}-attendees.csv`, toCsv(headers, body));
	}

	return (
		<div className="flex flex-col gap-4 px-3 pb-6 sm:px-5">
			{/* Stat tiles */}
			<div className="grid grid-cols-3 gap-2">
				<Stat label="Companies" value={totals.companies} hint="Each company once." />
				<Stat label="People" value={totals.people} hint="Registered attendees." />
				<Stat
					label="With email"
					value={totals.withEmail}
					hint="Addresses that can be sent to."
				/>
			</div>

			{/* Toolbar: the same controls the Exhibitors table has. */}
			<div className="flex flex-col gap-3">
				<div className="flex flex-wrap items-center gap-3">
					<div className="relative w-full sm:w-72">
						<Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
						<input
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search company…"
							className="h-9 w-full rounded-md border border-border bg-background ps-8 pe-3 text-sm"
						/>
					</div>

					{/* Sort + export, pushed to the end on wider screens. */}
					<div className="flex items-center gap-2 sm:ms-auto">
						<div className="inline-flex rounded-md border border-border p-0.5 text-xs">
							{(
								[
									["people", "Most people"],
									["company", "A-Z"],
								] as [SortKey, string][]
							).map(([key, label]) => (
								<button
									key={key}
									type="button"
									onClick={() => setSort(key)}
									className={cn(
										"rounded px-2.5 py-1 transition-colors",
										sort === key
											? "bg-foreground text-background"
											: "text-muted-foreground hover:text-foreground",
									)}
								>
									{label}
								</button>
							))}
						</div>
						<button
							type="button"
							onClick={exportCsv}
							disabled={rows.length === 0}
							className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50"
						>
							Export CSV
						</button>
					</div>
				</div>

				<div className="flex flex-wrap items-center gap-1.5">
					{/* Tier chips */}
					<button
						type="button"
						onClick={() => setTier("")}
						className={cn(
							"rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
							tier === ""
								? "border-foreground bg-foreground text-background"
								: "border-border text-muted-foreground hover:bg-muted",
						)}
					>
						All tiers {facets.total.toLocaleString()}
					</button>
					{facets.tiers.map((t) => (
						<button
							key={t.key}
							type="button"
							onClick={() => setTier(tier === t.key ? "" : t.key)}
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
							<span className="tabular-nums">
								{(facets.tierCounts.get(t.key) ?? 0).toLocaleString()}
							</span>
						</button>
					))}

					<span className="mx-1 h-5 w-px self-center bg-border" />

					{/* Email-status filters: "Needs email" is the enrichment worklist. */}
					{(
						[
							["all", "All", facets.total],
							["email", "With email", facets.withEmail],
							["noemail", "Needs email", facets.noEmail],
						] as [StatusFilter, string, number][]
					).map(([key, label, count]) => (
						<button
							key={key}
							type="button"
							onClick={() => setStatus(key)}
							className={cn(
								"rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
								status === key
									? "border-foreground bg-foreground text-background"
									: "border-border text-muted-foreground hover:bg-muted",
							)}
						>
							{label} {count.toLocaleString()}
						</button>
					))}
				</div>
			</div>

			{/* Grid */}
			{list.isLoading ? (
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{[0, 1, 2, 3, 4, 5].map((i) => (
						<Skeleton key={i} className="h-36 w-full rounded-xl" />
					))}
				</div>
			) : list.error ? (
				<p className="text-sm text-destructive">
					Could not load attendees: {(list.error as Error).message}
				</p>
			) : rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{all.length === 0
						? "No attendees have been loaded for this show yet."
						: "No companies match these filters."}
				</p>
			) : (
				<div
					className={cn(
						"grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3",
						list.isFetching && "opacity-60 transition-opacity",
					)}
				>
					{rows.map((a) => (
						<CompanyTile key={a.id} a={a} onOpen={() => setOpen(a)} />
					))}
				</div>
			)}

			<CompanyDetailSheet account={open} onClose={() => setOpen(null)} />
		</div>
	);
}
