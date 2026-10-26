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
					Companies are researched one by one: an AI researcher looks each
					up on the web and records what it does, how it relates to Knape
					(customer, equipment maker, partner, competitor or none of these)
					and how well it fits what Knape sells. The tier follows from those
					answers by the fixed rules below; opening a company shows the
					research notes. A company not researched yet stays T4 Enrich. The
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
