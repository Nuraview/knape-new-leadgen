/**
 * Which sections a language model is allowed to write.
 *
 * `isBoilerplate` is the smallest function in this feature and the one with
 * the most riding on it. It decides two things at once: what gets copied off
 * the house proposal onto every draft, and what gets thrown away if the model
 * writes it anyway.
 *
 * Get it wrong in one direction and a client receives a proposal with no terms
 * on it. Get it wrong in the other and they receive one carrying a refund
 * policy a model paraphrased, or — worst case — a recommendation attributed to
 * a real, named person who never said it. Both failure modes are covered here.
 */
import { describe, expect, it } from "vitest";
import {
  assembleSections,
  isBoilerplate,
  normalizeSections,
  type DraftLineItem,
} from "../../apps/api/src/proposal/ai/normalize";

const section = (title: string, type = "richtext") => ({ title, type });

describe("isBoilerplate", () => {
  it("claims the house terms, however they are punctuated", () => {
    const titles = [
      "Service Terms",
      "service terms",
      "SERVICE  TERMS",
      "Payment Terms",
      "Cancellation & Refund Policy",
      "Refund Policy",
      "General Terms",
      "Terms & Conditions",
      "Terms and Conditions",
      "Client Recommendations ( as seen on Linkedin )",
      "Testimonials",
    ];
    for (const title of titles) {
      expect(isBoilerplate(section(title)), title).toBe(true);
    }
  });

  it("claims any testimonials section whatever it is titled", () => {
    // These are quotes from real people. The type alone is enough.
    expect(isBoilerplate({ type: "testimonials", title: "" })).toBe(true);
    expect(isBoilerplate({ type: "testimonials", title: "What clients say" })).toBe(
      true,
    );
  });

  it("leaves the per-deal sections alone", () => {
    // Over-matching here is not a cosmetic bug: a "Scope of Work" wrongly
    // treated as boilerplate would be silently dropped from the document.
    const titles = [
      "Cost",
      "Investment",
      "Engagement Overview",
      "Scope of Work",
      "Timeline",
      "Pricing & Payment",
      "Proposed Solution",
      "Tools & Cost",
      "Overview",
    ];
    for (const title of titles) {
      expect(isBoilerplate(section(title)), title).toBe(false);
    }
  });

  it("does not confuse 'Pricing & Payment' with 'Payment Terms'", () => {
    // One is the price table this feature builds; the other is house legal
    // text. They differ by one word.
    expect(isBoilerplate(section("Pricing & Payment", "pricing"))).toBe(false);
    expect(isBoilerplate(section("Payment Terms"))).toBe(true);
  });

  it("survives a section with no title or type", () => {
    expect(isBoilerplate({})).toBe(false);
    expect(isBoilerplate({ title: null, type: undefined })).toBe(false);
  });
});

describe("assembleSections", () => {
  const lines: DraftLineItem[] = [
    { description: "Audit", quantity: 1, unitPrice: 1000, discountPercent: 0 },
  ];

  const modelWrote = (titles: Array<[string, string]>) =>
    normalizeSections(
      titles.map(([title, type]) => ({
        title,
        type,
        bodyHtml: `<p>${title}</p>`,
        items: type === "scope" ? [{ title: "A", description: "b", bullets: [] }] : null,
      })),
    );

  it("discards model-written terms so the real ones stand alone", () => {
    // The prompt tells it not to write these. Models ignore a negative
    // instruction now and then, and a document carrying both an invented
    // "Service Terms" and the real one gives a client no way to tell which
    // they are agreeing to.
    const sections = assembleSections(
      modelWrote([
        ["Cost", "richtext"],
        ["Scope of Work", "scope"],
        ["Service Terms", "richtext"],
      ]),
      lines,
      "USD",
      "",
      [{ key: "real", type: "richtext", title: "Service Terms", bodyHtml: "<p>the real one</p>" }],
    );

    const terms = sections.filter((s) => s.title === "Service Terms");
    expect(terms).toHaveLength(1);
    expect(terms[0]?.bodyHtml).toBe("<p>the real one</p>");
  });

  it("drops an invented testimonial even when the house has none", () => {
    // Failing open here would publish a fabricated endorsement.
    const sections = assembleSections(
      normalizeSections([
        { title: "Scope of Work", type: "scope", items: [{ title: "A", description: "b" }] },
        {
          title: "What clients say",
          type: "testimonials",
          testimonials: [{ name: "Jane Doe", quote: "Invented." }],
        },
      ]),
      lines,
      "USD",
      "",
      [],
    );

    expect(sections.some((s) => s.type === "testimonials")).toBe(false);
  });

  it("keeps the boilerplate after the bespoke work and renumbers it", () => {
    const sections = assembleSections(
      modelWrote([
        ["Cost", "richtext"],
        ["Engagement Overview", "richtext"],
        ["Scope of Work", "scope"],
        ["Timeline", "timeline"],
      ]),
      lines,
      "USD",
      "",
      [
        { key: "a", type: "richtext", title: "General Terms", bodyHtml: "<p>g</p>", order: 77 },
        { key: "b", type: "testimonials", title: "Client Recommendations", testimonials: [1] },
      ],
    );

    expect(sections.map((s) => s.title)).toEqual([
      "Cost",
      "Engagement Overview",
      "Pricing & Payment",
      "Scope of Work",
      "Timeline",
      "General Terms",
      "Client Recommendations",
    ]);
    expect(sections.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(new Set(sections.map((s) => s.key)).size).toBe(sections.length);
  });

  it("keys sections by role so the public page's named slots resolve", () => {
    /*
     * The public view addresses two sections BY NAME:
     *   const intro = allSections.find((s) => s.key === "intro" && …)
     *   const terms = allSections.find((s) => s.key === "terms")
     * Keys of the form `richtext-0` matched neither, so the intro slot fell
     * back to canned "Thank you for the opportunity" copy — which is what left
     * 163px of white space under it — and the terms rendered as heavy numbered
     * sections instead of the quiet unnumbered slot.
     */
    const sections = assembleSections(
      modelWrote([
        ["Introduction", "richtext"],
        ["Cost", "richtext"],
        ["Scope of Work", "scope"],
      ]),
      lines,
      "USD",
      "",
      [
        { key: "x", type: "richtext", title: "Service Terms", bodyHtml: "<p>t</p>" },
        { key: "y", type: "testimonials", title: "Client Recommendations", testimonials: [1] },
      ],
    );

    const keys = sections.map((s) => s.key);
    expect(keys).toContain("intro");
    expect(keys).toContain("terms");
    expect(keys).toContain("pricing");
    expect(keys).toContain("scope");
    // Introduction leads the document, so the greeting block has real copy.
    expect(sections[0]?.key).toBe("intro");
  });

  it("suffixes a second section of the same role rather than colliding", () => {
    // A duplicate key makes the editor's patch-by-key edit two sections at
    // once, and would let a second terms section steal the public page's slot
    // from the real one.
    const sections = assembleSections(
      modelWrote([["Scope of Work", "scope"]]),
      lines,
      "USD",
      "",
      [
        { key: "a", type: "richtext", title: "Service Terms", bodyHtml: "<p>first</p>" },
        { key: "b", type: "richtext", title: "General Terms", bodyHtml: "<p>second</p>" },
      ],
    );

    const termsKeys = sections.filter((s) => s.key.startsWith("terms")).map((s) => s.key);
    expect(termsKeys).toEqual(["terms", "terms-2"]);
    // The FIRST one keeps the bare key and therefore the slot.
    expect(sections.find((s) => s.key === "terms")?.bodyHtml).toBe("<p>first</p>");
    expect(new Set(sections.map((s) => s.key)).size).toBe(sections.length);
  });

  it("omits the pricing section when there is nothing to price", () => {
    const sections = assembleSections(
      modelWrote([["Scope of Work", "scope"]]),
      [],
      "USD",
      "",
      [],
    );
    expect(sections.some((s) => s.type === "pricing")).toBe(false);
  });
});
