/**
 * The slide-over that opens when an Attendees company card is clicked.
 *
 * The grid shows one card per company with its headline counts; the people
 * themselves are loaded only when a card is opened, from the cockpit's
 * GET /api/accounts/{id}/contacts. That keeps the grid to a single request for
 * the whole pool and fetches a company's roster on demand.
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Mail, Phone } from "lucide-react";
import {
	profileWithoutReason,
	TierChip,
} from "@/components/leadgen/tier-chip";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";
import type { Account, Person } from "@/fetchers/leadgen/types";
import { tierByKey } from "@/lib/events/registry";

type ContactsResponse = { items: Person[] };

function cleanHost(website: string): string {
	try {
		return new URL(website).host.replace(/^www\./, "");
	} catch {
		return website;
	}
}

export function CompanyDetailSheet({
	account,
	onClose,
}: {
	account: Account | null;
	onClose: () => void;
}) {
	const open = account !== null;
	const id = account?.id;

	const people = useQuery({
		queryKey: ["events", "account-contacts", id],
		queryFn: () => leadgen.get<ContactsResponse>(`/api/accounts/${id}/contacts`),
		enabled: open && id !== undefined,
	});

	const rows = people.data?.items ?? [];
	const reason = (account?.tier_reason ?? "").trim();
	const about = profileWithoutReason(account?.company_profile, reason);

	return (
		<Sheet open={open} onOpenChange={(o) => !o && onClose()}>
			<SheetContent side="right" className="w-full sm:max-w-md">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						{account?.company ?? ""}
						{account?.tier ? <TierChip tierKey={account.tier} /> : null}
					</SheetTitle>
					<SheetDescription>
						{account?.website ? (
							<a
								href={account.website}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1 hover:text-foreground"
							>
								{cleanHost(account.website)}
								<ExternalLink className="size-3" />
							</a>
						) : (
							(account?.segment ?? "Attendees")
						)}
					</SheetDescription>
				</SheetHeader>

				<div className="flex-1 overflow-y-auto px-4 pb-6">
					{/* The research notes behind the tier: why it does or does not
					    fit (every researched tier, so a "why not" is visible here
					    too), then what the company does. Exhibitors that already
					    had a directory blurb keep that text as the description. */}
					{reason ? (
						<div className="mb-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
							<div className="mb-1 font-medium text-xs text-muted-foreground">
								Why {tierByKey(account?.tier).label}
							</div>
							<p>{reason}</p>
						</div>
					) : null}
					{about ? (
						<div className="mb-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
							<div className="mb-1 font-medium text-xs text-muted-foreground">
								About this company{account?.industry ? ` · ${account.industry}` : ""}
							</div>
							<p>{about}</p>
						</div>
					) : null}
					{people.isLoading ? (
						<div className="flex flex-col gap-2">
							{[0, 1, 2, 3].map((i) => (
								<Skeleton key={i} className="h-12 w-full rounded-md" />
							))}
						</div>
					) : people.error ? (
						<p className="text-sm text-destructive">
							Could not load people: {(people.error as Error).message}
						</p>
					) : rows.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No people on file for this company.
						</p>
					) : (
						<ul className="divide-y divide-border">
							{rows.map((p) => (
								<li key={p.id} className="flex flex-col gap-1 py-3">
									<div className="flex items-baseline justify-between gap-2">
										<span className="font-medium text-sm">
											{p.person_name || "(no name)"}
										</span>
										{p.repeat_attendee ? (
											<span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] text-violet-500">
												Returning
											</span>
										) : null}
									</div>
									{p.job_title ? (
										<span className="text-xs text-muted-foreground">
											{p.job_title}
										</span>
									) : null}
									<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
										{p.email ? (
											<a
												href={`mailto:${p.email}`}
												className="inline-flex items-center gap-1 hover:text-foreground"
											>
												<Mail className="size-3" />
												{p.email}
											</a>
										) : null}
										{p.phone ? (
											<span className="inline-flex items-center gap-1">
												<Phone className="size-3" />
												{p.phone}
											</span>
										) : null}
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}
