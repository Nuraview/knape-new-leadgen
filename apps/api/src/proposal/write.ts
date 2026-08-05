/**
 * Proposal authoring — create, update, duplicate, share, delete.
 *
 * Ported from the eight server actions in apps/web/actions/proposals/. The
 * legacy versions went through `prismadb`, a Prisma-compat facade over Drizzle
 * whose `include` does not hydrate relations; these talk to Drizzle directly.
 *
 * TOTALS ARE ALWAYS RECOMPUTED SERVER-SIDE, never trusted from the request.
 * The public page lets a client adjust quantities before signing, and the
 * approve route recomputes from those adjusted values — so if the stored totals
 * could be set by whatever the browser posted, the number on the contract and
 * the number charged could differ. decimal.js throughout: floating point on
 * money produces 1499.9999999999998 on a $1,500 proposal.
 */
import { and, eq, isNull } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import crmDb from "../database/crm";
import { requireCrmActorId } from "../lead/crm-actor";
import {
  crmProposalActivity,
  crmProposalAssets,
  crmProposalLineItems,
  crmProposals,
} from "../database/crm-schema";
import { nextProposalNumber } from "./lib/numbering";
import { buildPublicProposalUrl, generateShareToken } from "./lib/share-token";
import { slugify } from "./lib/slug";
import {
  computeFixedPriceTotals,
  computeLineTotal,
  computeProposalTotals,
} from "./lib/totals";

type LineItemInput = {
  description: string;
  quantity?: number | string;
  unitPrice?: number | string;
  discountPercent?: number | string;
  taxRateSnapshot?: number | string | null;
  clientAdjustable?: boolean;
  minQty?: number | string | null;
  maxQty?: number | string | null;
  tiers?: unknown;
};

type ProposalInput = {
  title?: string;
  clientName?: string | null;
  clientCompany?: string | null;
  clientEmail?: string | null;
  clientAddress?: string | null;
  projectName?: string | null;
  currency?: string;
  theme?: string | null;
  videoUrl?: string | null;
  scheduleCallUrl?: string | null;
  sections?: unknown;
  designPresetId?: string | null;
  designTokens?: unknown;
  brandColor?: string | null;
  pricingMode?: "LINE_ITEMS" | "FIXED";
  fixedPrice?: number | string | null;
  transactionFee?: number | string | null;
  depositAmount?: number | string | null;
  expiresAt?: string | null;
  publicNotes?: string | null;
  internalNotes?: string | null;
  isTemplate?: boolean;
  templateName?: string | null;
  sourceLeadId?: string | null;
  lineItems?: LineItemInput[];
};

const dec = (v: unknown, fallback = 0) => {
  if (v === null || v === undefined || v === "") return new Decimal(fallback);
  try {
    return new Decimal(String(v));
  } catch {
    return new Decimal(fallback);
  }
};

/** Money is stored as numeric; Drizzle wants a string. */
const money = (d: Decimal) => d.toFixed(2);

function computeTotals(input: ProposalInput) {
  const fee = dec(input.transactionFee);
  const items = input.lineItems ?? [];

  const lineInputs = items.map((l) => ({
    quantity: dec(l.quantity, 1),
    unitPrice: dec(l.unitPrice),
    discountPercent: dec(l.discountPercent),
    taxRate: dec(l.taxRateSnapshot),
  }));

  const totals =
    input.pricingMode === "FIXED"
      ? computeFixedPriceTotals(dec(input.fixedPrice), fee)
      : computeProposalTotals(lineInputs, fee);

  return { totals, lineInputs };
}

/** Every write leaves a trail; the detail panel renders it. */
async function logActivity(
  proposalId: string,
  actorId: string | null,
  action: string,
  meta?: Record<string, unknown>,
) {
  await crmDb.insert(crmProposalActivity).values({
    id: crypto.randomUUID(),
    proposalId,
    // actorId is a uuid column and the app's user ids are cuid2 — writing a
    // cuid here throws. NULL until the two identity systems are reconciled
    // (see the "align the app admin email with the CRM user" task).
    actorId: null,
    action,
    meta: meta ?? null,
    createdAt: new Date(),
  });
  void actorId;
}

async function replaceLineItems(proposalId: string, input: ProposalInput) {
  const items = input.lineItems ?? [];
  await crmDb
    .delete(crmProposalLineItems)
    .where(eq(crmProposalLineItems.proposalId, proposalId));

  if (items.length === 0) return;

  await crmDb.insert(crmProposalLineItems).values(
    items.map((l, i) => {
      const quantity = dec(l.quantity, 1);
      const unitPrice = dec(l.unitPrice);
      const discountPercent = dec(l.discountPercent);
      const taxRate = dec(l.taxRateSnapshot);
      const line = computeLineTotal({
        quantity,
        unitPrice,
        discountPercent,
        taxRate,
      });
      return {
        id: crypto.randomUUID(),
        proposalId,
        position: i,
        description: l.description,
        quantity: quantity.toString(),
        unitPrice: money(unitPrice),
        discountPercent: discountPercent.toString(),
        taxRateSnapshot: taxRate.isZero() ? null : taxRate.toString(),
        lineSubtotal: money(line.lineSubtotal),
        lineVat: money(line.lineVat),
        lineTotal: money(line.lineTotal),
        clientAdjustable: Boolean(l.clientAdjustable),
        minQty: l.minQty == null ? null : dec(l.minQty).toString(),
        maxQty: l.maxQty == null ? null : dec(l.maxQty).toString(),
        tiers: (l.tiers as never) ?? null,
      };
    }),
  );
}

/**
 * Insert a proposal.
 *
 * Split out of `POST /` so the AI drafting route creates proposals through the
 * exact same path a hand-made one takes — same numbering, same slug, same
 * server-recomputed totals. Two insert sites would drift, and the one that
 * drifted would be the one nobody tests by hand.
 */
export async function createProposalRecord(
  input: ProposalInput,
  actor: { userId: string; userEmail: string },
  activity: { action: string; meta?: Record<string, unknown> } = {
    action: "CREATED",
  },
) {
  if (!input.title?.trim()) {
    throw new HTTPException(400, { message: "A title is required" });
  }

  const { totals } = computeTotals(input);
  const id = crypto.randomUUID();
  const now = new Date();
  const number = await nextProposalNumber();
  const slug = slugify(input.clientCompany || input.clientName || input.title);

  await crmDb.insert(crmProposals).values({
    id,
    number,
    clientSlug: slug,
    title: input.title.trim(),
    status: "DRAFT",
    isTemplate: Boolean(input.isTemplate),
    templateName: input.templateName ?? null,
    /*
     * createdBy is NOT NULL **and** foreign-keyed to "Users".
     *
     * This used to write a fixed zero-uuid, reasoning that a deterministic
     * placeholder beat a random one. Both are wrong against an FK: the
     * constraint rejected it and EVERY proposal save 500'd. The error the
     * client saw was just "Failed (500)".
     *
     * requireCrmActorId resolves the signed-in user and provisions a CRM row
     * if they do not have one yet, so the attribution is real rather than a
     * placeholder or a misattribution to whoever is first in the table.
     */
    createdBy: await requireCrmActorId(actor.userEmail),
    clientName: input.clientName ?? null,
    clientCompany: input.clientCompany ?? null,
    clientEmail: input.clientEmail ?? null,
    clientAddress: input.clientAddress ?? null,
    projectName: input.projectName ?? null,
    proposalDate: now,
    currency: (input.currency || "USD").toUpperCase().slice(0, 3),
    theme: input.theme ?? "creative",
    videoUrl: input.videoUrl ?? null,
    scheduleCallUrl: input.scheduleCallUrl ?? null,
    designPresetId: input.designPresetId ?? null,
    designTokens: (input.designTokens as never) ?? null,
    brandColor: input.brandColor ?? null,
    sections: (input.sections as never) ?? [],
    pricingMode: input.pricingMode ?? "LINE_ITEMS",
    fixedPrice: input.fixedPrice == null ? null : money(dec(input.fixedPrice)),
    subtotal: money(totals.subtotal),
    discountTotal: money(totals.discountTotal),
    taxTotal: money(totals.taxTotal),
    transactionFee: money(totals.transactionFee),
    grandTotal: money(totals.grandTotal),
    depositAmount:
      input.depositAmount == null ? null : money(dec(input.depositAmount)),
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    publicNotes: input.publicNotes ?? null,
    internalNotes: input.internalNotes ?? null,
    sourceLeadId: input.sourceLeadId ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await replaceLineItems(id, input);
  await logActivity(id, actor.userId, activity.action, {
    number,
    ...(activity.meta ?? {}),
  });

  return { id, number, clientSlug: slug };
}

/**
 * Update a proposal head and, when line items are supplied, replace them.
 *
 * Same reasoning as createProposalRecord: the AI regenerate route goes through
 * this rather than writing its own UPDATE, so the APPROVED/PAID lock and the
 * totals recomputation cannot be bypassed by adding a second caller.
 */
export async function updateProposalRecord(
  id: string,
  input: ProposalInput,
  actor: { userId: string },
  activity: { action: string; meta?: Record<string, unknown> } = {
    action: "UPDATED",
  },
) {
  const [existing] = await crmDb
    .select()
    .from(crmProposals)
    .where(and(eq(crmProposals.id, id), isNull(crmProposals.deletedAt)))
    .limit(1);
  if (!existing) throw new HTTPException(404, { message: "Not found" });

  // A signed proposal is a contract. Editing one after approval would change
  // what somebody agreed to, silently and after the fact.
  if (existing.status === "APPROVED" || existing.status === "PAID") {
    throw new HTTPException(409, {
      message: `This proposal is ${existing.status} and can no longer be edited. Duplicate it instead.`,
    });
  }

  const merged: ProposalInput = {
    ...input,
    pricingMode:
      input.pricingMode ??
      (existing.pricingMode as "LINE_ITEMS" | "FIXED" | undefined),
    transactionFee: input.transactionFee ?? existing.transactionFee,
    fixedPrice: input.fixedPrice ?? existing.fixedPrice,
  };
  const { totals } = computeTotals(merged);

  await crmDb
    .update(crmProposals)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.clientName !== undefined
        ? { clientName: input.clientName }
        : {}),
      ...(input.clientCompany !== undefined
        ? { clientCompany: input.clientCompany }
        : {}),
      ...(input.clientEmail !== undefined
        ? { clientEmail: input.clientEmail }
        : {}),
      ...(input.clientAddress !== undefined
        ? { clientAddress: input.clientAddress }
        : {}),
      ...(input.projectName !== undefined
        ? { projectName: input.projectName }
        : {}),
      ...(input.theme !== undefined ? { theme: input.theme } : {}),
      ...(input.videoUrl !== undefined ? { videoUrl: input.videoUrl } : {}),
      ...(input.scheduleCallUrl !== undefined
        ? { scheduleCallUrl: input.scheduleCallUrl }
        : {}),
      ...(input.sections !== undefined
        ? { sections: input.sections as never }
        : {}),
      ...(input.designTokens !== undefined
        ? { designTokens: input.designTokens as never }
        : {}),
      ...(input.brandColor !== undefined
        ? { brandColor: input.brandColor }
        : {}),
      ...(input.expiresAt !== undefined
        ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }
        : {}),
      ...(input.publicNotes !== undefined
        ? { publicNotes: input.publicNotes }
        : {}),
      ...(input.internalNotes !== undefined
        ? { internalNotes: input.internalNotes }
        : {}),
      ...(input.depositAmount !== undefined
        ? {
            depositAmount:
              input.depositAmount == null
                ? null
                : money(dec(input.depositAmount)),
          }
        : {}),
      ...(input.sourceLeadId !== undefined
        ? { sourceLeadId: input.sourceLeadId }
        : {}),
      pricingMode: merged.pricingMode ?? "LINE_ITEMS",
      fixedPrice:
        merged.fixedPrice == null ? null : money(dec(merged.fixedPrice)),
      subtotal: money(totals.subtotal),
      discountTotal: money(totals.discountTotal),
      taxTotal: money(totals.taxTotal),
      transactionFee: money(totals.transactionFee),
      grandTotal: money(totals.grandTotal),
      updatedAt: new Date(),
    })
    .where(eq(crmProposals.id, id));

  if (input.lineItems !== undefined) {
    await replaceLineItems(id, merged);
  }
  await logActivity(id, actor.userId, activity.action, activity.meta);

  return { id, grandTotal: money(totals.grandTotal) };
}

const write = new Hono<{ Variables: { userId: string; userEmail: string } }>()
  /** Create a draft. */
  .post("/", async (c) => {
    const input = await c.req.json<ProposalInput>();
    const created = await createProposalRecord(input, {
      userId: c.get("userId"),
      userEmail: c.get("userEmail"),
    });
    return c.json(created);
  })

  /** Update head + replace line items. Totals recomputed, never trusted. */
  .patch("/:id", async (c) => {
    const input = await c.req.json<ProposalInput>();
    const updated = await updateProposalRecord(c.req.param("id"), input, {
      userId: c.get("userId"),
    });
    return c.json(updated);
  })

  /**
   * Mint or rotate the share token.
   *
   * Rotating invalidates the link already sent — deliberate, it is how you
   * revoke access to a proposal someone forwarded. DRAFT flips to SENT so the
   * list reflects that it is out in the world.
   */
  .post("/:id/share", async (c) => {
    const id = c.req.param("id");
    const rotate = c.req.query("rotate") === "1";

    const [p] = await crmDb
      .select()
      .from(crmProposals)
      .where(and(eq(crmProposals.id, id), isNull(crmProposals.deletedAt)))
      .limit(1);
    if (!p) throw new HTTPException(404, { message: "Not found" });

    const token = !p.shareToken || rotate ? generateShareToken() : p.shareToken;
    const now = new Date();

    await crmDb
      .update(crmProposals)
      .set({
        shareToken: token,
        status: p.status === "DRAFT" ? "SENT" : p.status,
        sentAt: p.sentAt ?? now,
        updatedAt: now,
      })
      .where(eq(crmProposals.id, id));

    await logActivity(id, c.get("userId"), rotate ? "LINK_ROTATED" : "SHARED");

    return c.json({
      token,
      url: buildPublicProposalUrl(p.number ?? 0, p.clientSlug ?? "proposal", token),
    });
  })

  /** Duplicate, or instantiate from a template. Always lands as a DRAFT. */
  .post("/:id/duplicate", async (c) => {
    const sourceId = c.req.param("id");

    const [src] = await crmDb
      .select()
      .from(crmProposals)
      .where(and(eq(crmProposals.id, sourceId), isNull(crmProposals.deletedAt)))
      .limit(1);
    if (!src) throw new HTTPException(404, { message: "Not found" });

    const id = crypto.randomUUID();
    const now = new Date();
    const number = await nextProposalNumber();

    // Everything that describes the DOCUMENT copies; everything that describes
    // its LIFECYCLE does not. A duplicate that inherited shareToken, viewCount
    // or a signature would be a second proposal claiming to have been signed.
    await crmDb.insert(crmProposals).values({
      ...src,
      id,
      number,
      status: "DRAFT",
      isTemplate: false,
      templateName: null,
      sourceTemplateId: src.isTemplate ? src.id : src.sourceTemplateId,
      shareToken: null,
      sentAt: null,
      firstViewedAt: null,
      lastViewedAt: null,
      viewCount: 0,
      decisionAt: null,
      approvedByName: null,
      approvedByEmail: null,
      signatureType: null,
      signatureTypedName: null,
      signatureStorageKey: null,
      signatureIpAddress: null,
      rejectionReason: null,
      paymentMethod: null,
      paymentProvider: null,
      stripePaymentIntentId: null,
      stripeCustomerId: null,
      paypalOrderId: null,
      paypalCaptureId: null,
      paidAt: null,
      linkedInvoiceId: null,
      pdfStorageKey: null,
      pdfGeneratedAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    const items = await crmDb
      .select()
      .from(crmProposalLineItems)
      .where(eq(crmProposalLineItems.proposalId, sourceId));
    if (items.length > 0) {
      await crmDb
        .insert(crmProposalLineItems)
        .values(items.map((l) => ({ ...l, id: crypto.randomUUID(), proposalId: id })));
    }

    const assets = await crmDb
      .select()
      .from(crmProposalAssets)
      .where(eq(crmProposalAssets.proposalId, sourceId));
    if (assets.length > 0) {
      await crmDb
        .insert(crmProposalAssets)
        .values(assets.map((a) => ({ ...a, id: crypto.randomUUID(), proposalId: id })));
    }

    await logActivity(id, c.get("userId"), "DUPLICATED", { from: sourceId });

    return c.json({ id, number });
  })

  /** Save as a reusable template. */
  .post("/:id/save-as-template", async (c) => {
    const id = c.req.param("id");
    const { name } = await c.req
      .json<{ name?: string }>()
      .catch(() => ({}) as { name?: string });

    await crmDb
      .update(crmProposals)
      .set({
        isTemplate: true,
        templateName: name?.trim() || "Untitled template",
        updatedAt: new Date(),
      })
      .where(eq(crmProposals.id, id));

    await logActivity(id, c.get("userId"), "SAVED_AS_TEMPLATE");
    return c.json({ id, isTemplate: true });
  })

  /**
   * Email the proposal to the client.
   *
   * Mints (or reuses) the share token, sends the public link, flips DRAFT to
   * SENT and records the activity. The mail goes through the same tracked
   * marketing pipeline as everything else, so its open lands on the dashboard.
   *
   * NO PDF ATTACHMENT yet, stated rather than implied: the legacy send prints
   * the public page with Chromium and attaches it, and this API image has no
   * Chromium. The link opens the same page the PDF would show. Attachment
   * returns when the PDF pipeline lands.
   */
  .post("/:id/send", async (c) => {
    const id = c.req.param("id");
    const [prop] = await crmDb
      .select()
      .from(crmProposals)
      .where(and(eq(crmProposals.id, id), isNull(crmProposals.deletedAt)))
      .limit(1);
    if (!prop) throw new HTTPException(404, { message: "Not found" });
    if (!prop.clientEmail?.trim()) {
      throw new HTTPException(400, {
        message: "This proposal has no client email.",
      });
    }

    const token = prop.shareToken || generateShareToken();
    const url = buildPublicProposalUrl(
      prop.number ?? 0,
      prop.clientSlug ?? "proposal",
      token,
    );

    const firstName = (prop.clientName ?? "").trim().split(/\s+/)[0] || "there";
    const { sendTrackedFollowup } = await import(
      "../marketing/lib/followup-tracking"
    );
    const r = await sendTrackedFollowup({
      to: prop.clientEmail.trim(),
      subject: `Proposal #${prop.number ?? ""} — ${prop.title}`,
      bodyHtml: [
        `<p>Hi ${firstName},</p>`,
        `<p>Please find your proposal for <strong>${prop.projectName || prop.title}</strong> here:</p>`,
        `<p><a href="${url}">${url}</a></p>`,
        prop.publicNotes ? `<p>${prop.publicNotes}</p>` : "",
        `<p>You can review, sign and approve it directly from that link.</p>`,
      ].join(""),
      accountId: null,
    });
    if (r.error) {
      throw new HTTPException(502, { message: `Send failed: ${r.error}` });
    }

    const now = new Date();
    await crmDb
      .update(crmProposals)
      .set({
        shareToken: token,
        status: prop.status === "DRAFT" ? "SENT" : prop.status,
        sentAt: prop.sentAt ?? now,
        updatedAt: now,
      })
      .where(eq(crmProposals.id, id));
    await logActivity(id, c.get("userId"), "EMAILED", {
      to: prop.clientEmail.trim(),
    });

    return c.json({ sent: true, url });
  })

  /**
   * Soft delete.
   *
   * deletedAt, not a real DELETE: the public page and every token route filter
   * on it, so a deleted proposal stops resolving for clients while the record —
   * and any signature on it — survives. A signed contract is not something to
   * remove rows for.
   */
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    await crmDb
      .update(crmProposals)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(crmProposals.id, id));
    await logActivity(id, c.get("userId"), "DELETED");
    return c.json({ id, deleted: true });
  });

export default write;
export { computeTotals, money, dec };
