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
 * gives the headline tiles without a second request, and keeps the whole view
 * under the endpoint's 2,000-row page cap.
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
import { tierByKey } from "@/lib/events/registry";

/** One page covers the whole attendee pool: well under the endpoint's 2,000 cap. */
const PAGE_SIZE = 2000;

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
	const [open, setOpen] = useState<Account | null>(null);

	const list = useQuery({
		queryKey: ["events", "attendees", slug],
		queryFn: () =>
			leadgen.get<AccountsResponse>("/api/accounts", {
				data_batch: slug,
				mode: "accounts",
				contact_filter: "has",
				min_icp: 0,
				sort: "icp",
				page: 1,
				page_size: PAGE_SIZE,
			}),
	});

	const all: Account[] =
		list.data && list.data.mode === "accounts" ? list.data.items : [];

	const totals = useMemo(() => {
		let people = 0;
		let withEmail = 0;
		for (const a of all) {
			people += a.contacts_count ?? 0;
			withEmail += a.emails_count ?? 0;
		}
		return { companies: all.length, people, withEmail };
	}, [all]);

	const rows = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return all;
		return all.filter((a) => a.company.toLowerCase().includes(q));
	}, [all, search]);

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
				<Stat
					label="Companies"
					value={totals.companies}
					hint="Each company once."
				/>
				<Stat
					label="People"
					value={totals.people}
					hint="Registered attendees."
				/>
				<Stat
					label="With email"
					value={totals.withEmail}
					hint="Addresses that can be sent to."
				/>
			</div>

			{/* Toolbar */}
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
				<button
					type="button"
					onClick={exportCsv}
					disabled={rows.length === 0}
					className="ms-auto inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-50"
				>
					Export CSV
				</button>
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
						: "No companies match that search."}
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
