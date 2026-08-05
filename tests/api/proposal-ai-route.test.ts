/**
 * The drafting route's contract with the database.
 *
 * One guarantee matters more than the rest: a model answer that is not a usable
 * proposal must leave NOTHING behind. A half-written proposal is worse than no
 * proposal, because it looks finished — it appears in the list, it can be
 * shared, and the missing pricing section is only noticed by the client.
 *
 * The route enqueues and returns a jobId; the writing happens after the
 * response. So these tests await the job's completion rather than the request,
 * and the failure cases assert on the recorded job error instead of a status
 * code — a failure that happens after the response cannot be one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

const state = vi.hoisted(() => ({
  /** What the fake OpenAI returns as the JSON body of the message. */
  completion: {} as unknown,
  /** Set when the route tried to write a proposal. */
  created: null as unknown,
  lead: null as unknown,
  /** The fake job store, keyed by id. */
  jobs: new Map<string, Record<string, unknown>>(),
  /** Resolves when the background job settles, so tests need no sleeping. */
  settled: null as null | Promise<void>,
}));

vi.mock("../../apps/api/src/proposal/ai/jobs", () => ({
  createJob: async (input: Record<string, unknown>) => {
    const id = `job-${state.jobs.size + 1}`;
    state.jobs.set(id, { id, status: "PENDING", ...input });
    return id;
  },
  // A spy, so a test can make it report a draft already in flight.
  findActiveJobForLead: vi.fn(async () => null),
  getJob: async (id: string) => state.jobs.get(id) ?? null,
  runJob: (id: string, work: () => Promise<Record<string, unknown>>) => {
    // The real one detaches; here the promise is kept so a test can await it.
    state.settled = work()
      .then((r) => {
        state.jobs.set(id, { ...state.jobs.get(id), status: "COMPLETED", ...r });
      })
      .catch((e: Error) => {
        state.jobs.set(id, {
          ...state.jobs.get(id),
          status: "FAILED",
          error: e.message,
        });
      });
  },
}));

vi.mock("../../apps/api/src/database/crm", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "orderBy", "limit", "innerJoin"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => unknown) => resolve([]);
  return { default: chain, isCrmConfigured: () => true };
});

vi.mock("../../apps/api/src/proposal/ai/context", async () => {
  const actual = await vi.importActual<
    typeof import("../../apps/api/src/proposal/ai/context")
  >("../../apps/api/src/proposal/ai/context");
  return {
    ...actual,
    // Only the lead lookup is faked. buildBriefContext stays real, because the
    // thing worth testing about it — that a typed budget reaches the price
    // clamp the same way a scraped one does — lives inside it.
    buildDraftContext: async () => state.lead,
  };
});

vi.mock("../../apps/api/src/proposal/ai/house-template", async () => {
  const actual = await vi.importActual<
    typeof import("../../apps/api/src/proposal/ai/house-template")
  >("../../apps/api/src/proposal/ai/house-template");
  return {
    ...actual,
    // Only the database read is faked. boilerplateFor stays real so these
    // tests also cover which terms end up on the document.
    loadHouseTemplate: async () => ({
      sourceNumber: 1021,
      theme: "creative",
      designPresetId: "creative-branded",
      designTokens: { accentColor: "#c2410c" },
      brandColor: "#c2410c",
      portfolioConfig: null,
      // The real house document is a monthly retainer — that is the whole
      // reason project proposals needed their own terms.
      boilerplateSections: [
        {
          key: "svc",
          type: "richtext",
          title: "Service Terms",
          bodyHtml: "<p>This retainer is designed for one active thread.</p>",
        },
        {
          key: "gen",
          type: "richtext",
          title: "General Terms",
          bodyHtml: "<p>Confidentiality and intellectual property.</p>",
        },
      ],
    }),
  };
});

vi.mock("../../apps/api/src/proposal/write", () => ({
  createProposalRecord: async (input: unknown) => {
    state.created = input;
    return { id: "created-id", number: 7, clientSlug: "acme" };
  },
  updateProposalRecord: async () => ({ id: "x", grandTotal: "0.00" }),
}));

vi.mock("../../apps/api/src/proposal/ai/openai", async () => {
  const actual = await vi.importActual<
    typeof import("../../apps/api/src/proposal/ai/openai")
  >("../../apps/api/src/proposal/ai/openai");
  return {
    ...actual,
    isAiConfigured: () => true,
    completeJson: async () => ({
      data: state.completion,
      model: "gpt-5",
      promptTokens: 10,
      completionTokens: 20,
    }),
  };
});

const ai = (await import("../../apps/api/src/proposal/ai")).default;

/** Mount the router the way the real app does, with the same error rendering. */
function makeApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("userId" as never, "user-1" as never);
    c.set("userEmail" as never, "vk@nuraview.com" as never);
    await next();
  });
  app.route("/", ai);
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }
    return c.json({ error: String(error) }, 500);
  });
  return app;
}

/** Enqueue, then wait for the detached work so assertions are deterministic. */
async function draft(body: unknown) {
  const response = await makeApp().request("/ai/draft-from-lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (state.settled) await state.settled;
  return response;
}

/** The job row as the poller would see it. */
const jobFor = (id: string) => state.jobs.get(id) as Record<string, unknown>;

async function draftAndRead(body: unknown) {
  const response = await draft(body);
  // Read once — a Response body cannot be consumed twice, so the jobId is
  // handed back rather than the caller re-reading it.
  const payload = (await response.json()) as { jobId?: string };
  return {
    status: response.status,
    jobId: payload.jobId,
    job: payload.jobId ? jobFor(payload.jobId) : undefined,
  };
}

const COMPLETE_DRAFT = {
  title: "Conversion audit for the Shopify store",
  projectName: "CRO audit",
  clientName: "Sam",
  clientCompany: "Acme",
  publicNotes: "Assumes analytics access.",
  internalNotes: "Priced mid-range.",
  depositPct: 50,
  expiresInDays: 14,
  lineItems: [
    { description: "Audit", quantity: 1, unitPrice: 900, discountPercent: 0 },
  ],
  sections: [
    { type: "richtext", title: "Intro", bodyHtml: "<p>hello</p>" },
    {
      type: "scope",
      title: "Scope",
      items: [{ title: "Audit", description: "x", icon: null, bullets: [] }],
    },
    { type: "pricing", title: "Investment", totalLabel: "Total" },
  ],
};

beforeEach(() => {
  state.created = null;
  state.completion = COMPLETE_DRAFT;
  // A full LeadContext: buildUserMessage reads every one of these, so a
  // partial fixture would fail on a missing array rather than on the thing
  // each test is actually about.
  state.lead = {
    lead: {
      id: "lead-1",
      firstName: "Sam",
      lastName: "Doe",
      company: "Acme",
      jobTitle: "CRO audit",
      email: "sam@acme.com",
      upworkJobUrl: "https://upwork.com/jobs/abc",
      description: "We need a CRO report for our Shopify store.",
      budgetRaw: "$1,000",
      skills: ["Shopify", "CRO"],
      deliverables: ["Audit report"],
      keyword: "cro",
      serviceCategory: "CRO",
      client: { location: "United Kingdom" },
      pastHires: [
        { title: "Landing page", totalBilled: "$2,400", feedback: "Paid on time." },
      ],
      sourcePayload: { budget_min: 800, budget_max: 1200 },
    },
    company: {
      companyName: "NuraView",
      defaultTermsHtml: null,
      scheduleCallUrl: null,
      defaultExpiryDays: 30,
      baseCurrency: "USD",
    },
    examples: [
      {
        title: "Past win",
        projectName: null,
        currency: "USD",
        grandTotal: "1000",
        depositAmount: null,
        lineItems: [{ description: "Audit", quantity: "1", unitPrice: "1000" }],
        sections: [{ type: "richtext", title: "Intro", text: "..." }],
      },
    ],
    priceBook: { median: 1000, min: 800, max: 1200, count: 4 },
  };
});

describe("POST /ai/draft-from-lead", () => {
  it("400s without a leadId, before spending any model time", async () => {
    const response = await draft({});
    expect(response.status).toBe(400);
    expect(state.created).toBeNull();
  });

  it("404s when the lead is gone", async () => {
    state.lead = null;
    const response = await draft({ leadId: "missing" });
    expect(response.status).toBe(404);
    expect(state.created).toBeNull();
  });

  it("returns a job id immediately and writes the draft behind it", async () => {
    const { status, job } = await draftAndRead({
      leadId: "lead-1",
      currency: "GBP",
    });
    expect(status).toBe(200);
    expect(job).toMatchObject({ status: "COMPLETED", proposalId: "created-id" });

    const written = state.created as Record<string, unknown>;
    expect(written.currency).toBe("GBP");
    expect(written.sourceLeadId).toBe("lead-1");
    expect(written.pricingMode).toBe("LINE_ITEMS");
    // Percent in the UI, absolute amount in the column.
    expect(written.depositAmount).toBe("450.00");
  });

  it("joins the running job instead of paying for a second draft", async () => {
    // Two presses of a button that takes a minute is the normal case, not an
    // edge case.
    const { findActiveJobForLead } = await import(
      "../../apps/api/src/proposal/ai/jobs"
    );
    vi.mocked(findActiveJobForLead).mockResolvedValueOnce({
      id: "job-in-flight",
    } as never);

    const response = await draft({ leadId: "lead-1" });
    expect(await response.json()).toMatchObject({
      jobId: "job-in-flight",
      alreadyRunning: true,
    });
    expect(state.created).toBeNull();
  });

  it("falls back to the configured currency when given a junk one", async () => {
    await draft({ leadId: "lead-1", currency: "DOGE" });
    expect((state.created as Record<string, unknown>).currency).toBe("USD");
  });

  it("inherits the house branding", async () => {
    // Without these the public page renders in its default blue, which is the
    // most visible difference between a real proposal and a generated one.
    await draft({ leadId: "lead-1" });
    expect(state.created).toMatchObject({
      theme: "creative",
      designPresetId: "creative-branded",
      brandColor: "#c2410c",
    });
  });

  it("attaches project terms, not the retainer ones from the house doc", async () => {
    // A one-off job must not inherit "this retainer is designed for…". It must
    // inherit the fair-use clause instead.
    await draft({ leadId: "lead-1" });
    const sections = (state.created as { sections: Array<Record<string, unknown>> })
      .sections;
    const body = sections.map((s) => String(s.bodyHtml ?? "")).join(" ");

    expect(body).not.toMatch(/this retainer is designed/i);
    expect(body).toMatch(/fair use/i);
    // Engagement-neutral house text still comes along.
    expect(sections.some((s) => s.title === "General Terms")).toBe(true);
    // And exactly one Service Terms section, not the house one plus ours.
    expect(sections.filter((s) => s.title === "Service Terms")).toHaveLength(1);
  });

  it("keeps the house retainer terms when the work IS a retainer", async () => {
    state.completion = { ...COMPLETE_DRAFT, engagementKind: "RETAINER" };

    await draft({ leadId: "lead-1" });
    const sections = (state.created as { sections: Array<Record<string, unknown>> })
      .sections;
    const body = sections.map((s) => String(s.bodyHtml ?? "")).join(" ");

    expect(body).toMatch(/this retainer is designed/i);
    expect(body).not.toMatch(/fair use/i);
  });

  it("fails the job and writes NOTHING when the scope section is missing", async () => {
    state.completion = {
      ...COMPLETE_DRAFT,
      sections: [{ type: "richtext", title: "Intro", bodyHtml: "<p>x</p>" }],
    };

    const { job } = await draftAndRead({ leadId: "lead-1" });
    expect(job?.status).toBe("FAILED");
    expect(String(job?.error)).toMatch(/scope of work/i);
    expect(state.created).toBeNull();
  });

  it("fails the job and writes NOTHING when there are no line items", async () => {
    state.completion = { ...COMPLETE_DRAFT, lineItems: [] };

    const { job } = await draftAndRead({ leadId: "lead-1" });
    expect(job?.status).toBe("FAILED");
    expect(state.created).toBeNull();
  });

  it("hands the model's own error message to the poller", async () => {
    // These sentences are written to be read by a salesperson, so the job
    // stores them verbatim rather than flattening everything to "failed".
    state.completion = { ...COMPLETE_DRAFT, title: "  " };

    const { job } = await draftAndRead({ leadId: "lead-1" });
    expect(job?.status).toBe("FAILED");
    expect(String(job?.error)).toMatch(/without a title/i);
  });

  it("puts the clamp's reasoning into the internal notes, not just a toast", async () => {
    // A toast is gone by the time somebody reads the draft and asks why the
    // total is not the number the buyer posted.
    state.completion = {
      ...COMPLETE_DRAFT,
      lineItems: [
        { description: "Audit", quantity: 1, unitPrice: 9000, discountPercent: 0 },
      ],
    };

    const { job } = await draftAndRead({ leadId: "lead-1" });
    const written = state.created as Record<string, string>;

    expect((job?.warnings as string[]).join(" ")).toMatch(/rescaled/i);
    expect(written.internalNotes).toMatch(/rescaled/i);
    expect(written.internalNotes).toContain("https://upwork.com/jobs/abc");
  });
});

describe("POST /ai/draft-from-brief", () => {
  const brief = (body: unknown) =>
    makeApp().request("/ai/draft-from-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("rejects a brief too short to write anything from", async () => {
    // Cheaper to refuse than to spend a minute inventing a whole project.
    const response = await brief({ brief: "shopify site" });
    expect(response.status).toBe(400);
    expect(state.created).toBeNull();
  });

  it("drafts from the typed description, with no lead involved", async () => {
    const response = await brief({
      brief:
        "Shopify storefront for a DTC coffee brand, 12 products, subscriptions and a blog. Branding already exists.",
      budget: "3000",
      currency: "GBP",
      clientCompany: "Blue Bottle",
    });
    if (state.settled) await state.settled;

    expect(response.status).toBe(200);
    const written = state.created as Record<string, unknown>;
    expect(written.currency).toBe("GBP");
    // Nothing links it to a lead, because there is not one.
    expect(written.sourceLeadId).toBeUndefined();
    // It still inherits the house look and terms.
    expect(written.designPresetId).toBe("creative-branded");
    expect(String(written.internalNotes)).toMatch(/typed brief/i);
  });

  it("anchors the price to the budget that was typed", async () => {
    // The typed figure has to reach resolveBudgetBand the same way a scraped
    // budget_raw would, or a brief-drafted proposal is priced off the price
    // book while the client was told a number.
    state.completion = {
      ...COMPLETE_DRAFT,
      lineItems: [
        { description: "Build", quantity: 1, unitPrice: 90_000, discountPercent: 0 },
      ],
    };

    await brief({
      brief:
        "Shopify storefront for a DTC coffee brand, 12 products and subscriptions.",
      budget: "3000",
    });
    if (state.settled) await state.settled;

    const written = state.created as { lineItems: Array<{ unitPrice: number }> };
    // 3000 widened by the fixed-budget ceiling multiplier, not 90k.
    expect(written.lineItems[0]?.unitPrice).toBeLessThanOrEqual(4800);
  });
});

describe("GET /ai/jobs/:jobId", () => {
  it("reports a finished job with the proposal to open", async () => {
    const { jobId } = await draftAndRead({ leadId: "lead-1" });

    const poll = await makeApp().request(`/ai/jobs/${jobId}`);
    expect(poll.status).toBe(200);
    expect(await poll.json()).toMatchObject({
      status: "COMPLETED",
      proposalId: "created-id",
    });
  });

  it("404s on an unknown job rather than polling for ever", async () => {
    const poll = await makeApp().request("/ai/jobs/does-not-exist");
    expect(poll.status).toBe(404);
  });
});
