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
					Each company gets a fit score from 0 to 10 for how closely it
					matches the kind of customer we sell to (the "ICP", ideal customer
					profile). The tier puts that score into plain words. On the
					attendee cards, the five bars show the tier too.
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
