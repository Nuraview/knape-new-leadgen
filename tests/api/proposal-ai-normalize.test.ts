/**
 * The pricing and sanitisation rules for AI-drafted proposals.
 *
 * This is the half of the feature that costs money when it is wrong: a bad
 * sentence gets edited before sending, a bad number gets signed. Everything
 * here is pure, so it is tested directly rather than through the route.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWED_ICONS,
  buildPricingRows,
  clampLineItems,
  DraftRejected,
  isHourlyBudget,
  median,
  normalizeDraft,
  normalizeSections,
  resolveBudgetBand,
  sumLines,
  toNumber,
  type DraftLineItem,
  type PriceBand,
} from "../../apps/api/src/proposal/ai/normalize";

const line = (over: Partial<DraftLineItem> = {}): DraftLineItem => ({
  description: "Work",
  quantity: 1,
  unitPrice: 100,
  discountPercent: 0,
  ...over,
});

describe("toNumber", () => {
  it("reads the shapes the scraper actually stores", () => {
    expect(toNumber(1500)).toBe(1500);
    expect(toNumber("1500")).toBe(1500);
    expect(toNumber("$1,500.00")).toBe(1500);
  });

  it("rejects the scraper's sentinels and non-positive values", () => {
    // These land in budget_min/budget_max on a bad scrape, and treating any of
    // them as a price would anchor the whole proposal to zero.
    expect(toNumber("N/A")).toBeNull();
    expect(toNumber("Not Found")).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber(0)).toBeNull();
    expect(toNumber(-50)).toBeNull();
  });
});

describe("isHourlyBudget", () => {
  it("spots the Upwork hourly formats", () => {
    expect(isHourlyBudget("$25.00-$50.00 /hr")).toBe(true);
    expect(isHourlyBudget("$40 per hour")).toBe(true);
    expect(isHourlyBudget("Hourly")).toBe(true);
  });

  it("leaves fixed-price postings alone", () => {
    expect(isHourlyBudget("$1,500")).toBe(false);
    expect(isHourlyBudget("Fixed price: $900")).toBe(false);
    expect(isHourlyBudget(null)).toBe(false);
  });
});

describe("median", () => {
  it("handles both parities and ignores junk", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([0, -1, Number.NaN, 10])).toBe(10);
    expect(median([])).toBeNull();
  });
});

describe("resolveBudgetBand", () => {
  /** The real production price book after the test rows are excluded. */
  const book = { min: 155.25, max: 2370 };

  it("prefers the range the buyer posted, untouched", () => {
    const warnings: string[] = [];
    const band = resolveBudgetBand(
      { budget_min: 800, budget_max: 1200 },
      book,
      warnings,
    );
    expect(band).toMatchObject({ min: 800, max: 1200, source: "posted-range" });
    expect(warnings).toEqual([]);
  });

  it("widens a single posted figure rather than treating it as a ceiling", () => {
    const band = resolveBudgetBand({ budget_raw: "$1,000" }, null, []);
    expect(band.source).toBe("posted-fixed");
    expect(band.min).toBeCloseTo(850);
    expect(band.max).toBeCloseTo(1600);
  });

  it("falls back to the price book for an hourly posting, and says so", () => {
    // An hourly rate is not a project total. Anchoring to it produces a $45
    // proposal, which is the specific failure this branch exists to prevent.
    const warnings: string[] = [];
    const band = resolveBudgetBand(
      { budget_raw: "$25.00-$50.00 /hr", budget_min: 25, budget_max: 50 },
      book,
      warnings,
    );
    expect(band.source).toBe("price-book");
    expect(warnings.join(" ")).toMatch(/hourly/i);
  });

  it("uses the price book when the posting has no budget at all", () => {
    const warnings: string[] = [];
    const band = resolveBudgetBand({ budget_raw: "N/A" }, book, warnings);
    expect(band.source).toBe("price-book");
    expect(warnings.join(" ")).toMatch(/no budget/i);
  });

  it("spans the whole range of past work, not the middle of it", () => {
    // The regression that produced a $148 finance model: the band was built
    // from the median, so every unbudgeted lead got priced like the median
    // job. These proposals run 155 to 2370 — a real $1,500 piece of work has
    // to survive the clamp.
    const band = resolveBudgetBand({ budget_raw: "N/A" }, book, []);
    expect(band.min).toBeCloseTo(77.6, 1);
    expect(band.max).toBeCloseTo(3555);

    const lines = [line({ description: "Finance pack", unitPrice: 1500 })];
    expect(sumLines(clampLineItems(lines, band, []))).toBe(1500);
  });

  it("refuses to clamp, loudly, on a cold database", () => {
    // No budget and no won proposals: there is no defensible band, so the
    // honest thing is to leave the model's numbers and flag them.
    const warnings: string[] = [];
    const band = resolveBudgetBand({}, null, warnings);
    expect(band.source).toBe("none");
    expect(band.max).toBe(Number.POSITIVE_INFINITY);
    expect(warnings.join(" ")).toMatch(/unverified/i);
  });

  it("ignores a price book with a nonsensical floor", () => {
    // A zero or negative minimum would collapse the band onto zero.
    expect(resolveBudgetBand({}, { min: 0, max: 5000 }, []).source).toBe("none");
  });

  it("survives a missing sourcePayload", () => {
    expect(resolveBudgetBand(null, null, []).source).toBe("none");
    expect(resolveBudgetBand(undefined, book, []).source).toBe("price-book");
  });
});

describe("clampLineItems", () => {
  const band = (min: number, max: number): PriceBand => ({
    min,
    max,
    source: "posted-range",
  });

  it("leaves a total that is already inside the band alone", () => {
    const lines = [line({ unitPrice: 500 }), line({ unitPrice: 400 })];
    const warnings: string[] = [];
    const out = clampLineItems(lines, band(800, 1200), warnings);
    expect(sumLines(out)).toBe(900);
    expect(warnings).toEqual([]);
  });

  it("scales an over-priced draft down to the ceiling exactly", () => {
    const lines = [line({ unitPrice: 3000 }), line({ unitPrice: 1000 })];
    const warnings: string[] = [];
    const out = clampLineItems(lines, band(800, 1200), warnings);
    expect(sumLines(out)).toBe(1200);
    expect(warnings.join(" ")).toMatch(/rescaled/i);
  });

  it("scales an under-priced draft up to the floor exactly", () => {
    const lines = [line({ unitPrice: 100 }), line({ unitPrice: 50 })];
    const out = clampLineItems(lines, band(800, 1200), []);
    expect(sumLines(out)).toBe(800);
  });

  it("keeps the model's proportions when it scales", () => {
    // The breakdown is the model's argument for the price. Scaling must move
    // the magnitude without rewriting the argument.
    const lines = [line({ unitPrice: 3000 }), line({ unitPrice: 1000 })];
    const out = clampLineItems(lines, band(800, 1200), []);
    expect((out[0] as DraftLineItem).unitPrice).toBeCloseTo(
      (out[1] as DraftLineItem).unitPrice * 3,
      1,
    );
  });

  it("lands on the target to the cent despite per-line rounding", () => {
    // Three lines scaled by a factor that does not divide cleanly: rounding
    // each independently drifts off target, and the deposit is a percentage of
    // that total, so a few cents of drift becomes a mismatched invoice.
    const lines = [
      line({ unitPrice: 333 }),
      line({ unitPrice: 333 }),
      line({ unitPrice: 333 }),
    ];
    const out = clampLineItems(lines, band(1000, 1000), []);
    expect(sumLines(out)).toBe(1000);
  });

  it("respects quantity and discount when computing the total", () => {
    const lines = [line({ quantity: 3, unitPrice: 100, discountPercent: 10 })];
    expect(sumLines(lines)).toBe(270);
  });

  it("does not touch prices when there is no band", () => {
    const lines = [line({ unitPrice: 99_999 })];
    const out = clampLineItems(lines, { min: 0, max: Number.POSITIVE_INFINITY, source: "none" }, []);
    expect(sumLines(out)).toBe(99_999);
  });

  it("warns instead of dividing by zero when the draft has no prices", () => {
    const warnings: string[] = [];
    const out = clampLineItems([line({ unitPrice: 0 })], band(800, 1200), warnings);
    expect(sumLines(out)).toBe(0);
    expect(warnings.join(" ")).toMatch(/no prices/i);
  });
});

describe("normalizeSections", () => {
  it("re-keys and re-orders rather than trusting the model", () => {
    // A duplicate key makes the editor's patch-by-key edit two sections at once.
    const out = normalizeSections([
      { key: "same", type: "richtext", title: "A", bodyHtml: "<p>a</p>" },
      { key: "same", type: "scope", title: "B", items: [] },
    ]);
    expect(out.map((s) => s.key)).toEqual(["richtext-0", "scope-1"]);
    expect(out.map((s) => s.order)).toEqual([0, 1]);
  });

  it("strips script payloads out of the model's HTML", () => {
    const out = normalizeSections([
      {
        type: "richtext",
        title: "Intro",
        bodyHtml: '<p onclick="steal()">hi</p><script>alert(1)</script>',
      },
    ]);
    const html = (out[0]?.bodyHtml ?? "").toLowerCase();
    expect(html).not.toContain("script");
    expect(html).not.toContain("onclick");
    expect(html).toContain("hi");
  });

  it("drops an icon the editor could not render", () => {
    const out = normalizeSections([
      {
        type: "scope",
        title: "Scope",
        items: [
          { title: "A", description: "", icon: "NotARealLucideIcon", bullets: [] },
          { title: "B", description: "", icon: ALLOWED_ICONS[0], bullets: [] },
        ],
      },
    ]);
    expect(out[0]?.items?.[0]?.icon).toBeNull();
    expect(out[0]?.items?.[1]?.icon).toBe(ALLOWED_ICONS[0]);
  });

  it("always attaches the timeline's client-editable row", () => {
    const out = normalizeSections([
      { type: "timeline", title: "Timeline", phases: [{ label: "Build", duration: "2 weeks" }] },
    ]);
    expect(out[0]?.clientField).toEqual({
      label: "Time taken by you",
      unit: "days",
    });
  });

  it("falls back to richtext for a type the editor does not know", () => {
    const out = normalizeSections([{ type: "carousel", title: "X" }]);
    expect(out[0]?.type).toBe("richtext");
  });

  it("ignores junk entries instead of throwing", () => {
    expect(normalizeSections(null)).toEqual([]);
    expect(normalizeSections([null, "nope", 7])).toEqual([]);
  });
});

describe("buildPricingRows", () => {
  it("rebuilds the table from the line items that will be stored", () => {
    // The table and the line items are two renderings of one number. After a
    // clamp only the line items moved, so the model's own table would be a
    // document that promises one price and charges another.
    const sections = normalizeSections([
      { type: "pricing", title: "Investment", totalLabel: "Total" },
    ]);
    const lines = [
      line({ description: "Audit", unitPrice: 600 }),
      line({ description: "Fixes", quantity: 2, unitPrice: 200 }),
    ];
    const out = buildPricingRows(sections, lines, "USD");

    expect(out[0]?.rows).toEqual([
      { item: "Audit", type: "", amount: "USD 600.00", included: false },
      { item: "Fixes", type: "2 ×", amount: "USD 400.00", included: false },
    ]);
    expect(out[0]?.totalAmount).toBe("USD 1,000.00");
  });

  it("leaves non-pricing sections untouched", () => {
    const sections = normalizeSections([{ type: "richtext", title: "Intro", bodyHtml: "<p>x</p>" }]);
    expect(buildPricingRows(sections, [line()], "USD")).toEqual(sections);
  });
});

describe("normalizeDraft", () => {
  const band: PriceBand = { min: 800, max: 1200, source: "posted-range" };

  // The four sections the model is asked for. Pricing is NOT among them — the
  // server builds that from the clamped line items.
  const good = {
    title: "Conversion audit for the Shopify store",
    projectName: "CRO audit",
    clientName: "Sam",
    clientCompany: "Acme",
    pricingNote: "Includes analytics tooling at no extra cost.",
    publicNotes: "Assumes access to analytics.",
    internalNotes: "Priced at the top of their range.",
    depositPct: 50,
    expiresInDays: 14,
    lineItems: [{ description: "Audit", quantity: 1, unitPrice: 1000, discountPercent: 0 }],
    sections: [
      {
        type: "richtext",
        title: "Cost",
        bodyHtml: "<p>what the figure covers</p>",
        stats: [{ label: "Total", value: "$1,000" }],
      },
      {
        type: "richtext",
        title: "Engagement Overview",
        bodyHtml: "",
        stats: [{ label: "Team", value: "Designer + Developer" }],
      },
      {
        type: "scope",
        title: "Scope of Work",
        items: [{ title: "A", description: "b", icon: null, bullets: ["x"] }],
      },
      {
        type: "timeline",
        title: "Timeline",
        phases: [{ label: "Build", duration: "2 weeks" }],
      },
    ],
  };

  const run = (raw: unknown, warnings: string[] = []) =>
    normalizeDraft(raw as never, {
      band,
      currency: "USD",
      defaultExpiryDays: 30,
      warnings,
    });

  it("passes a well-formed draft through", () => {
    const out = run(good);
    expect(out.title).toBe(good.title);
    expect(out.total).toBe(1000);
    expect(out.depositPct).toBe(50);
    expect(out.expiresInDays).toBe(14);
  });

  it("rejects a draft with no scope of work", () => {
    // Half a proposal is worse than none, because it looks finished.
    expect(() =>
      run({ ...good, sections: [{ type: "richtext", title: "Intro", bodyHtml: "<p>x</p>" }] }),
    ).toThrow(DraftRejected);
  });

  it("rejects a draft with no title or no line items", () => {
    expect(() => run({ ...good, title: "  " })).toThrow(DraftRejected);
    expect(() => run({ ...good, lineItems: [] })).toThrow(DraftRejected);
  });

  it("does not reject over the half the caller is discarding", () => {
    // A regenerate with "keep my sections" ticked throws the returned sections
    // away, so failing the whole request because they were incomplete would be
    // a failure about nothing.
    const noSections = { ...good, sections: [] };
    expect(() => run(noSections)).toThrow(DraftRejected);
    expect(() =>
      normalizeDraft(noSections as never, {
        band,
        currency: "USD",
        defaultExpiryDays: 30,
        warnings: [],
        requireSections: false,
      }),
    ).not.toThrow();

    const noLines = { ...good, lineItems: [] };
    expect(() =>
      normalizeDraft(noLines as never, {
        band,
        currency: "USD",
        defaultExpiryDays: 30,
        warnings: [],
        requireLineItems: false,
      }),
    ).not.toThrow();
  });

  it("drops line items the writer would reject anyway", () => {
    const out = run({
      ...good,
      lineItems: [
        { description: "", quantity: 1, unitPrice: 100, discountPercent: 0 },
        { description: "Real", quantity: 1, unitPrice: 1000, discountPercent: 0 },
      ],
    });
    expect(out.lineItems).toHaveLength(1);
    expect(out.lineItems[0]?.description).toBe("Real");
  });

  it("clamps a nonsense deposit and expiry back into range", () => {
    const out = run({ ...good, depositPct: 900, expiresInDays: 4000 });
    expect(out.depositPct).toBe(100);
    expect(out.expiresInDays).toBe(90);
  });

  it("falls back to the configured expiry when the model omits one", () => {
    const out = run({ ...good, expiresInDays: 0 });
    expect(out.expiresInDays).toBe(30);
  });

  it("caps the number of line items", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      description: `Item ${i}`,
      quantity: 1,
      unitPrice: 25,
      discountPercent: 0,
    }));
    expect(run({ ...good, lineItems: many }).lineItems.length).toBeLessThanOrEqual(12);
  });

  it("makes the pricing table agree with the clamped total", () => {
    const warnings: string[] = [];
    const out = run(
      {
        ...good,
        lineItems: [{ description: "Audit", quantity: 1, unitPrice: 9000, discountPercent: 0 }],
      },
      warnings,
    );
    const pricing = out.sections.find((s) => s.type === "pricing");
    expect(out.total).toBe(1200);
    expect(pricing?.totalAmount).toBe("USD 1,200.00");
    expect(warnings.join(" ")).toMatch(/rescaled/i);
  });

  it("builds the pricing section itself, from the line items", () => {
    // The model is never asked for this section, so it cannot disagree with
    // what is charged.
    const out = run(good);
    const pricing = out.sections.find((s) => s.type === "pricing");
    expect(pricing?.title).toBe("Pricing & Payment");
    expect(pricing?.rows).toEqual([
      { item: "Audit", type: "One-time", amount: "USD 1,000.00", included: false },
    ]);
    expect(pricing?.bodyHtml).toContain("no extra cost");
  });

  it("orders the document the way the house proposals read", () => {
    const out = run(good);
    expect(out.sections.map((s) => s.title)).toEqual([
      "Cost",
      "Engagement Overview",
      "Pricing & Payment",
      "Scope of Work",
      "Timeline",
    ]);
    expect(out.sections.map((s) => s.order)).toEqual([0, 1, 2, 3, 4]);
    // Duplicate keys make the editor's patch-by-key edit two sections at once.
    expect(new Set(out.sections.map((s) => s.key)).size).toBe(out.sections.length);
  });

  it("renders headline figures and spec rows as different tables", () => {
    const out = run(good);
    const cost = out.sections.find((s) => s.title === "Cost");
    const engagement = out.sections.find((s) => s.title === "Engagement Overview");

    // "$1,000 / Total" is a stat band: values on one row, captions beneath.
    expect(cost?.bodyHtml).toContain("pv-stats");
    expect(cost?.bodyHtml).toMatch(/<tr><td>\$1,000<\/td><\/tr><tr><td>Total<\/td><\/tr>/);
    // The marker class the public page styles against has to survive the
    // sanitizer, or the block renders as a cramped default table.
    expect(cost?.bodyHtml).toContain('class="table pv-stats"');
    // "Team / Designer + Developer" is a spec sheet — two columns.
    expect(engagement?.bodyHtml).toContain("pv-kv");
    expect(engagement?.bodyHtml).toMatch(/<td>Team<\/td><td>Designer/);
  });

  it("drops Cost to two columns rather than squashing a long value", () => {
    // Four cells side by side stop being readable once one holds a date range,
    // and a squashed table is visible to the client.
    const out = run({
      ...good,
      sections: good.sections.map((s) =>
        s.title === "Cost"
          ? {
              ...s,
              stats: [
                { label: "Total", value: "$1,200" },
                { label: "Proposed window", value: "Mon, 3 Aug 2026 — Fri, 21 Aug 2026" },
              ],
            }
          : s,
      ),
    });
    const cost = out.sections.find((s) => s.title === "Cost");
    expect(cost?.bodyHtml).toContain("pv-kv");
    expect(cost?.bodyHtml).toMatch(/<td>Total<\/td><td>\$1,200<\/td>/);
  });

  it("never gives a scope section the headline band", () => {
    // Only Cost/Investment get it; a stat block on any other section stacks.
    const out = run({
      ...good,
      sections: good.sections.map((s) =>
        s.title === "Engagement Overview"
          ? { ...s, stats: [{ label: "Duration", value: "2 Weeks" }] }
          : s,
      ),
    });
    const eng = out.sections.find((s) => s.title === "Engagement Overview");
    expect(eng?.bodyHtml).toContain("pv-kv");
    expect(eng?.bodyHtml).not.toContain("pv-stats");
  });

  it("copies house boilerplate through byte for byte", () => {
    // Terms are signed-off legal text and the testimonials are real named
    // people. Anything that rewrites, re-attributes or re-sanitizes them is a
    // bug — this test is the guard on that.
    const testimonials = [
      {
        name: "Rob Carliner",
        role: "Emmy-winning Film & TV Producer",
        quote: "Highly recommend Varshith and the team.",
        rating: 5,
        avatarUrl: "https://example.com/rob.jpg",
      },
    ];
    const boilerplate = [
      { key: "terms", type: "richtext", title: "Service Terms", bodyHtml: "<p>Fixed &amp; agreed</p>", order: 99 },
      { key: "recs", type: "testimonials", title: "Client Recommendations", testimonials, order: 100 },
    ];

    const out = normalizeDraft(good as never, {
      band,
      currency: "USD",
      defaultExpiryDays: 30,
      warnings: [],
      boilerplateSections: boilerplate,
    });

    const terms = out.sections.find((s) => s.title === "Service Terms");
    const recs = out.sections.find((s) => s.type === "testimonials");

    expect(terms?.bodyHtml).toBe("<p>Fixed &amp; agreed</p>");
    expect((recs as unknown as { testimonials: unknown }).testimonials).toEqual(testimonials);
    // They land after the bespoke sections, renumbered but not rewritten.
    expect(out.sections.slice(-2).map((s) => s.title)).toEqual([
      "Service Terms",
      "Client Recommendations",
    ]);
    expect(terms?.order).toBe(5);
  });
});
