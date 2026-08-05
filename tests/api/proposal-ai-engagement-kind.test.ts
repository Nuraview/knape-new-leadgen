/**
 * Project proposals must not carry retainer terms.
 *
 * The house document this feature inherits from is Peter's MONTHLY RETAINER.
 * Copied wholesale onto a $350 fixed-price job it attached a pro-rata refund
 * over "unused days", and a clause about "one active project or campaign thread
 * at a time" — VK on the 31 July call: "you have taken that from Peter's
 * proposal, which doesn't make sense here."
 *
 * The other half of that call was the Ashima lesson: a website project that ran
 * February to July on "unlimited revisions" with no extra payment. The fair-use
 * clause exists because of it, and a project proposal without it is the bug.
 */
import { describe, expect, it } from "vitest";
import {
  boilerplateFor,
  type HouseTemplate,
} from "../../apps/api/src/proposal/ai/house-template";
import {
  FAIR_USE_HTML,
  isRetainerOnly,
} from "../../apps/api/src/proposal/ai/house-terms";
import { engagementKindOf } from "../../apps/api/src/proposal/ai/normalize";

/** The real sections off proposal 1021, abbreviated to their giveaway lines. */
const HOUSE: HouseTemplate = {
  sourceNumber: 1021,
  theme: "creative",
  designPresetId: "creative-branded",
  designTokens: {},
  brandColor: "#c2410c",
  portfolioConfig: null,
  boilerplateSections: [
    {
      key: "a",
      type: "richtext",
      title: "Service Terms",
      bodyHtml:
        "<p>This retainer is designed for one active project or campaign thread at a time.</p>",
    },
    {
      key: "b",
      type: "richtext",
      title: "Cancellation & Refund Policy",
      bodyHtml:
        "<p>Refund = (Unused Days / Total Days) × Net Amount Paid After Discount</p>",
    },
    {
      key: "c",
      type: "richtext",
      title: "General Terms",
      bodyHtml:
        "<p>Confidentiality. Intellectual property. All deliverables become the property of the Client upon full payment.</p>",
    },
    {
      key: "d",
      type: "testimonials",
      title: "Client Recommendations",
      testimonials: [{ name: "Rob Carliner", quote: "Highly recommend." }],
    },
  ],
};

const titles = (sections: Array<Record<string, unknown>>) =>
  sections.map((s) => String(s.title));

describe("engagementKindOf", () => {
  it("defaults to PROJECT for anything unclear", () => {
    // Retainer terms on a fixed-price job promise ongoing capacity nobody is
    // selling. Project terms on a retainer merely under-describe it. The safe
    // direction is not symmetric.
    expect(engagementKindOf(undefined)).toBe("PROJECT");
    expect(engagementKindOf("")).toBe("PROJECT");
    expect(engagementKindOf("something else")).toBe("PROJECT");
    expect(engagementKindOf("project")).toBe("PROJECT");
  });

  it("honours an explicit RETAINER", () => {
    expect(engagementKindOf("RETAINER")).toBe("RETAINER");
    expect(engagementKindOf("retainer")).toBe("RETAINER");
  });
});

describe("isRetainerOnly", () => {
  it("spots the clauses that only make sense monthly", () => {
    const [service, refund] = HOUSE.boilerplateSections;
    expect(isRetainerOnly(service as Record<string, unknown>)).toBe(true);
    expect(isRetainerOnly(refund as Record<string, unknown>)).toBe(true);
  });

  it("leaves engagement-neutral text alone", () => {
    const general = HOUSE.boilerplateSections[2] as Record<string, unknown>;
    expect(isRetainerOnly(general)).toBe(false);
  });

  it("never drops testimonials, whatever they say", () => {
    // Quotes are about the agency, not the engagement. One mentioning a
    // retainer must not disqualify it from a project proposal.
    expect(
      isRetainerOnly({
        type: "testimonials",
        title: "Recommendations",
        bodyHtml: "<p>Great monthly retainer partner</p>",
      }),
    ).toBe(false);
  });
});

describe("boilerplateFor", () => {
  it("keeps the house document intact for a retainer", () => {
    const out = boilerplateFor(HOUSE, "RETAINER");
    expect(out).toEqual(HOUSE.boilerplateSections);
  });

  it("strips the retainer clauses from a project", () => {
    const out = boilerplateFor(HOUSE, "PROJECT");
    const shown = titles(out).join(" | ");

    expect(shown).not.toContain("Cancellation");
    expect(
      out.some((s) => String(s.bodyHtml ?? "").includes("Unused Days")),
    ).toBe(false);
    expect(
      out.some((s) => /this retainer is designed/i.test(String(s.bodyHtml ?? ""))),
    ).toBe(false);
  });

  it("keeps the neutral terms and the testimonials", () => {
    const out = boilerplateFor(HOUSE, "PROJECT");
    expect(titles(out)).toContain("General Terms");
    expect(out.some((s) => s.type === "testimonials")).toBe(true);
    // Recommendations close the document; terms before praise reads better.
    expect(out[out.length - 1]?.type).toBe("testimonials");
  });

  it("gives a project the fair-use clause", () => {
    // The Ashima clause. Its absence is what the whole change is about.
    const out = boilerplateFor(HOUSE, "PROJECT");
    const body = out.map((s) => String(s.bodyHtml ?? "")).join(" ");

    expect(body).toContain(FAIR_USE_HTML);
    expect(body).toMatch(/unlimited revisions means what it says/i);
    // Both halves of the promise have to survive: the generosity and the limit.
    expect(body).toMatch(/no extra cost/i);
    expect(body).toMatch(/two weeks after final delivery/i);
    expect(body).toMatch(/nothing is ever invoiced that you have not approved/i);
  });

  it("collapses the cancellation terms on the page, not off it", () => {
    // Three paragraphs of pro-rata policy on a $350 job reads as a red flag,
    // but the client still signs these terms — so they stay on the document,
    // behind a click, rather than moving to another page.
    const out = boilerplateFor(HOUSE, "PROJECT");
    const body = out.map((s) => String(s.bodyHtml ?? "")).join(" ");

    expect(body).toContain("<details><summary>Cancellation and refunds</summary>");
    expect(body).toMatch(/returned in full/i);
    // Nothing is linked away to a separate page.
    expect(body).not.toContain("<a href");
  });

  it("still produces project terms when the house has no boilerplate at all", () => {
    const bare = { ...HOUSE, boilerplateSections: [] };
    const out = boilerplateFor(bare, "PROJECT");
    expect(titles(out)).toEqual(["Service Terms"]);
    expect(String(out[0]?.bodyHtml)).toContain("Fair use");
  });
});
