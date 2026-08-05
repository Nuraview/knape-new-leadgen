/**
 * AI proposal drafting.
 *
 * Mounted inside the proposal router, which is already behind requireCrmAccess.
 * Deliberately not under /lead: that router is fail-closed against an explicit
 * path allow-list, so a route added there is denied until somebody remembers to
 * list it.
 *
 *   POST /api/proposal/ai/draft-from-lead   — read a lead, write a DRAFT
 *   POST /api/proposal/ai/draft-from-brief  — same, from a typed description
 *   POST /api/proposal/:id/ai/regenerate    — rewrite an existing DRAFT
 *   GET  /api/proposal/ai/jobs/:jobId       — poll any of the above
 *
 * ENQUEUE AND POLL, not synchronous. Writing a proposal takes a minute or two,
 * mostly gpt-5 reasoning before it emits a visible token. Holding the request
 * open for that worked, but it pinned somebody to a spinner and any refresh
 * threw the work away. The three write routes return a job id immediately and
 * the browser polls; see jobs.ts for why the work runs in this process rather
 * than through the self-hosted Inngest.
 *
 * All three go through createProposalRecord/updateProposalRecord rather than
 * writing their own SQL, so AI drafts get the same numbering, the same
 * server-recomputed totals and the same APPROVED/PAID lock as a hand-made one.
 */
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import crmDb from "../../database/crm";
import { crmProposalLineItems, crmProposals } from "../../database/crm-schema";
import { createProposalRecord, updateProposalRecord } from "../write";
import {
  buildBriefContext,
  buildDraftContext,
  type DraftContext,
} from "./context";
import {
  boilerplateFor,
  loadHouseTemplate,
  type HouseTemplate,
} from "./house-template";
import { createJob, findActiveJobForLead, getJob, runJob } from "./jobs";
import { completeJson, isAiConfigured } from "./openai";
import {
  buildPricingRows,
  engagementKindOf,
  normalizeDraft,
  resolveBudgetBand,
  type DraftLineItem,
  type NormalizedDraft,
  type RawDraft,
} from "./normalize";
import { buildUserMessage, DRAFT_SCHEMA, SYSTEM_PROMPT } from "./prompt";

const CURRENCIES = new Set(["USD", "EUR", "GBP", "INR", "AED"]);
/** Long enough for a page of call notes, short enough not to be a payload. */
const MAX_NOTES = 4000;
/** A brief is the whole description of the job, so it gets more room. */
const MAX_BRIEF = 8000;

function requireConfigured() {
  if (!isAiConfigured()) {
    throw new HTTPException(503, {
      message:
        "Proposal AI is not configured on this server — OPENAI_API_KEY is missing.",
    });
  }
}

/*
 * There is no error-to-HTTP-status mapping any more.
 *
 * The work happens after the response has gone, so a failure cannot be a
 * status code — it is a row. DraftRejected, AiUpstreamError and the rest all
 * carry a sentence written to be read by a salesperson ("The model ran out of
 * output budget…", "You exceeded your current quota"), and runJob stores that
 * message verbatim for the poller to display. Everything checkable before
 * enqueuing — no key, no lead, a signed proposal — is still a real status code
 * on the enqueue request itself.
 */

/**
 * Everything between "we have a lead" and "we have a validated draft".
 *
 * Shared by both routes so the create and regenerate paths cannot drift on the
 * part that matters — which context the model sees and which rules its answer
 * is held to.
 */
async function generate(
  context: DraftContext,
  options: {
    currency: string;
    notes?: string;
    keepPricing?: boolean;
    keepSections?: boolean;
  },
): Promise<{
  draft: NormalizedDraft;
  house: HouseTemplate;
  meta: Record<string, unknown>;
}> {
  const warnings: string[] = [];
  const band = resolveBudgetBand(
    context.lead.sourcePayload,
    context.priceBook,
    warnings,
  );

  // The design and the terms come from the house proposal, not the model.
  const house = await loadHouseTemplate();
  if (house.boilerplateSections.length === 0) {
    warnings.push(
      "No house proposal with terms or testimonials was found, so this draft has none. Mark a good proposal as a template to fix that for every future draft.",
    );
  }

  if (context.examples.length === 0) {
    warnings.push(
      "No approved or paid proposals exist yet, so there was nothing to ground the wording or the price on. Read this one closely.",
    );
  }

  const completion = await completeJson<RawDraft>({
    system: SYSTEM_PROMPT,
    user: buildUserMessage(context, {
      ...options,
      band,
      house,
      today: new Date().toDateString(),
    }),
    schemaName: "proposal_draft",
    schema: DRAFT_SCHEMA,
  });

  /*
   * Which terms to attach is only knowable once the model has classified the
   * engagement, so the choice happens here rather than before the call. A
   * project gets fair-use terms and a refund link; a retainer keeps the house
   * document as it stands.
   */
  const kind = engagementKindOf(
    (completion.data as { engagementKind?: unknown }).engagementKind,
  );
  const boilerplate = boilerplateFor(house, kind);

  const draft = normalizeDraft(completion.data, {
    band,
    currency: options.currency,
    defaultExpiryDays: context.company.defaultExpiryDays,
    warnings,
    boilerplateSections: boilerplate,
    // Do not fail the request over the half of the answer that is about to be
    // thrown away.
    requireSections: !options.keepSections,
    requireLineItems: !options.keepPricing,
  });

  return {
    draft,
    house,
    meta: {
      model: completion.model,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      priceBand: { min: band.min, max: band.max, source: band.source },
      engagementKind: kind,
      examplesUsed: context.examples.length,
      templateFrom: house.sourceNumber,
      boilerplateSections: house.boilerplateSections.length,
      warnings: draft.warnings,
    },
  };
}

/**
 * The warnings belong in the document, not only in a toast.
 *
 * A toast is gone by the time the proposal is being reviewed, and "why is this
 * priced at 1,400 when they said 900?" is exactly the question that gets asked
 * an hour later. internalNotes is never shown to the client.
 */
function composeInternalNotes(
  draft: NormalizedDraft,
  leadUrl: string | null,
  source = "the lead card",
) {
  return [
    leadUrl ? `Drafted by AI from ${leadUrl}` : `Drafted by AI from ${source}.`,
    draft.warnings.length > 0
      ? `\nCheck before sending:\n${draft.warnings.map((w) => `- ${w}`).join("\n")}`
      : "",
    draft.internalNotes ? `\n${draft.internalNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function expiryDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

/** Percent in the UI, absolute amount in the column. */
function depositAmount(draft: NormalizedDraft): string | null {
  if (draft.depositPct <= 0) return null;
  return ((draft.total * draft.depositPct) / 100).toFixed(2);
}

const ai = new Hono<{ Variables: { userId: string; userEmail: string } }>()
  /**
   * Draft a proposal from a lead and save it as a DRAFT.
   *
   * Returns an id rather than the draft body: the editor already knows how to
   * load a proposal by id, and handing the form a payload to hydrate from
   * would mean a generated draft could be lost by a refresh.
   */
  .post("/ai/draft-from-lead", async (c) => {
    requireConfigured();

    const body = await c.req
      .json<{ leadId?: string; notes?: string; currency?: string }>()
      .catch(() => ({}) as { leadId?: string; notes?: string; currency?: string });

    const leadId = body.leadId?.trim();
    if (!leadId) {
      throw new HTTPException(400, { message: "leadId is required" });
    }

    // Everything that can be checked cheaply is checked before enqueuing, so a
    // bad request fails now rather than a minute later inside a job.
    const context = await buildDraftContext(leadId);
    if (!context) {
      throw new HTTPException(404, { message: "Lead not found" });
    }

    const running = await findActiveJobForLead(leadId);
    if (running) {
      // A second press should join the first draft, not start another and pay
      // for the model twice.
      return c.json({ jobId: running.id, alreadyRunning: true });
    }

    const requested = (body.currency ?? "").toUpperCase();
    const currency = CURRENCIES.has(requested)
      ? requested
      : context.company.baseCurrency || "USD";
    const notes = body.notes?.slice(0, MAX_NOTES);
    const actor = { userId: c.get("userId"), userEmail: c.get("userEmail") };

    const jobId = await createJob({ kind: "DRAFT", leadId });

    runJob(jobId, async () => {
      const { draft, house, meta } = await generate(context, {
        currency,
        notes,
      });

      const created = await createProposalRecord(
        {
          title: draft.title,
          clientName: draft.clientName || null,
          clientCompany: draft.clientCompany || context.lead.company,
          clientEmail: context.lead.email,
          projectName: draft.projectName || null,
          currency,
          publicNotes: draft.publicNotes || null,
          internalNotes: composeInternalNotes(draft, context.lead.upworkJobUrl),
          sections: draft.sections,
          pricingMode: "LINE_ITEMS",
          lineItems: draft.lineItems,
          depositAmount: depositAmount(draft),
          expiresAt: expiryDate(draft.expiresInDays),
          sourceLeadId: leadId,
          /*
           * Inherit the look. Without these four the public page falls back to
           * its default blue and none of the brand styling applies — which is
           * the single most visible difference between a real NuraView
           * proposal and one that just has the right words in it.
           */
          theme: house.theme,
          designPresetId: house.designPresetId,
          designTokens: house.designTokens,
          brandColor: house.brandColor,
        },
        actor,
        { action: "AI_DRAFTED", meta },
      );

      return {
        proposalId: created.id,
        warnings: draft.warnings,
        meta,
      };
    });

    return c.json({ jobId });
  })

  /**
   * Draft a proposal from a typed brief, with no lead behind it.
   *
   * "New proposal" from the Proposals list. VK describes the job after a call
   * and gets the same document a lead would have produced — same house
   * template, same won examples, same price clamp. The only difference is
   * where the description came from, so this shares everything below the
   * context builder.
   */
  .post("/ai/draft-from-brief", async (c) => {
    requireConfigured();

    const body = await c.req
      .json<{
        brief?: string;
        clientName?: string;
        clientCompany?: string;
        clientEmail?: string;
        budget?: string;
        currency?: string;
      }>()
      .catch(() => ({}) as Record<string, string>);

    const brief = body.brief?.trim();
    if (!brief || brief.length < 20) {
      throw new HTTPException(400, {
        message:
          "Describe the job in a sentence or two — there is nothing to write a proposal from yet.",
      });
    }

    const context = await buildBriefContext({
      brief: brief.slice(0, MAX_BRIEF),
      clientName: body.clientName,
      clientCompany: body.clientCompany,
      clientEmail: body.clientEmail,
      budget: body.budget,
    });

    const requested = (body.currency ?? "").toUpperCase();
    const currency = CURRENCIES.has(requested)
      ? requested
      : context.company.baseCurrency || "USD";
    const actor = { userId: c.get("userId"), userEmail: c.get("userEmail") };

    const jobId = await createJob({ kind: "BRIEF" });

    runJob(jobId, async () => {
      const { draft, house, meta } = await generate(context, { currency });

      const created = await createProposalRecord(
        {
          title: draft.title,
          clientName: draft.clientName || body.clientName || null,
          clientCompany: draft.clientCompany || body.clientCompany || null,
          clientEmail: body.clientEmail || null,
          projectName: draft.projectName || null,
          currency,
          publicNotes: draft.publicNotes || null,
          internalNotes: composeInternalNotes(draft, null, "a typed brief"),
          sections: draft.sections,
          pricingMode: "LINE_ITEMS",
          lineItems: draft.lineItems,
          depositAmount: depositAmount(draft),
          expiresAt: expiryDate(draft.expiresInDays),
          theme: house.theme,
          designPresetId: house.designPresetId,
          designTokens: house.designTokens,
          brandColor: house.brandColor,
        },
        actor,
        { action: "AI_DRAFTED_FROM_BRIEF", meta },
      );

      return { proposalId: created.id, warnings: draft.warnings, meta };
    });

    return c.json({ jobId });
  })

  /**
   * Poll a drafting job.
   *
   * The only endpoint the browser hits while it waits. Returns the proposal id
   * once there is one, so the caller can navigate straight to it.
   */
  .get("/ai/jobs/:jobId", async (c) => {
    const job = await getJob(c.req.param("jobId"));
    if (!job) throw new HTTPException(404, { message: "Job not found" });

    return c.json({
      id: job.id,
      kind: job.kind,
      status: job.status,
      proposalId: job.proposalId,
      error: job.error,
      warnings: Array.isArray(job.warnings) ? job.warnings : [],
    });
  })

  /**
   * Rewrite an existing draft.
   *
   * `keepPricing` / `keepSections` let a salesperson re-run one half after
   * hand-editing the other — regenerating everything would silently discard
   * the edits, which is the fastest way to make people stop pressing the
   * button.
   */
  .post("/:id/ai/regenerate", async (c) => {
    requireConfigured();

    const id = c.req.param("id");
    const body = await c.req
      .json<{ notes?: string; keepPricing?: boolean; keepSections?: boolean }>()
      .catch(
        () =>
          ({}) as { notes?: string; keepPricing?: boolean; keepSections?: boolean },
      );

    const [existing] = await crmDb
      .select()
      .from(crmProposals)
      .where(and(eq(crmProposals.id, id), isNull(crmProposals.deletedAt)))
      .limit(1);
    if (!existing) throw new HTTPException(404, { message: "Not found" });

    // Checked here as well as inside updateProposalRecord so a signed proposal
    // does not spend a minute of model time before being refused.
    if (existing.status === "APPROVED" || existing.status === "PAID") {
      throw new HTTPException(409, {
        message: `This proposal is ${existing.status} and can no longer be edited. Duplicate it instead.`,
      });
    }

    if (!existing.sourceLeadId) {
      throw new HTTPException(400, {
        message:
          "This proposal was not created from a lead, so there is nothing to redraft it from.",
      });
    }

    const context = await buildDraftContext(existing.sourceLeadId, id);
    if (!context) {
      throw new HTTPException(404, {
        message: "The lead this proposal came from no longer exists.",
      });
    }

    const currency = existing.currency || "USD";
    const notes = body.notes?.slice(0, MAX_NOTES);
    const { keepPricing, keepSections } = body;
    const userId = c.get("userId");

    const jobId = await createJob({
      kind: "REGENERATE",
      leadId: existing.sourceLeadId,
      proposalId: id,
    });

    runJob(jobId, async () => {
      const { draft, house, meta } = await generate(context, {
        currency,
        notes,
        keepPricing,
        keepSections,
      });

      /*
       * Keeping the pricing but rewriting the sections would leave the pricing
       * TABLE showing the numbers the model just invented while the line items
       * — and therefore the amount charged — stayed as they were. Rebuild the
       * table from the rows that are actually staying.
       */
      if (body.keepPricing && !body.keepSections) {
        const kept = await crmDb
          .select({
            description: crmProposalLineItems.description,
            quantity: crmProposalLineItems.quantity,
            unitPrice: crmProposalLineItems.unitPrice,
            discountPercent: crmProposalLineItems.discountPercent,
          })
          .from(crmProposalLineItems)
          .where(eq(crmProposalLineItems.proposalId, id))
          .orderBy(crmProposalLineItems.position);

        const keptLines: DraftLineItem[] = kept.map((line) => ({
          description: line.description ?? "",
          quantity: Number(line.quantity ?? 1),
          unitPrice: Number(line.unitPrice ?? 0),
          discountPercent: Number(line.discountPercent ?? 0),
        }));

        draft.sections = buildPricingRows(draft.sections, keptLines, currency);
      }

      await updateProposalRecord(
        id,
        {
          title: draft.title,
          projectName: draft.projectName || null,
          publicNotes: draft.publicNotes || null,
          internalNotes: composeInternalNotes(draft, context.lead.upworkJobUrl),
          expiresAt: expiryDate(draft.expiresInDays),
          /*
           * Backfill the branding, but never overwrite it. A proposal drafted
           * before this existed has no preset and renders in the default blue;
           * redrafting is a reasonable moment to fix that. One that already has
           * a look — including a deliberately different one — keeps it.
           */
          ...(existing.designPresetId
            ? {}
            : {
                theme: house.theme,
                designPresetId: house.designPresetId,
                designTokens: house.designTokens,
                brandColor: house.brandColor,
              }),
          // Omitting a field leaves it untouched — that is how "keep mine"
          // works here, rather than reading the old value and writing it back.
          ...(body.keepSections ? {} : { sections: draft.sections }),
          ...(body.keepPricing
            ? {}
            : {
                pricingMode: "LINE_ITEMS" as const,
                lineItems: draft.lineItems,
                depositAmount: depositAmount(draft),
              }),
        },
        { userId },
        { action: "AI_REGENERATED", meta },
      );

      return { proposalId: id, warnings: draft.warnings, meta };
    });

    return c.json({ jobId });
  });

export default ai;
