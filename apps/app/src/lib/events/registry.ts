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
	{
		slug: "semicon-2026",
		name: "SEMICON West 2026",
		shortName: "SEMICON West",
		vertical: "Semiconductor",
		location: "Moscone Center, San Francisco, CA",
		dates: "Oct 2026",
		status: "post-show",
		description:
			"The 842 exhibitors from the public SEMICON West 2026 directory, each with its booth and website. The people registered through the show's portal are under Attendees.",
		accentClass: "bg-cyan-500",
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

// `hint` is client-facing: it is the tooltip on every tier chip and the text of
// the "What do the tiers mean?" legend.
//
// The hints describe how tiers were ACTUALLY assigned, not the score fallback
// in the cockpit's _effective_tier_sql: every WorkBoat 2026 company carries an
// icp_score of 0, and its tier was written by a research pass on 24 Oct 2026.
// That pass had an AI researcher look each company up on the web and record
// what it does, its relationship to Knape (end customer, OEM, partner
// manufacturer, competitor, other) and a fit rating (Excellent / Good / Weak /
// Poor). The tier then follows by fixed rules: partner -> T3, competitor -> X,
// school/university name or domain -> Academic, Excellent -> T0 with 3+ people
// registered else T1, Good (or Weak end customer/OEM) -> T2, rest -> Other.
// The per-company reason is stored in accounts.spark_brief and shown in the
// company sheet. Keep these hints in step with that rule set.
export const TIERS: TierDef[] = [
	{
		key: "T0-HOT",
		label: "T0 Hot",
		hint: "Excellent fit (shipyard, vessel or fleet operator, naval architect, marine engineering firm, marine HVAC or mechanical contractor, offshore operator) with 3 or more people registered at the show. Contact first.",
		chipClass: ROSE,
	},
	{
		key: "T1-WARM",
		label: "T1 Warm",
		hint: "Same excellent fit as T0, but fewer than 3 people registered at the show.",
		chipClass: AMBER,
	},
	{
		key: "T2-ICP",
		label: "T2 ICP",
		hint: "Good fit with the ideal customer profile (ICP): a plausible buyer with a real need for fans, blowers, heaters or dampers, or an equipment maker that builds them into its products. Also smaller or indirect buyers.",
		chipClass: EMERALD,
	},
	{
		key: "T3-PARTNER",
		label: "T3 Partner",
		hint: "A manufacturer Knape already represents. Not a prospect.",
		chipClass: VIOLET,
	},
	{
		key: "T4-UNKNOWN",
		label: "T4 Enrich",
		hint: "Not researched yet, so there is nothing to rank it on.",
		chipClass: SKY,
	},
	{
		key: "X-COMPETITOR",
		label: "Competitor",
		hint: "Another air-movement or ventilation rep or distributor, or a maker of competing fans, blowers, dampers, louvers or heaters.",
		chipClass: ZINC,
		excluded: true,
	},
	{
		key: "X-ACADEMIC",
		label: "Academic",
		hint: "A school, college or university, going by its name or website.",
		chipClass: ZINC,
		excluded: true,
	},
	{
		key: "X-OTHER",
		label: "Other",
		hint: "No plausible need for the equipment: insurance, finance, law, staffing, media, software, associations, and government agencies that buy through procurement contracts.",
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
