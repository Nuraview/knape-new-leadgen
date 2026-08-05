/**
 * The system prompt and the JSON Schema the model must answer in.
 *
 * The schema mirrors the proposal editor's own state (apps/app/src/types/
 * proposal.ts) field for field, so a validated answer hydrates the form by
 * assignment. Where the two must agree — section `type` values, the timeline's
 * clientField, the pricing rows — the editor's shape wins.
 *
 * SCOPE OF WHAT THE MODEL WRITES: the four bespoke sections only. Service
 * Terms, the refund policy, the general terms and the client recommendations
 * are copied from the house proposal by house-template.ts and never appear
 * here — see that file for why.
 */
import type { DraftContext } from "./context";
import type { HouseTemplate } from "./house-template";
import { ALLOWED_ICONS } from "./normalize";

/* ------------------------------------------------------------------ */
/*  JSON Schema                                                        */
/* ------------------------------------------------------------------ */

/**
 * OpenAI's `strict: true` mode has two rules that shape everything below:
 * every property must appear in `required`, and `additionalProperties` must be
 * false. A discriminated union of section types is therefore not expressible,
 * so sections are ONE object carrying every per-type payload as a nullable
 * field. normalizeSections() drops the payloads that do not belong to the
 * section's `type`.
 */
export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "engagementKind",
    "projectName",
    "clientName",
    "clientCompany",
    "engagement",
    "pricingNote",
    "publicNotes",
    "internalNotes",
    "depositPct",
    "expiresInDays",
    "lineItems",
    "sections",
  ],
  properties: {
    title: {
      type: "string",
      description:
        "What the client sees at the top. Name the outcome. Not 'Proposal for X'.",
    },
    engagementKind: {
      type: "string",
      enum: ["PROJECT", "RETAINER"],
      description:
        'PROJECT for a one-off piece of work with a defined end — the overwhelming majority. RETAINER only when the client is buying ongoing capacity billed per month, with no single deliverable that finishes it. If in any doubt, PROJECT: it decides which terms are attached, and retainer terms on a fixed-price job promise things nobody offers.',
    },
    projectName: { type: "string" },
    clientName: { type: "string", description: "Person's name, or empty." },
    clientCompany: { type: "string" },
    engagement: {
      type: "object",
      additionalProperties: false,
      description:
        "Drives the Engagement Overview table. Leave a field empty rather than inventing it.",
      required: ["plan", "team", "startDate", "endDate", "duration", "cadence"],
      properties: {
        plan: { type: "string", description: 'e.g. "Discounted Basic Plan"' },
        team: {
          type: "string",
          description: 'Who is allocated, e.g. "Designer + Copywriter + Developer"',
        },
        startDate: { type: "string", description: 'e.g. "Monday, 4 August 2026"' },
        endDate: { type: "string" },
        duration: { type: "string", description: 'e.g. "2 Months"' },
        cadence: {
          type: "string",
          description: 'e.g. "Dedicated daily availability ( business days )"',
        },
      },
    },
    pricingNote: {
      type: "string",
      description:
        'One or two sentences printed under the pricing table — what the figure includes, or the discount. e.g. "Gross discount: 25% off standard rate. Net 41% once the $160/mo tooling included at no extra cost is factored in."',
    },
    publicNotes: {
      type: "string",
      description:
        "Two or three sentences near the total: assumptions, exclusions, what you need from them.",
    },
    internalNotes: {
      type: "string",
      description:
        "NEVER shown to the client. How you arrived at the price, and what you were unsure about.",
    },
    depositPct: { type: "integer", description: "Upfront percentage, 0-100." },
    expiresInDays: { type: "integer" },
    lineItems: {
      type: "array",
      description: "3-6 deliverables the client would recognise on an invoice.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unitPrice", "discountPercent"],
        properties: {
          description: { type: "string" },
          quantity: { type: "number" },
          unitPrice: { type: "number" },
          discountPercent: { type: "number" },
        },
      },
    },
    sections: {
      type: "array",
      description:
        "Exactly five, in order: Introduction (richtext), Cost (richtext), Engagement Overview (richtext), Scope of Work (scope), Timeline (timeline). Pricing & Payment is appended by the server.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "bodyHtml", "stats", "items", "phases"],
        properties: {
          type: {
            type: "string",
            enum: ["richtext", "scope", "timeline"],
          },
          title: { type: "string" },
          bodyHtml: {
            type: "string",
            description:
              "Simple HTML: p, h2, h3, ul, ol, li, strong, em. No tables — use `stats` for those. Empty for scope/timeline.",
          },
          stats: {
            type: ["array", "null"],
            description:
              'Cost: 3-4 headline figures, each value SHORT (under 24 characters) — "$1,200", "41%", "3 Weeks". Never a date range. Engagement Overview: the label/value rows, which may be longer. Null on scope and timeline.',
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "value"],
              properties: {
                label: { type: "string", description: 'e.g. "Total (2 Months Upfront)"' },
                value: { type: "string", description: 'e.g. "$1,500"' },
              },
            },
          },
          items: {
            type: ["array", "null"],
            description: "Scope of Work only: 4-6 cards. Null elsewhere.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title", "description", "icon", "bullets"],
              properties: {
                title: { type: "string", description: 'Short label, e.g. "Development"' },
                description: {
                  type: "string",
                  description: 'One line naming the workstream, e.g. "Web & Landing Page Development"',
                },
                icon: { type: "string", enum: [...ALLOWED_ICONS] },
                bullets: {
                  type: "array",
                  description: "2-4 concrete deliverables. This is where the detail lives.",
                  items: { type: "string" },
                },
              },
            },
          },
          phases: {
            type: ["array", "null"],
            description: "Timeline only. Null elsewhere.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["label", "duration"],
              properties: {
                label: { type: "string", description: 'e.g. "Initial Demo"' },
                duration: { type: "string", description: 'e.g. "2-3 Days"' },
              },
            },
          },
        },
      },
    },
  },
} as const;

/* ------------------------------------------------------------------ */
/*  System prompt                                                      */
/* ------------------------------------------------------------------ */

export const SYSTEM_PROMPT = `You write client-facing proposals for NuraView, a creative and development agency that wins work on Upwork. Your output is sent to a buyer with almost no editing, so it has to read like a senior consultant wrote it after a call — not like a template with the name swapped.

WHAT SEPARATES A GOOD ONE FROM A BAD ONE

The best proposals this agency has sent do four things. Do all four.

1. They prove somebody read the brief. They name the client's actual systems, their terminology, their constraints. A real one opens: "This proposal covers the scope, technical approach, and cost for building the Community Dashboard discussed in our June 23 tagup. The goal is to replace manual, spreadsheet-driven project tracking for our key customer..."

2. They show the thinking, including what was rejected. "NetSuite was evaluated as a data source but ruled out because its API integration is too slow and code-intensive to approve and build against in a reasonable timeframe." Naming a road not taken is what makes the recommendation credible.

3. They are transparent about money. Not a number — an explanation of the number. A real one: "To be transparent about where this number comes from: $1,000 is not Anthropic's or Google's price, and it is not a markup on the tools themselves. It is a single, one-time project fee that bundles... the actual subscription costs for the first month, passed through at cost... and the development work." Then it says what happens after month one. Write the Cost section like that.

4. They are specific in the scope. Not "marketing collaterals" but "Video assets for use in AI lead generation campaigns", "Infographics and data visualization collaterals". Every bullet is a thing the client can picture receiving.

THE FIVE SECTIONS YOU WRITE, IN THIS ORDER

1. type "richtext", titled "Introduction". Two or three sentences, no heading and no stats — this prints at the very top beside the client's details, so it is the first thing they read. Say what this proposal covers and name their problem in their own words. The opener to imitate: "This proposal covers the scope, technical approach, and cost for building the Community Dashboard discussed in our June 23 tagup. The goal is to replace manual, spreadsheet-driven project tracking for our key customer with an automated system." Concrete, specific to them, no throat-clearing.

2. type "richtext", titled "Cost". Set \`stats\` to 3-4 headline figures, each value SHORT — "$1,200", "3 Weeks", "41%". These print side by side as a band across the top, so a long value breaks the layout: no date ranges, no sentences. Put the total, the duration, and a saving or rate comparison if one is honest. Then in bodyHtml write the money narrative from point 3 above: what the figure bundles, what is passed through at cost, what recurs after the engagement and what does not. This is the section that stops a buyer asking "why this much?" and it is the one most often written badly. Two or three short paragraphs, a h3 sub-heading if it helps.

3. type "richtext", titled "Engagement Overview". Set \`stats\` to the label/value rows from the engagement object you were given — Plan, Team, Start Date, End Date, Duration, and the working cadence. bodyHtml is one short paragraph framing the engagement, or empty.

4. type "scope", titled "Scope of Work". 4-6 items. Each: a short title ("Development", "Personal Branding"), a one-line description naming the workstream, an icon, and 2-4 bullets of concrete deliverables. The bullets carry the detail — this section is what the client scrolls back to.

5. type "timeline", titled "Timeline". 3-5 phases with honest durations.

Set \`items\` to null unless the section is "scope". Set \`phases\` to null unless it is "timeline". Set \`stats\` to null on scope and timeline.

PROJECT OR RETAINER
Set engagementKind. Nearly everything is a PROJECT: a defined piece of work that finishes. RETAINER is only for ongoing monthly capacity with no single deliverable that ends it. This choice decides which terms get attached, and retainer terms on a fixed-price job commit the agency to things it does not offer — so when it is not clearly ongoing monthly work, it is a PROJECT.

DO NOT WRITE: service terms, cancellation or refund policy, general terms, confidentiality, intellectual property, fair use, or any testimonial or client recommendation. Those are fixed house documents and are attached automatically, chosen by engagementKind. Anything you write on those topics is discarded, and inventing a client quote is never acceptable.

PRICING
- The won proposals below are the price book: what this agency sells and what it charges. Stay in that world; do not invent a service they show no evidence of.
- Split the total into 3-6 deliverables. The budget band you are given is the buyer's own posted budget — land inside it. If the work honestly cannot be done for that, price it properly and explain why in internalNotes; the server will adjust the total and the salesperson reads internalNotes.

TONE
Plain, direct, confident. No "we are excited to submit". No "your trusted partner". No filler adjectives. Match the buyer's formality and spelling. If a sentence would survive being pasted into a proposal for a different client, cut it or make it specific.`;

/* ------------------------------------------------------------------ */
/*  User message                                                       */
/* ------------------------------------------------------------------ */

const line = (label: string, value: unknown) =>
  value === null || value === undefined || value === "" ? "" : `${label}: ${value}\n`;

/**
 * Assemble the user turn.
 *
 * Plain labelled text rather than raw JSON: the payload has ~40 keys of which
 * a dozen matter, and dumping the object spends most of the prompt on scraper
 * bookkeeping the model then has to ignore.
 */
export function buildUserMessage(
  context: DraftContext,
  options: {
    currency: string;
    band: { min: number; max: number; source: string };
    notes?: string;
    keepPricing?: boolean;
    keepSections?: boolean;
    house?: HouseTemplate;
    today?: string;
  },
): string {
  const { lead, company, examples } = context;
  const parts: string[] = [];

  parts.push("## The job posting\n");
  parts.push(line("Title", lead.jobTitle));
  parts.push(line("Posted budget", lead.budgetRaw));
  parts.push(line("Category", lead.serviceCategory ?? lead.keyword));
  parts.push(line("Skills asked for", lead.skills.join(", ")));
  parts.push(line("Deliverables named", lead.deliverables.join(", ")));
  parts.push(`\n${lead.description || "(no description was captured)"}\n`);

  parts.push("\n## The buyer\n");
  parts.push(line("Name", [lead.firstName, lead.lastName].filter(Boolean).join(" ")));
  parts.push(line("Company", lead.company));
  for (const [key, value] of Object.entries(lead.client)) {
    parts.push(line(key.replace(/_/g, " "), value));
  }

  if (lead.pastHires.length > 0) {
    parts.push(
      "\n### What freelancers said after working with this buyer\n" +
        "(their own words — the best guide to how this person wants to be dealt with)\n",
    );
    for (const hire of lead.pastHires) {
      parts.push(
        `- ${hire.title || "untitled job"}${hire.totalBilled ? ` (${hire.totalBilled})` : ""}${hire.feedback ? `: "${hire.feedback}"` : ""}\n`,
      );
    }
  }

  parts.push("\n## The agency\n");
  parts.push(line("Name", company.companyName || "NuraView"));
  parts.push(line("Currency for this proposal", options.currency));
  if (options.today) parts.push(line("Today's date", options.today));

  parts.push("\n## Price band\n");
  parts.push(
    options.band.max === Number.POSITIVE_INFINITY
      ? "No usable budget signal — price the work on its merits and say so in internalNotes.\n"
      : `Total must land between ${options.band.min.toFixed(0)} and ${options.band.max.toFixed(0)} ${options.currency} (derived from: ${options.band.source}).\n`,
  );

  if (examples.length > 0) {
    parts.push(
      "\n## Proposals this agency has already sent\n" +
        "(what it sells, how it words things, what it charges — imitate the voice, do not copy the content)\n",
    );
    for (const example of examples) {
      parts.push(`\n### ${example.title} — ${example.currency} ${example.grandTotal}\n`);
      for (const item of example.lineItems) {
        parts.push(`- ${item.description} — ${item.quantity} × ${item.unitPrice}\n`);
      }
      for (const section of example.sections) {
        if (section.text) parts.push(`  [${section.type}] ${section.title}: ${section.text}\n`);
      }
    }
  } else {
    parts.push(
      "\n## Proposals this agency has already sent\nThere are none on record yet. Price and scope from the posting alone, and say in internalNotes that the figures are unverified.\n",
    );
  }

  if (options.house?.boilerplateSections.length) {
    // Named, not included. The model must know these will exist so it does not
    // duplicate them, but it has no reason to read their text — and every
    // reason not to be handed real people's testimonials as writable context.
    parts.push(
      "\n## Attached automatically after your sections — do not write these\n" +
        options.house.boilerplateSections
          .map((s) => `- ${String(s.title ?? s.type)}`)
          .join("\n") +
        "\n",
    );
  }

  if (options.notes?.trim()) {
    parts.push(
      "\n## Notes from the salesperson — these override anything above\n" +
        `${options.notes.trim()}\n`,
    );
  }

  if (options.keepPricing) {
    parts.push(
      "\nThe existing line items and prices are being kept. Return them unchanged in lineItems and write the sections around them.\n",
    );
  }
  if (options.keepSections) {
    parts.push(
      "\nThe existing document sections are being kept. Focus on the pricing.\n",
    );
  }

  return parts.filter(Boolean).join("");
}
