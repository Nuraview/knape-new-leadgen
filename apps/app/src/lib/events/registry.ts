/**
 * Events registry: the trade shows the Events section knows about, and the
 * tier scheme its table uses.
 *
 * Ported in spirit from the tec5 lead-gen app (frontend/lib/events/registry.ts),
 * restyled to this app's tokens. Events live here rather than in the cockpit for
 * the same reason they do there: a show has a name, a vertical, a venue and dates
 * that the lead table does not store, and every show should appear the moment the
 * team starts preparing for it, before a single lead is collected. The overview
 * merges these definitions with the live counts from GET /api/events, so WorkBoat
 * shows as an empty, planned event until its exhibitors and booth scans land.
 *
 * TIERS mirror the cockpit's effective tier (_effective_tier_sql in
 * cockpit_api.py): T0–T2 and T4 are the live buckets, T3 Partner is set by hand,
 * and the X-* tiers are classifications kept out of outreach.
 */

export interface EventDef {
	/** Matches the cockpit slug: lead_source_bucket = "event:<slug>". */
	slug: string;
	name: string;
	shortName: string;
	vertical: string;
	location: string;
	dates: string;
	status: "post-show" | "planning" | "upcoming";
	description: string;
	/** Tailwind bg-* for the 1.5px accent bar on the card. */
	accentClass: string;
}

export interface TierDef {
	key: string;
	label: string;
	hint: string;
	/** Tailwind classes for the chip, following bg-{c}-500/15 text-{c}-600 … */
	chipClass: string;
	/** Classifications we keep but do not contact. */
	excluded?: boolean;
}

export const EVENTS: EventDef[] = [
	{
		slug: "weftec-2026",
		name: "WEFTEC 2026",
		shortName: "WEFTEC",
		vertical: "Water & Wastewater",
		location: "Chicago, IL",
		dates: "Oct 2026",
		status: "post-show",
		description:
			"Water Environment Federation's technical exhibition. Exhibitors from the public directory plus the team's own booth scans.",
		accentClass: "bg-sky-500",
	},
	{
		slug: "workboat-2026",
		name: "WorkBoat 2026",
		shortName: "WorkBoat",
		vertical: "Marine & Workboat",
		location: "New Orleans, LA",
		dates: "Dec 2026",
		status: "planning",
		description:
			"International WorkBoat Show. Prospecting from the prior show's returning exhibitors, collected closer to the event.",
		accentClass: "bg-orange-500",
	},
];

// Full literal class strings, NOT built at runtime: Tailwind v4 generates a
// utility only when it finds the whole class spelled out in the source, so a
// template like `bg-${c}-500/15` would compile to no colour at all.
const ROSE =
	"bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30";
const AMBER =
	"bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
const EMERALD =
	"bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
const VIOLET =
	"bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30";
const SKY = "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30";
const ZINC =
	"bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30";

export const TIERS: TierDef[] = [
	{
		key: "T0-HOT",
		label: "T0 Hot",
		hint: "Top-fit lead, contact first",
		chipClass: ROSE,
	},
	{ key: "T1-WARM", label: "T1 Warm", hint: "Strong fit", chipClass: AMBER },
	{
		key: "T2-ICP",
		label: "T2 ICP",
		hint: "In the ideal-customer profile",
		chipClass: EMERALD,
	},
	{
		key: "T3-PARTNER",
		label: "T3 Partner",
		hint: "Partner or channel",
		chipClass: VIOLET,
	},
	{
		key: "T4-UNKNOWN",
		label: "T4 Enrich",
		hint: "Not yet classified, needs enrichment",
		chipClass: SKY,
	},
	{
		key: "X-COMPETITOR",
		label: "Competitor",
		hint: "Kept out of outreach",
		chipClass: ZINC,
		excluded: true,
	},
	{
		key: "X-ACADEMIC",
		label: "Academic",
		hint: "Kept out of outreach",
		chipClass: ZINC,
		excluded: true,
	},
	{
		key: "X-OTHER",
		label: "Other",
		hint: "Kept out of outreach",
		chipClass: ZINC,
		excluded: true,
	},
];

const EVENTS_BY_SLUG = new Map(EVENTS.map((e) => [e.slug, e]));
const TIERS_BY_KEY = new Map(TIERS.map((t) => [t.key, t]));

export function eventBySlug(slug: string): EventDef | undefined {
	return EVENTS_BY_SLUG.get(slug);
}

const UNKNOWN_TIER: TierDef = {
	key: "T4-UNKNOWN",
	label: "Unclassified",
	hint: "No tier",
	chipClass: ZINC,
};

/** Never throws: an unknown key renders as a neutral "Unclassified" chip. */
export function tierByKey(key: string | null | undefined): TierDef {
	if (!key) return UNKNOWN_TIER;
	return TIERS_BY_KEY.get(key.toUpperCase()) ?? { ...UNKNOWN_TIER, label: key };
}
