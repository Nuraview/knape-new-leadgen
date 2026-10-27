/**
 * "Possible messaging angles" for one show: the per-show angle sets from the
 * cockpit (messaging_angles.EVENT_ANGLE_SETS), shown for the client's sign-off.
 *
 * Each angle lists its whole step ladder with the date every email would go
 * out (starting the next weekday after approval, and for a pre-show set
 * stopping before the doors open), and the selected step is rendered through
 * the production email template by EmailPreview, so what is approved is what
 * would land. Approve / Request changes only records a review in the cockpit:
 * nothing is drafted, queued or sent, and the show pools stay out of automatic
 * sending. The banner says so, because "Approve" next to an email reads like a
 * send button.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	CalendarDays,
	Check,
	ExternalLink,
	MessageSquareWarning,
	ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { EmailPreview } from "@/components/leadgen/email-preview";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { leadgen } from "@/fetchers/leadgen/client";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

type ReviewStatus = "pending" | "approved" | "changes_requested";

type AngleStep = {
	index: number;
	day: number | null;
	subject: string;
	body: string;
	send_date: string | null;
	skipped: boolean;
	delay_after_prev_days: number;
};

type EventAngle = {
	key: string;
	name: string;
	hook: string;
	link: { label: string; url: string };
	status: ReviewStatus;
	note: string;
	reviewed_by: string;
	reviewed_at: number | null;
	stale: boolean;
	start_date: string;
	start_basis: "approval" | "if_approved_today";
	steps: AngleStep[];
};

type EventAnglesResponse = {
	event: string;
	has_set: boolean;
	show?: string;
	show_dates?: [string, string];
	location?: string;
	send_before_show?: boolean;
	today?: string;
	landing?: {
		path: string;
		url: string;
		approved: boolean | null;
		fallback: string;
	};
	sample?: {
		company: string;
		person_name: string;
		job_title: string;
		location: string;
		source: "pool" | "static";
	};
	reach?: {
		pool: number;
		targetable: number;
		reachable: number;
		contacts_with_email: number;
		located: number;
		pool_tx_la: number;
		targetable_tx_la: number;
		reachable_tx_la: number;
		contacts_with_email_tx_la: number;
	};
	items: EventAngle[];
};

const STATUS_STYLE: Record<ReviewStatus, { label: string; cls: string }> = {
	pending: {
		label: "Pending review",
		cls: "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
	},
	approved: {
		label: "Approved",
		cls: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
	},
	changes_requested: {
		label: "Changes requested",
		cls: "border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-400",
	},
};

/** "2026-11-02" -> "Mon 2 Nov", read as a calendar date (no timezone shift). */
function fmtDate(iso: string | null | undefined): string {
	if (!iso) return "";
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(y, m - 1, d).toLocaleDateString("en-US", {
		weekday: "short",
		day: "numeric",
		month: "short",
	});
}

function fmtWhen(ts: number | null): string {
	if (!ts) return "";
	return new Date(ts * 1000).toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

function Stat({
	label,
	value,
	hint,
}: {
	label: string;
	value: number;
	hint?: string;
}) {
	return (
		<div className="rounded-lg border border-border px-3 py-2" title={hint}>
			<div className="text-[11px] uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div className="font-semibold text-lg tabular-nums">
				{value.toLocaleString()}
			</div>
		</div>
	);
}

function AngleCard({
	slug,
	angle,
	defaultOpen,
}: {
	slug: string;
	angle: EventAngle;
	defaultOpen: boolean;
}) {
	const qc = useQueryClient();
	const [open, setOpen] = useState(defaultOpen);
	const [stepIdx, setStepIdx] = useState(0);
	const [asking, setAsking] = useState(false);
	const [note, setNote] = useState("");

	const review = useMutation({
		mutationFn: (input: { status: ReviewStatus; note?: string }) =>
			leadgen.post(`/api/emails/angles/${angle.key}/review`, {
				event: slug,
				status: input.status,
				note: input.note ?? "",
			}),
		onSuccess: (_d, input) => {
			setAsking(false);
			setNote("");
			toast.success(
				input.status === "approved"
					? `"${angle.name}" approved. Nothing has been sent.`
					: input.status === "changes_requested"
						? `Change request saved for "${angle.name}".`
						: `"${angle.name}" is back to pending.`,
			);
			qc.invalidateQueries({ queryKey: ["leadgen", "event-angles", slug] });
		},
		onError: (e) => toast.error((e as Error).message),
	});

	const st = STATUS_STYLE[angle.status] ?? STATUS_STYLE.pending;
	const live = angle.steps.filter((s) => !s.skipped);
	const step = angle.steps[stepIdx] ?? angle.steps[0];
	const last = live[live.length - 1];

	return (
		<li className="overflow-hidden rounded-xl border border-border">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-start hover:bg-muted/40"
			>
				<span className="font-medium">{angle.name}</span>
				<span
					className={cn(
						"rounded-full border px-2 py-0.5 text-[11px] font-medium",
						st.cls,
					)}
				>
					{st.label}
				</span>
				{angle.stale ? (
					<span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">
						Copy changed since review
					</span>
				) : null}
				<span className="ms-auto text-xs text-muted-foreground">
					{live.length} emails · {fmtDate(live[0]?.send_date)} to{" "}
					{fmtDate(last?.send_date)}
				</span>
			</button>

			{open ? (
				<div className="border-t border-border px-4 py-4">
					<p className="text-sm text-muted-foreground">{angle.hook}</p>
					<p className="mt-2 text-xs text-muted-foreground">
						Link in every email:{" "}
						<a
							href={angle.link.url}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1 underline underline-offset-2"
						>
							{angle.link.url}
							<ExternalLink className="size-3" />
						</a>
					</p>

					{angle.status !== "pending" && (angle.reviewed_by || angle.note) ? (
						<div
							className={cn(
								"mt-3 rounded-lg border px-3 py-2 text-sm",
								angle.status === "approved"
									? "border-emerald-500/30 bg-emerald-500/5"
									: "border-amber-500/30 bg-amber-500/5",
							)}
						>
							<div className="text-xs text-muted-foreground">
								{st.label}
								{angle.reviewed_by ? ` by ${angle.reviewed_by}` : ""}
								{angle.reviewed_at ? ` on ${fmtWhen(angle.reviewed_at)}` : ""}
							</div>
							{angle.note ? (
								<p className="mt-1 whitespace-pre-wrap">{angle.note}</p>
							) : null}
						</div>
					) : null}

					<div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
						{/* The ladder */}
						<div>
							<div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
								<CalendarDays className="size-3.5" />
								{angle.start_basis === "approval"
									? `Dated from approval: first email ${fmtDate(angle.start_date)}`
									: `If approved today, first email ${fmtDate(angle.start_date)}`}
							</div>
							<ol className="space-y-1">
								{angle.steps.map((s, i) => (
									<li key={s.index}>
										<button
											type="button"
											onClick={() => setStepIdx(i)}
											className={cn(
												"w-full rounded-md border px-2.5 py-2 text-start text-sm transition-colors",
												i === stepIdx
													? "border-foreground/40 bg-muted"
													: "border-border hover:bg-muted/50",
												s.skipped && "opacity-60",
											)}
										>
											<div className="flex items-center gap-2 text-[11px] text-muted-foreground">
												<span className="font-medium">
													{i === 0 ? "Opener" : `Follow-up ${i}`}
												</span>
												<span className="ms-auto tabular-nums">
													{s.skipped
														? "Skipped: no room before the show"
														: fmtDate(s.send_date)}
												</span>
											</div>
											<div
												className={cn(
													"mt-0.5 truncate",
													s.skipped && "line-through",
												)}
											>
												{s.subject}
											</div>
										</button>
									</li>
								))}
							</ol>
						</div>

						{/* The selected step, as it would land */}
						<div className="min-w-0">
							{step ? (
								<>
									<div className="mb-2 text-sm">
										<span className="text-muted-foreground">Subject: </span>
										<span className="font-medium">{step.subject}</span>
									</div>
									<EmailPreview
										body={step.body}
										angle={angle.key}
										stepIndex={step.index}
									/>
								</>
							) : null}
						</div>
					</div>

					{/* Review */}
					<div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
						{asking ? (
							<>
								<Textarea
									value={note}
									onChange={(e) => setNote(e.target.value)}
									placeholder="What should change? e.g. drop follow-up 3, softer opener, mention dust collection…"
									rows={3}
								/>
								<div className="flex flex-wrap gap-2">
									<Button
										variant="outline"
										disabled={!note.trim() || review.isPending}
										onClick={() =>
											review.mutate({ status: "changes_requested", note })
										}
									>
										<MessageSquareWarning className="size-4" />
										Save change request
									</Button>
									<Button variant="ghost" onClick={() => setAsking(false)}>
										Cancel
									</Button>
								</div>
							</>
						) : (
							<div className="flex flex-wrap items-center gap-2">
								<Button
									disabled={angle.status === "approved" || review.isPending}
									onClick={() => review.mutate({ status: "approved" })}
								>
									<Check className="size-4" />
									{angle.status === "approved" ? "Approved" : "Approve"}
								</Button>
								<Button
									variant="outline"
									disabled={review.isPending}
									onClick={() => {
										setNote(angle.status === "changes_requested" ? angle.note : "");
										setAsking(true);
									}}
								>
									<MessageSquareWarning className="size-4" />
									Request changes
								</Button>
								{angle.status !== "pending" ? (
									<Button
										variant="ghost"
										disabled={review.isPending}
										onClick={() => review.mutate({ status: "pending" })}
									>
										Reset to pending
									</Button>
								) : null}
								<span className="text-xs text-muted-foreground">
									Approving records your sign-off only. No email is sent.
								</span>
							</div>
						)}
					</div>
				</div>
			) : null}
		</li>
	);
}

export function EventAngles({ slug }: { slug: string }) {
	const q = useQuery({
		queryKey: ["leadgen", "event-angles", slug],
		queryFn: () =>
			leadgen.get<EventAnglesResponse>("/api/emails/angles", { event: slug }),
	});

	if (q.isLoading) {
		return (
			<div className="flex flex-col gap-2 px-3 py-4 sm:px-5">
				{[0, 1, 2].map((i) => (
					<Skeleton key={i} className="h-14 w-full rounded-xl" />
				))}
			</div>
		);
	}
	if (q.error) {
		return (
			<p className="px-3 py-4 text-sm text-destructive sm:px-5">
				Could not load the messaging angles: {(q.error as Error).message}
			</p>
		);
	}
	const d = q.data;
	if (!d?.has_set || d.items.length === 0) {
		return (
			<p className="px-3 py-4 text-sm text-muted-foreground sm:px-5">
				No messaging angles have been drafted for this show yet.
			</p>
		);
	}

	const r = d.reach;
	const showLocal = Boolean(r && r.located > 0);
	const approved = d.items.filter((a) => a.status === "approved").length;

	return (
		<div className="flex flex-col gap-4 px-3 py-4 sm:px-5">
			<div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2.5 text-sm">
				<ShieldCheck className="mt-0.5 size-4 shrink-0 text-sky-600" />
				<p>
					<span className="font-medium">Review only.</span> Approving an angle
					records your sign-off on the copy and the schedule. It does not
					draft, queue or send any email, and this show's leads stay out of
					automatic sending.
				</p>
			</div>

			<div className="flex flex-col gap-1 text-sm">
				<div>
					<span className="font-medium">{d.show}</span>
					<span className="text-muted-foreground">
						{" "}
						· {fmtDate(d.show_dates?.[0])} to {fmtDate(d.show_dates?.[1])},{" "}
						{d.location}
					</span>
				</div>
				<div className="text-muted-foreground">
					{d.send_before_show
						? "Pre-show sequence: 1-2 emails a week, the last one before the show opens. Weekends and Thanksgiving are skipped."
						: "Post-show follow-up sequence. Weekends and Thanksgiving are skipped."}{" "}
					{approved}/{d.items.length} angles approved.
				</div>
				{d.sample ? (
					<div className="text-muted-foreground">
						Previewed for{" "}
						<span className="text-foreground">
							{d.sample.person_name}
							{d.sample.job_title ? `, ${d.sample.job_title}` : ""} at{" "}
							{d.sample.company}
							{d.sample.location ? ` (${d.sample.location})` : ""}
						</span>
						{d.sample.source === "pool"
							? ", a lead from this show's pool."
							: ", an illustrative sample."}
					</div>
				) : null}
			</div>

			{d.landing?.path ? (
				d.landing.approved ? (
					<div className="text-sm">
						Landing page linked from every email:{" "}
						<a
							href={d.landing.url}
							target="_blank"
							rel="noreferrer"
							className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
						>
							{d.landing.url.replace(/^https?:\/\//, "")}
							<ExternalLink className="size-3" />
						</a>
					</div>
				) : (
					<div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-sm">
						<AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
						<p>
							The show landing page ({d.landing.path}) is not on the approved
							links list yet, so these emails link to {d.landing.fallback}{" "}
							instead.
						</p>
					</div>
				)
			) : null}

			{r ? (
				<div>
					<div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Who this would reach
					</div>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
						<Stat label="Companies in pool" value={r.pool} />
						<Stat
							label="Not excluded"
							value={r.targetable}
							hint="Leaves out partner manufacturers, competitors, schools and unrelated companies."
						/>
						<Stat
							label="With an email"
							value={r.reachable}
							hint="Companies (not excluded) with at least one contact email."
						/>
						<Stat
							label="People with email"
							value={r.contacts_with_email}
							hint="Distinct contact emails at those companies."
						/>
						{showLocal ? (
							<>
								<Stat
									label="In TX / LA"
									value={r.targetable_tx_la}
									hint="Not-excluded companies whose location is Texas or Louisiana."
								/>
								<Stat
									label="TX / LA with email"
									value={r.reachable_tx_la}
								/>
								<Stat
									label="TX / LA people"
									value={r.contacts_with_email_tx_la}
								/>
							</>
						) : null}
					</div>
				</div>
			) : null}

			<ul className="flex flex-col gap-2">
				{d.items.map((a, i) => (
					<AngleCard key={a.key} slug={slug} angle={a} defaultOpen={i === 0} />
				))}
			</ul>
		</div>
	);
}

export default EventAngles;
