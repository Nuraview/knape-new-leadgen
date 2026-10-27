/**
 * The coloured tier pill used in the Events table and on the overview cards.
 *
 * Colour and label come from lib/events/registry.ts, so the chip always agrees
 * with the cockpit's effective tier. An unknown key renders as a neutral
 * "Unclassified" chip rather than throwing.
 */
import { cn } from "@/lib/cn";
import { TIERS, tierByKey } from "@/lib/events/registry";

export function TierChip({
	tierKey,
	className,
}: {
	tierKey: string | null | undefined;
	className?: string;
}) {
	const def = tierByKey(tierKey);
	return (
		<span
			title={def.hint}
			className={cn(
				"inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
				def.chipClass,
				className,
			)}
		>
			{def.label}
		</span>
	);
}

// Tint for the justification banner, per tier. Full literal class strings so
// Tailwind generates them (see the note on the chip colours in registry.ts).
// Only the target tiers get a banner: for Partner/Other/Competitor the reason
// is a "why not", which belongs in the company sheet, not on the card.
const REASON_TINT: Record<string, string> = {
	"T0-HOT": "border-l-rose-500 bg-rose-500/10",
	"T1-WARM": "border-l-amber-500 bg-amber-500/10",
	"T2-ICP": "border-l-emerald-500 bg-emerald-500/10",
};

/**
 * The research pass's one-sentence "why this tier" for a Hot, Warm or ICP lead:
 * a tinted line clamped to two lines, with the full text on hover. Renders
 * nothing for other tiers or when the account has no reason recorded.
 */
export function TierReason({
	tierKey,
	reason,
	className,
}: {
	tierKey: string | null | undefined;
	reason: string | null | undefined;
	className?: string;
}) {
	const def = tierByKey(tierKey);
	const text = (reason ?? "").trim();
	const tint = REASON_TINT[def.key];
	if (!text || !tint) return null;
	return (
		// A span (display: block via line-clamp), not a <p>: it sits inside the
		// card <button> and the table row <a>, which only allow phrasing content.
		<span
			title={text}
			className={cn(
				"line-clamp-2 min-w-0 break-words rounded-r-md border-l-2 px-2 py-1 text-left text-xs leading-snug text-foreground/80",
				tint,
				className,
			)}
		>
			<span className="font-medium text-foreground">
				Why {def.label}:
			</span>{" "}
			{text}
		</span>
	);
}

/**
 * The company profile minus a trailing copy of the tier reason. The WorkBoat
 * research pass (24 Oct 2026) wrote "<description> <reason>" into the profile
 * before the reason had its own field, so where both are shown the reason
 * would otherwise appear twice.
 */
export function profileWithoutReason(
	profile: string | null | undefined,
	reason: string | null | undefined,
): string {
	const p = (profile ?? "").trim();
	const r = (reason ?? "").trim();
	if (r && p.endsWith(r)) return p.slice(0, p.length - r.length).trim();
	return p;
}

/**
 * The plain-language key to the tier chips. A tooltip is invisible until
 * someone thinks to hover, and the client read "T2 ICP" as jargon, so the
 * meanings sit one click away under every tier filter row.
 */
export function TierLegend({ className }: { className?: string }) {
	return (
		<details className={cn("text-xs", className)}>
			<summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">
				What do the tiers mean?
			</summary>
			<div className="mt-2 max-w-3xl space-y-1.5 rounded-md border border-border bg-muted/30 p-3">
				<p className="text-muted-foreground">
					Companies are researched one by one: an AI researcher looks each
					up on the web and records what it does, how it relates to Knape
					(customer, equipment maker, partner, competitor or none of these)
					and how well it fits what Knape sells, with a one-line reason.
					The tier follows from those answers by the fixed rules below, and
					Hot, Warm and ICP companies show that reason under their name.
					WorkBoat was researched on 24 Oct 2026, WEFTEC and SEMICON West on
					27 Oct 2026. A company not researched yet stays T4 Enrich. The
					five bars on a card show its tier.
				</p>
				<ul className="space-y-1">
					{TIERS.map((t) => (
						<li key={t.key} className="flex items-start gap-2">
							<TierChip tierKey={t.key} className="mt-px shrink-0" />
							<span>{t.hint}</span>
						</li>
					))}
				</ul>
			</div>
		</details>
	);
}
