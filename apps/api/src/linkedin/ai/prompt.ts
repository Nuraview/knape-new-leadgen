/**
 * The voice a drafted post has to come out in, and what it may talk about.
 *
 * The style rules carry over from the outreach voice: no hype, no invented
 * numbers, no em dashes. The email-shaped ones (a greeting, a sign-off) do not,
 * because a feed post has no recipient.
 *
 * WHY THE BUSINESS IS READ FROM ENV
 *
 * This file used to open with a paragraph naming one client, their product and
 * their buyers. That paragraph is the single most load-bearing line in the
 * prompt — everything the model writes is downstream of it — so on any other
 * instance the drafter confidently produced posts about somebody else's product,
 * signed with somebody else's name, aimed at somebody else's buyers. It was not
 * subtly wrong; it was a different company's marketing.
 *
 * So the two facts that change per instance are configuration:
 *
 *   BRAND_BUSINESS_BRIEF  what this business sells, in a sentence or two
 *   BRAND_AUDIENCE_BRIEF  who buys it and how they buy
 *
 * The author's name comes from the brand signature, which every other outbound
 * surface already uses. Unset, the prompt says plainly that it does not know —
 * a model told "you do not know the product" writes something cautious and
 * generic, which is recoverable. A model told the WRONG product writes something
 * fluent and false, which is not.
 */
import getBrand from "../../utils/get-brand";

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function linkedinHouseStyle(): string {
  const brand = getBrand();
  const author = brand.signature.personName || brand.name;

  return [
    "HOUSE STYLE — match this exactly:",
    "- The first two lines are the whole ballgame. LinkedIn hides everything after about three lines behind 'see more', so the hook has to land there. Never open with throat-clearing ('I wanted to share...', 'Excited to announce...').",
    "- Short paragraphs, one to three sentences each, blank line between them. Plain text only: no markdown, no headers, no bullet characters, no emojis.",
    "- Voice: direct, human, confident, lightly contrarian. Write from the reader's world (their plant, their project, their budget, their deadline) before the product.",
    "- No hype words, no exclamation-mark selling, no invented statistics, no pricing promises, no corporate filler.",
    "- NEVER use em dashes or en dashes. They read as AI-written. Use commas, periods or parentheses instead. Regular hyphens in compound words (air-handling, 20-year) are fine.",
    `- ${author} writes as one person talking to peers, not as a company. No 'we are thrilled'.`,
    "- End with one low-pressure question or next step. One call to action, not three.",
    "- If hashtags fit, at most five, on the final line, and only ones a real person would search.",
    "- Do not sign the post. It is already on the author's profile.",
    "- Under 3000 characters. Aim for 900 to 1600: long enough to say something, short enough to finish.",
  ].join("\n");
}

export function systemPrompt(): string {
  const brand = getBrand();
  const author = brand.signature.personName || brand.name;
  const business = env("BRAND_BUSINESS_BRIEF");
  const audience = env("BRAND_AUDIENCE_BRIEF");

  const opening = business
    ? `You write LinkedIn posts for ${author} of ${brand.name}. ${business}`
    : `You write LinkedIn posts for ${author} of ${brand.name}. You have NOT been told what the business sells. Do not invent a product, a statistic or a customer. Write about the theme you are given from the author's own experience, and stop short of any specific claim.`;

  const readers = audience
    ? audience
    : `${author}'s audience on LinkedIn is prospective buyers and peers in the same industry.`;

  return [
    opening,
    "",
    `${readers} This is not an ad. The author is a practitioner posting something worth reading, and the product is at most the last beat of the post.`,
    "",
    linkedinHouseStyle(),
  ].join("\n");
}

/**
 * The approved messaging angles a post can be drafted from.
 *
 * Deliberately generic in their WORDING and specific in their INTENT: each one
 * is a way of opening a conversation with a technical buyer, not a claim about
 * a particular product. That is what lets them sit in the codebase while the
 * product they are applied to comes from configuration.
 *
 * Held here as data rather than fetched from the Python cockpit: this is a
 * prompt fragment, and a cross-service call for it would buy nothing but a new
 * way for drafting to fail.
 */
export const ANGLES: ReadonlyArray<{
  key: string;
  name: string;
  brief: string;
}> = [
  {
    key: "spec_early",
    name: "Get specified early",
    brief:
      "The decision is made at the drawing, not at the purchase order. Talk about what it costs to be brought in after the layout is frozen.",
  },
  {
    key: "expansion_timing",
    name: "Expansion timing",
    brief:
      "A new line, a new plant or a capacity increase is the only window where equipment choices are genuinely open. Urgency from the calendar, not from scarcity tricks.",
  },
  {
    key: "engineering_capacity",
    name: "Engineering capacity",
    brief:
      "Teams that are hiring engineers are short of engineering hours. Lead with the workload, not the catalogue.",
  },
  {
    key: "lead_times",
    name: "Lead times and availability",
    brief:
      "Schedule risk beats unit price on any project that has a commissioning date. Concrete about what actually slips, never a fabricated number.",
  },
  {
    key: "total_cost",
    name: "Total cost of ownership",
    brief:
      "Cheapest installed is rarely cheapest at year ten. Energy, maintenance access and downtime, in the reader's own terms.",
  },
  {
    key: "application_fit",
    name: "Application fit",
    brief:
      "A catalogue selection that ignores the process is how equipment gets replaced twice. Talk about the duty, the environment and what the datasheet does not say.",
  },
  {
    key: "compliance",
    name: "Codes, standards and compliance",
    brief:
      "Speak to the person who signs it off: what the standard actually requires and where submittals usually come back.",
  },
  {
    key: "retrofit",
    name: "Retrofit over replacement",
    brief:
      "Not every problem needs new equipment. Lightly contrarian, and the credibility comes from saying when not to buy.",
  },
  {
    key: "field_proof",
    name: "Field proof",
    brief:
      "Social proof from installations that already run. Concrete and specific, never a fabricated statistic or a named client who has not agreed to be named.",
  },
  {
    key: "single_point",
    name: "One point of responsibility",
    brief:
      "Multiple vendors means the gaps between them are the customer's problem. Talk about who owns the outcome, not about the product range.",
  },
];

export function findAngle(key: string | null | undefined) {
  if (!key) return null;
  return ANGLES.find((a) => a.key === key) ?? null;
}

/** JSON schema for the strict structured response. */
export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["post"],
  properties: {
    post: {
      type: "string",
      description: "The post text exactly as it should appear on LinkedIn.",
    },
  },
} as const;
