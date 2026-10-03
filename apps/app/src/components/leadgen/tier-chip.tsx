/**
 * The coloured tier pill used in the Events table and on the overview cards.
 *
 * Colour and label come from lib/events/registry.ts, so the chip always agrees
 * with the cockpit's effective tier. An unknown key renders as a neutral
 * "Unclassified" chip rather than throwing.
 */
import { cn } from "@/lib/cn";
import { tierByKey } from "@/lib/events/registry";

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
