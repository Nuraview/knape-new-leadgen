/**
 * The house proposal: the design and the boilerplate an AI draft inherits
 * rather than invents.
 *
 * Every real proposal in this database is the same document with the middle
 * swapped out. Proposals 1017 and 1021 carry byte-identical "Service Terms"
 * (1118 chars), "Cancellation & Refund Policy" (720) and "General Terms"
 * (1163) sections, the same four LinkedIn recommendations, and the same
 * `creative-branded` / #c2410c design. Only the overview, scope, pricing and
 * timeline change per deal.
 *
 * So the model writes the middle and nothing else. Two reasons, and the second
 * is the important one:
 *
 *   1. Terms are legal text somebody signed off on. A model paraphrasing the
 *      refund formula each time produces a document that says something
 *      slightly different from the last one, which is how a client ends up
 *      holding a refund policy nobody at the company has read.
 *   2. THE TESTIMONIALS ARE REAL NAMED PEOPLE — an Emmy-winning producer, a
 *      marketing director, two founders. Letting a model near them invites it
 *      to reword, re-attribute or invent an endorsement. That is fabricating a
 *      quote from a real person. They are copied byte for byte or not at all.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import crmDb from "../../database/crm";
import { crmProposals } from "../../database/crm-schema";
import { isBoilerplate } from "./normalize";
import { buildProjectTerms, isRetainerOnly } from "./house-terms";

export type HouseTemplate = {
  sourceNumber: number | null;
  theme: string | null;
  designPresetId: string | null;
  designTokens: unknown;
  brandColor: string | null;
  portfolioConfig: unknown;
  /** Copied verbatim onto every draft, in their original relative order. */
  boilerplateSections: Array<Record<string, unknown>>;
};

/** What a database with no usable proposal yet gets. Matches design-presets. */
const FALLBACK: HouseTemplate = {
  sourceNumber: null,
  theme: "creative",
  designPresetId: "creative-branded",
  designTokens: {
    accentColor: "#c2410c",
    fontDisplay: "serif",
    fontBody: "sans",
    bg: "#f7f4ef",
    layout: "centered",
  },
  brandColor: "#c2410c",
  portfolioConfig: null,
  boilerplateSections: [],
};

/**
 * Find the proposal to inherit from.
 *
 * Preference order:
 *   1. An explicit template (`isTemplate`) — so "Save as template" in the UI is
 *      how the house document gets updated, with no deploy.
 *   2. Failing that, the richest recent real proposal that has a design preset
 *      set. There are no templates in the database today, and hardcoding the
 *      boilerplate into this file would mean a code change every time the
 *      refund policy is reworded.
 *
 * `PROPOSAL_TEMPLATE_NUMBER` overrides both, for pinning a known-good one.
 */
export async function loadHouseTemplate(): Promise<HouseTemplate> {
  const pinned = Number(process.env.PROPOSAL_TEMPLATE_NUMBER);

  const [row] = await crmDb
    .select({
      number: crmProposals.number,
      theme: crmProposals.theme,
      designPresetId: crmProposals.designPresetId,
      designTokens: crmProposals.designTokens,
      brandColor: crmProposals.brandColor,
      portfolioConfig: crmProposals.portfolioConfig,
      sections: crmProposals.sections,
    })
    .from(crmProposals)
    .where(
      and(
        isNull(crmProposals.deletedAt),
        Number.isFinite(pinned) && pinned > 0
          ? eq(crmProposals.number, pinned)
          : sql`(${crmProposals.isTemplate} = true OR (${crmProposals.designPresetId} IS NOT NULL AND jsonb_array_length(COALESCE(${crmProposals.sections}, '[]'::jsonb)) >= 6))`,
      ),
    )
    // Templates first, then the section-richest, then the most recent.
    .orderBy(
      desc(crmProposals.isTemplate),
      desc(sql`jsonb_array_length(COALESCE(${crmProposals.sections}, '[]'::jsonb))`),
      desc(crmProposals.updatedAt),
    )
    .limit(1);

  if (!row) return FALLBACK;

  const sections = Array.isArray(row.sections)
    ? (row.sections as Array<Record<string, unknown>>)
    : [];

  return {
    sourceNumber: row.number,
    theme: row.theme ?? FALLBACK.theme,
    designPresetId: row.designPresetId ?? FALLBACK.designPresetId,
    designTokens: row.designTokens ?? FALLBACK.designTokens,
    brandColor: row.brandColor ?? FALLBACK.brandColor,
    portfolioConfig: row.portfolioConfig ?? null,
    boilerplateSections: sections.filter(isBoilerplate),
  };
}

/**
 * The boilerplate that belongs on THIS proposal.
 *
 * The house document is a monthly retainer, so copying it wholesale onto a
 * fixed-price project attached a pro-rata refund calculation and a clause about
 * "one active campaign thread at a time" to a one-off job. VK, 31 July: "you
 * have taken that from Peter's proposal, which doesn't make sense here."
 *
 * A retainer proposal keeps everything. A project proposal keeps whatever is
 * engagement-neutral — the general terms, the testimonials — and gets project
 * service terms with the fair-use clause in place of the retainer ones.
 */
export function boilerplateFor(
  house: HouseTemplate,
  kind: "PROJECT" | "RETAINER",
): Array<Record<string, unknown>> {
  if (kind === "RETAINER") return house.boilerplateSections;

  const projectTerms = buildProjectTerms();
  const replaced = new Set(
    projectTerms.map((s) => String(s.title ?? "").toLowerCase()),
  );

  const neutral = house.boilerplateSections.filter(
    (s) =>
      !isRetainerOnly(s) &&
      // A house whose service terms happen to be engagement-neutral would
      // otherwise survive the filter and sit next to the project ones under
      // the same heading. The project version wins.
      !replaced.has(String(s.title ?? "").toLowerCase()),
  );

  /*
   * Service terms first, then the neutral house sections. Testimonials stay
   * last wherever they came in the source document — they close the proposal,
   * and a recommendation after the terms reads better than one before them.
   */
  const testimonials = neutral.filter((s) => s.type === "testimonials");
  const rest = neutral.filter((s) => s.type !== "testimonials");

  return [...projectTerms, ...rest, ...testimonials];
}

export { FALLBACK as FALLBACK_HOUSE_TEMPLATE };
