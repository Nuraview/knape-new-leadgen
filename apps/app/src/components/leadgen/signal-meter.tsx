/**
 * Five-bar signal-strength meter for the Attendees company cards.
 *
 * Ported from the tec5 lead-gen app (components/cd/company/signal-meter.tsx) and
 * restyled to this app's tokens. The value is 0 to 5; here it is derived from a
 * company's effective tier (see signalFromTier in company-grid.tsx), so a card
 * reads its strength at a glance the way the tec5 show list did.
 */
import { cn } from "@/lib/cn";

export function SignalMeter({
	value,
	showLabel = false,
	className,
}: {
	value: number;
	showLabel?: boolean;
	className?: string;
}) {
	const v = Math.max(0, Math.min(5, Math.round(value)));
	// Warmer bars for stronger signal, so a glance separates hot from cold
	// without reading the number.
	const fill =
		v >= 4
			? "bg-emerald-500"
			: v >= 2
				? "bg-amber-500"
				: "bg-foreground/40";
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 text-[12px] text-muted-foreground",
				className,
			)}
			aria-label={`Signal strength ${v} of 5`}
		>
			<span className="flex gap-0.5">
				{Array.from({ length: 5 }, (_, i) => (
					<span
						key={i}
						className={cn(
							"h-3 w-1 rounded-full",
							i < v ? fill : "bg-foreground/10",
						)}
					/>
				))}
			</span>
			{showLabel ? <span>Strength {v}/5</span> : null}
		</span>
	);
}
