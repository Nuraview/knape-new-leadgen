/**
 * Reading a lead into the shape the model is shown.
 *
 * The interesting part is not the SQL — it is the payload. The scraper
 * json.dumps() several fields BEFORE the ingest stores the whole object as
 * jsonb, so `skills`, `deliverables` and `client_job_history_full` arrive as
 * JSON strings nested inside JSON. Missing that second parse is what produced
 * an empty past-hires list on the lead card, and here it would silently strip
 * the single most useful signal in the prompt: what previous freelancers wrote
 * about this buyer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drizzle's query builder is thenable, so one chainable object whose `then`
 * resolves to a fixed row set stands in for the whole `select().from().where()`
 * chain without a database.
 */
const dbRows = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("../../apps/api/src/database/crm", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "from", "where", "orderBy", "limit", "innerJoin"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => unknown) => resolve(dbRows.current);
  return { default: chain, isCrmConfigured: () => true };
});

const { loadLeadContext } = await import(
  "../../apps/api/src/proposal/ai/context"
);

const leadRow = (sourcePayload: Record<string, unknown>) => ({
  id: "11111111-1111-1111-1111-111111111111",
  firstName: "Sam",
  lastName: "Doe",
  company: "Acme",
  jobTitle: "CRO audit",
  email: "sam@acme.com",
  upworkJobUrl: "https://upwork.com/jobs/abc",
  description: "We need a CRO report for our Shopify store.",
  deletedAt: null,
  sourcePayload,
});

beforeEach(() => {
  dbRows.current = [];
});

describe("loadLeadContext", () => {
  it("double-parses the fields the scraper stringified", async () => {
    dbRows.current = [
      leadRow({
        skills: JSON.stringify(["Shopify", "CRO", "Analytics"]),
        deliverables: JSON.stringify(["Audit report"]),
        client_job_history_full: JSON.stringify([
          {
            title: "Landing page redesign",
            total_billed: "$2,400",
            client_feedback: "Clear brief, paid on time, knew what they wanted.",
          },
        ]),
      }),
    ];

    const lead = await loadLeadContext("11111111-1111-1111-1111-111111111111");

    expect(lead?.skills).toEqual(["Shopify", "CRO", "Analytics"]);
    expect(lead?.deliverables).toEqual(["Audit report"]);
    expect(lead?.pastHires).toHaveLength(1);
    expect(lead?.pastHires[0]?.feedback).toMatch(/paid on time/);
  });

  it("also accepts those fields as real arrays", async () => {
    // Older rows and hand-fixed ones are not stringified. Both shapes exist in
    // production, so neither may throw.
    dbRows.current = [leadRow({ skills: ["Shopify"], client_job_history_full: [] })];

    const lead = await loadLeadContext("id");
    expect(lead?.skills).toEqual(["Shopify"]);
    expect(lead?.pastHires).toEqual([]);
  });

  it("survives malformed JSON in the payload", async () => {
    dbRows.current = [
      leadRow({ skills: "{not json", client_job_history_full: "also not json" }),
    ];

    const lead = await loadLeadContext("id");
    expect(lead?.skills).toEqual([]);
    expect(lead?.pastHires).toEqual([]);
  });

  it("drops the scraper's missing-data sentinels", async () => {
    // "Not Found" is Gemini's sentinel and "N/A" is Upwork's. Passed through,
    // they end up in the prompt as if they were facts about the buyer.
    dbRows.current = [
      leadRow({
        budget_raw: "N/A",
        client_industry: "Not Found",
        client_location: "United Kingdom",
      }),
    ];

    const lead = await loadLeadContext("id");
    expect(lead?.budgetRaw).toBeNull();
    expect(lead?.client.industry).toBeUndefined();
    expect(lead?.client.location).toBe("United Kingdom");
  });

  it("keeps both the edited description and the raw posting", async () => {
    dbRows.current = [
      leadRow({ job_description: "Original posting text from Upwork." }),
    ];

    const lead = await loadLeadContext("id");
    expect(lead?.description).toContain("We need a CRO report");
    expect(lead?.description).toContain("Original posting text");
  });

  it("does not duplicate a description that was never edited", async () => {
    dbRows.current = [
      leadRow({ job_description: "We need a CRO report for our Shopify store." }),
    ];

    const lead = await loadLeadContext("id");
    expect(lead?.description.match(/CRO report/g)).toHaveLength(1);
  });

  it("returns null when the lead does not exist", async () => {
    dbRows.current = [];
    expect(await loadLeadContext("missing")).toBeNull();
  });

  it("copes with a lead that has no payload at all", async () => {
    dbRows.current = [{ ...leadRow({}), sourcePayload: null }];

    const lead = await loadLeadContext("id");
    expect(lead?.skills).toEqual([]);
    expect(lead?.pastHires).toEqual([]);
    expect(lead?.budgetRaw).toBeNull();
    expect(lead?.description).toContain("CRO report");
  });
});
