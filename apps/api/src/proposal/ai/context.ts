/**
 * Everything the model is allowed to know, assembled server-side.
 *
 * The client sends a leadId and free-text notes. It does not send the posting,
 * the budget, the client's history or the past proposals — those are read here
 * from the database. A browser that could supply the grounding could also
 * supply "our rate for this is $40,000", and the clamp in normalize.ts would
 * dutifully enforce it.
 *
 * Two sources of truth feed a draft:
 *   the LEAD  — what this buyer asked for, what they have paid before, what
 *               freelancers have said about working with them
 *   the WON   — proposals that were actually approved or paid, plus saved
 *               templates. This is the only record of what NuraView sells and
 *               at what price; there is no products or services catalogue in
 *               this database.
 */
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import crmDb from "../../database/crm";
import {
  crmLeads,
  crmProposalLineItems,
  crmProposals,
  proposalSettings,
} from "../../database/crm-schema";
import { median, toNumber } from "./normalize";

/** How many past proposals go into the prompt as examples. */
const WON_EXAMPLE_LIMIT = 6;

/**
 * Below this, a proposal is a rehearsal rather than a sale.
 *
 * The cheapest real proposal on record is $207. The test rows are $3.92, $4.06
 * and $5.00. Anything in that region is a Stripe test charge or a dry run and
 * must not influence what a client is quoted.
 */
const MIN_CREDIBLE_TOTAL = 100;

/**
 * How many credible examples before the price book is allowed to move a price.
 *
 * One or two past proposals is an anecdote, not a rate card, and a median of
 * two is whichever happened to land in the middle. Below this the band is left
 * unset — the model's own number stands and the draft carries a warning —
 * because a wrong clamp is worse than no clamp: it is silent, and it looks
 * deliberate.
 */
const MIN_PRICE_BOOK_EXAMPLES = 3;
/** Per-section plain text budget inside those examples. */
const EXAMPLE_SECTION_CHARS = 600;
/** Combined job-description budget. */
const DESCRIPTION_CHARS = 6000;

export type LeadContext = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  jobTitle: string | null;
  email: string | null;
  upworkJobUrl: string | null;
  description: string;
  budgetRaw: string | null;
  skills: string[];
  deliverables: string[];
  keyword: string | null;
  serviceCategory: string | null;
  client: Record<string, string>;
  pastHires: Array<{
    title: string;
    totalBilled: string;
    feedback: string;
  }>;
  sourcePayload: Record<string, unknown>;
};

export type WonExample = {
  title: string;
  projectName: string | null;
  currency: string;
  grandTotal: string;
  depositAmount: string | null;
  lineItems: Array<{
    description: string;
    quantity: string;
    unitPrice: string;
  }>;
  sections: Array<{ type: string; title: string; text: string }>;
};

export type CompanyContext = {
  companyName: string | null;
  defaultTermsHtml: string | null;
  scheduleCallUrl: string | null;
  defaultExpiryDays: number;
  baseCurrency: string;
};

/**
 * What comparable work has actually sold for.
 *
 * The range matters as much as the middle. These proposals run from $155 to
 * $2,370 — a fifteen-fold spread, because a brochure and a lead-generation
 * build are not the same job. Collapsing that to a median and clamping to it
 * prices every future draft like the median job, which is how a finance model
 * came out at $148. The band is derived from min and max; the median is only
 * shown to the model as a hint.
 */
export type PriceBook = {
  median: number;
  min: number;
  max: number;
  count: number;
};

export type DraftContext = {
  lead: LeadContext;
  company: CompanyContext;
  examples: WonExample[];
  /** Null when there are too few credible examples to price from. */
  priceBook: PriceBook | null;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Fields inside source_payload that arrive as a JSON *string* rather than as
 * real JSON — the scraper json.dumps()es them before the ingest stores the
 * whole object as jsonb, so they need a second parse. Getting this wrong is
 * what produced an empty past-hires list on the lead card.
 */
function parseEmbeddedJson<T>(value: unknown, fallback: T): T {
  if (Array.isArray(value)) return value as unknown as T;
  if (typeof value !== "string") return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function text(value: unknown): string {
  const s = String(value ?? "").trim();
  // Gemini's sentinels for "the page did not have this".
  if (!s || /^(not found|n\/a|unknown)$/i.test(s)) return "";
  return s;
}

/** Strip tags so an example section costs a fraction of the tokens. */
function htmlToText(html: unknown): string {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/*  Lead                                                               */
/* ------------------------------------------------------------------ */

export async function loadLeadContext(
  leadId: string,
): Promise<LeadContext | null> {
  const [row] = await crmDb
    .select()
    .from(crmLeads)
    .where(and(eq(crmLeads.id, leadId), isNull(crmLeads.deletedAt)))
    .limit(1);

  if (!row) return null;

  const payload = (row.sourcePayload ?? {}) as Record<string, unknown>;

  // Two copies of the posting exist and they are not the same text: the typed
  // column is what the team may have edited by hand, the payload is the raw
  // scrape (which the scraper caps at 2000 chars). Prefer the edited one and
  // append the raw only when it adds something.
  const edited = text(row.description);
  const scraped = text(payload.job_description ?? payload.description);
  const description = (
    edited && scraped && !edited.includes(scraped.slice(0, 120))
      ? `${edited}\n\n--- original posting ---\n${scraped}`
      : edited || scraped
  ).slice(0, DESCRIPTION_CHARS);

  const clientKeys = [
    "client_location",
    "client_city",
    "client_industry",
    "client_company_size",
    "client_total_spent_label",
    "client_total_jobs_posted",
    "client_jobs_completed",
    "client_rating",
    "client_review_count",
    "client_hires",
    "client_hours",
    "client_member_since",
    "client_payment_verified",
  ];
  const client: Record<string, string> = {};
  for (const key of clientKeys) {
    const value = text(payload[key]);
    if (value) client[key.replace(/^client_/, "")] = value;
  }

  const history = parseEmbeddedJson<Array<Record<string, unknown>>>(
    payload.client_job_history_full,
    [],
  );

  return {
    id: row.id,
    firstName: text(row.firstName) || null,
    lastName: text(row.lastName) || null,
    company: text(row.company) || null,
    jobTitle: text(row.jobTitle) || text(payload.jobTitle) || null,
    email: text(row.email) || null,
    upworkJobUrl: row.upworkJobUrl ?? null,
    description,
    budgetRaw: text(payload.budget_raw) || null,
    skills: parseEmbeddedJson<string[]>(payload.skills, [])
      .map((s) => text(s))
      .filter(Boolean)
      .slice(0, 20),
    deliverables: parseEmbeddedJson<string[]>(payload.deliverables, [])
      .map((s) => text(s))
      .filter(Boolean)
      .slice(0, 20),
    keyword: text(payload.keyword) || null,
    serviceCategory: text(payload.serviceCategory) || null,
    client,
    // What a freelancer wrote about this buyer after finishing a job. The
    // single most useful line in the payload for writing something that does
    // not read as a template.
    pastHires: history.slice(0, 5).map((h) => ({
      title: text(h.title),
      totalBilled: text(h.total_billed ?? h.price),
      feedback: text(h.client_feedback).slice(0, 400),
    })),
    sourcePayload: payload,
  };
}

/* ------------------------------------------------------------------ */
/*  Company + won work                                                 */
/* ------------------------------------------------------------------ */

export async function loadCompanyContext(): Promise<CompanyContext> {
  const [row] = await crmDb.select().from(proposalSettings).limit(1);
  return {
    companyName: row?.companyName ?? null,
    defaultTermsHtml: row?.defaultTermsHtml ?? null,
    scheduleCallUrl: row?.scheduleCallUrl ?? null,
    defaultExpiryDays: row?.defaultExpiryDays ?? 30,
    baseCurrency: row?.baseCurrency ?? "USD",
  };
}

/**
 * Proposals worth imitating: the ones that closed, plus saved templates.
 *
 * Deliberately NOT every proposal. A draft that was written badly and never
 * sent is not evidence of anything, and feeding it back in is how the drafts
 * get worse over time rather than better. `excludeId` keeps a proposal from
 * being handed its own text as an example when it is regenerated.
 *
 * AND NOT THE TEST ROWS. "APPROVED" was read as "won", but the status is also
 * what a Stripe test charge and a proposal literally titled "This is a Test"
 * end up with. On 2026-07-30 the six most recent APPROVED proposals were
 * $5.00 "This is a Test", $3.92 "TEST STRIPE", $4.06 "TEST STRIPE", $600
 * "Test", and two real ones. Their median — $106 — became the price band for
 * a lead with no posted budget, and an acquisition finance pack was clamped
 * down to a $148 total. The junk poisons the writing too, since these rows are
 * also the few-shot examples.
 */
export async function loadWonExamples(
  excludeId?: string,
): Promise<WonExample[]> {
  const heads = await crmDb
    .select({
      id: crmProposals.id,
      title: crmProposals.title,
      projectName: crmProposals.projectName,
      currency: crmProposals.currency,
      grandTotal: crmProposals.grandTotal,
      depositAmount: crmProposals.depositAmount,
      sections: crmProposals.sections,
    })
    .from(crmProposals)
    .where(
      and(
        isNull(crmProposals.deletedAt),
        or(
          eq(crmProposals.isTemplate, true),
          inArray(crmProposals.status, ["APPROVED", "PAID"]),
        ),
        // Nobody sells anything for four dollars. A total under the floor is a
        // rehearsal, whatever it is called.
        sql`COALESCE(${crmProposals.grandTotal}, 0) >= ${MIN_CREDIBLE_TOTAL}`,
        /*
         * Titled as a test.
         *
         * \M (end of word), NOT \b. Postgres regexes are POSIX ARE, where the
         * word boundary is \y or \m/\M and \b means backspace — so the obvious
         * spelling silently matches nothing, and a $600 proposal titled "Test"
         * stayed in the price book after the first attempt at this filter.
         *
         * Anchored at the start and bounded at the end so "Test" and
         * "Test Stripe" go, while "Testing Framework Rollout" and "Latest Test
         * Results for Acme" — real deliverables — stay.
         */
        sql`${crmProposals.title} !~* '^\\s*(test|demo|sample|dummy|asdf)\\M'`,
        sql`${crmProposals.title} !~* '\\mtest stripe\\M'`,
        // The editor's own test-mode sentinel, written into internalNotes when
        // "Sign & pay with test cards" is ticked.
        sql`COALESCE(${crmProposals.internalNotes}, '') NOT LIKE '[test]%'`,
        excludeId ? sql`${crmProposals.id} <> ${excludeId}::uuid` : undefined,
      ),
    )
    .orderBy(desc(crmProposals.updatedAt))
    .limit(WON_EXAMPLE_LIMIT);

  if (heads.length === 0) return [];

  const items = await crmDb
    .select({
      proposalId: crmProposalLineItems.proposalId,
      description: crmProposalLineItems.description,
      quantity: crmProposalLineItems.quantity,
      unitPrice: crmProposalLineItems.unitPrice,
      position: crmProposalLineItems.position,
    })
    .from(crmProposalLineItems)
    .where(
      inArray(
        crmProposalLineItems.proposalId,
        heads.map((h) => h.id),
      ),
    )
    .orderBy(crmProposalLineItems.position);

  const byProposal = new Map<string, WonExample["lineItems"]>();
  for (const item of items) {
    const list = byProposal.get(item.proposalId) ?? [];
    list.push({
      description: item.description ?? "",
      quantity: String(item.quantity ?? "1"),
      unitPrice: String(item.unitPrice ?? "0"),
    });
    byProposal.set(item.proposalId, list);
  }

  return heads.map((head) => ({
    title: head.title,
    projectName: head.projectName,
    currency: head.currency,
    grandTotal: String(head.grandTotal ?? "0"),
    depositAmount: head.depositAmount == null ? null : String(head.depositAmount),
    lineItems: byProposal.get(head.id) ?? [],
    sections: (Array.isArray(head.sections) ? head.sections : [])
      .slice(0, 8)
      .map((section) => {
        const s = (section ?? {}) as Record<string, unknown>;
        // Feature cards and timelines carry their content in structured
        // fields, not bodyHtml — flattening them keeps the example readable
        // as prose the model can imitate.
        const structured = [
          ...(Array.isArray(s.items) ? s.items : []).map((i) => {
            const item = (i ?? {}) as Record<string, unknown>;
            return `${item.title ?? ""}: ${item.description ?? ""}`;
          }),
          ...(Array.isArray(s.phases) ? s.phases : []).map((p) => {
            const phase = (p ?? {}) as Record<string, unknown>;
            return `${phase.label ?? ""} (${phase.duration ?? ""})`;
          }),
        ].join(" · ");
        const body = [htmlToText(s.bodyHtml), structured]
          .filter(Boolean)
          .join(" ");
        return {
          type: String(s.type ?? "richtext"),
          title: String(s.title ?? ""),
          text: body.slice(0, EXAMPLE_SECTION_CHARS),
        };
      })
      .filter((s) => s.title || s.text),
  }));
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

/**
 * Turn the example totals into a band, or into nothing.
 *
 * Too few credible examples and this returns null, which makes
 * resolveBudgetBand find no band, clamp nothing, and say so out loud. That is
 * the right failure: a price nobody checked is obvious, whereas a price
 * silently dragged to the median of two old proposals looks like a decision
 * somebody made.
 */
function buildPriceBook(examples: WonExample[]): PriceBook | null {
  const totals = examples
    .map((e) => toNumber(e.grandTotal))
    .filter((n): n is number => n !== null);

  const mid = totals.length >= MIN_PRICE_BOOK_EXAMPLES ? median(totals) : null;
  if (mid === null) return null;

  return {
    median: mid,
    min: Math.min(...totals),
    max: Math.max(...totals),
    count: totals.length,
  };
}

/**
 * The same context, assembled from a brief somebody typed instead of a lead.
 *
 * "New proposal" has no Upwork posting behind it — VK describes the job after a
 * call and expects the document written from that. Everything downstream is
 * identical: same house template, same won examples, same price clamp. Only the
 * source of the description changes, so this fabricates the LeadContext shape
 * rather than making generate() aware that two kinds of input exist.
 */
export async function buildBriefContext(input: {
  brief: string;
  clientName?: string | null;
  clientCompany?: string | null;
  clientEmail?: string | null;
  budget?: string | null;
}): Promise<DraftContext> {
  const [company, examples] = await Promise.all([
    loadCompanyContext(),
    loadWonExamples(),
  ]);

  const [firstName = "", ...rest] = (input.clientName ?? "").trim().split(/\s+/);

  const lead: LeadContext = {
    id: "",
    firstName: firstName || null,
    lastName: rest.join(" ") || null,
    company: input.clientCompany?.trim() || null,
    jobTitle: null,
    email: input.clientEmail?.trim() || null,
    upworkJobUrl: null,
    description: input.brief.trim().slice(0, DESCRIPTION_CHARS),
    budgetRaw: input.budget?.trim() || null,
    skills: [],
    deliverables: [],
    keyword: null,
    serviceCategory: null,
    client: {},
    pastHires: [],
    // resolveBudgetBand reads the budget from here, exactly as it does for a
    // scraped posting, so a typed budget anchors the price the same way.
    sourcePayload: input.budget?.trim()
      ? { budget_raw: input.budget.trim() }
      : {},
  };

  return { lead, company, examples, priceBook: buildPriceBook(examples) };
}

export async function buildDraftContext(
  leadId: string,
  excludeProposalId?: string,
): Promise<DraftContext | null> {
  const [lead, company, examples] = await Promise.all([
    loadLeadContext(leadId),
    loadCompanyContext(),
    loadWonExamples(excludeProposalId),
  ]);

  if (!lead) return null;

  return { lead, company, examples, priceBook: buildPriceBook(examples) };
}
