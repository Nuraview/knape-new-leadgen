/**
 * The client-facing proposal: read, approve, reject.
 *
 * UNAUTHENTICATED BY DESIGN. The share token IS the credential — the recipient
 * is a prospect, not a user, and the URLs are already sitting in their inboxes.
 * That makes the token handling the whole security story:
 *
 *   - looked up by token ONLY; the number and slug in the URL are cosmetic and
 *     are never trusted for lookup, so guessing #1024 gets you nothing
 *   - a soft-deleted or EXPIRED proposal is a 404, not a 403 — telling a
 *     stranger that a document exists but is off-limits is itself a leak
 *   - approve/reject are idempotent on terminal states, because clients
 *     double-click and email clients prefetch links
 *
 * Ported from apps/web/app/proposal/[number]/[slug]/ and
 * apps/web/app/api/proposals/public/[token]/*, which is the last thing keeping
 * the legacy Next app alive.
 */
import { Decimal } from "decimal.js";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import crmDb from "../database/crm";
import {
  crmProposalActivity,
  crmProposalAssets,
  crmProposalLineItems,
  crmProposals,
  invoices,
} from "../database/crm-schema";
import { rowsOf } from "../database/rows";
import {
  capturePaypalOrder,
  createPaypalOrder,
  isPaypalConfigured,
} from "../payments/paypal";
import {
  createProposalPaymentIntent,
  isStripeConfigured,
} from "../payments/stripe";
import { put } from "../storage/objects";
import { convertProposalToInvoice } from "./lib/convert-to-invoice";
import { depositSplit } from "./lib/deposit";
import { buildInvoiceUrl } from "../invoice/lib/token";
import {
  PAYMENT_METHOD_META,
  normalizePaymentMethod,
} from "./lib/payment-methods";
import { decodeSignaturePng } from "./lib/signature";
import {
  sendFundsReceivedEmail,
  sendProposalSignedNotification,
  sendSignedCopyToClient,
} from "./lib/signed-notify";
import { tierUnitPrice } from "./lib/tiers";
import { computeLineTotal, computeProposalTotals } from "./lib/totals";

const publicProposal = new Hono();

/** Statuses that can no longer be decided on. */
const TERMINAL = new Set(["APPROVED", "REJECTED", "PAID", "EXPIRED"]);

async function loadByToken(token: string) {
  if (!token || token.length < 16) {
    // Short tokens are never real; refusing early keeps the DB out of a
    // brute-force loop.
    throw new HTTPException(404, { message: "Not found" });
  }

  const [proposal] = await crmDb
    .select()
    .from(crmProposals)
    .where(
      and(eq(crmProposals.shareToken, token), isNull(crmProposals.deletedAt)),
    )
    .limit(1);

  if (!proposal || proposal.status === "EXPIRED") {
    throw new HTTPException(404, { message: "Not found" });
  }
  return proposal;
}

/**
 * Everything the public page renders, plus a view count bump.
 *
 * The line items are returned separately rather than embedded in `sections`
 * because pricing is authoritative — it is what the client agrees to — and it
 * must not depend on whatever the sections editor happened to save.
 */
publicProposal.get("/:token", async (c) => {
  const proposal = await loadByToken(c.req.param("token"));
  const now = new Date();

  // Fire-and-forget: a failed counter must never stop a client reading their
  // own proposal.
  void crmDb
    .update(crmProposals)
    .set({
      viewCount: sql`COALESCE(${crmProposals.viewCount}, 0) + 1`,
      firstViewedAt: proposal.firstViewedAt ?? now,
      lastViewedAt: now,
      // Seeing it counts as delivery; SENT -> VIEWED so the dashboard is honest.
      status: proposal.status === "SENT" ? "VIEWED" : proposal.status,
    })
    .where(eq(crmProposals.id, proposal.id))
    .catch(() => undefined);

  const lineItems = rowsOf(await crmDb.execute(
    sql`SELECT id, position, description, quantity, "unitPrice",
               "discountPercent", "lineSubtotal", "lineTotal",
               "clientAdjustable", "minQty", "maxQty", tiers
        FROM "crm_Proposal_LineItems"
        WHERE "proposalId" = ${proposal.id}
        ORDER BY position ASC`,
  ));

  const assets = rowsOf(await crmDb.execute(
    // Columns verified against information_schema — there is no `url` or
    // `caption`; assets carry a storageKey and a title, and the public URL is
    // derived from the key. Guessing this cost a 500 on the client-facing page.
    sql`SELECT id, kind, title, "storageKey", "previewStorageKey", "pageCount",
               "fileSize", category, featured, "externalUrl", position
        FROM "crm_Proposal_Assets"
        WHERE "proposalId" = ${proposal.id}
        ORDER BY position ASC`,
  ));

  const settings = rowsOf(await crmDb.execute(
    sql`SELECT "companyName", "companyEmail", "companyWebsite", "brandColor",
               "accentColor", "footerText", "bankName", "bankAccountName",
               "bankAccountNumber", "bankIban", "bankSwift", "bankRouting",
               "bankInstructions", "scheduleCallUrl"
        FROM "Proposal_Settings" LIMIT 1`,
  ));

  return c.json({
    proposal: {
      id: proposal.id,
      number: proposal.number,
      title: proposal.title,
      status: proposal.status,
      clientName: proposal.clientName,
      clientCompany: proposal.clientCompany,
      clientAddress: proposal.clientAddress,
      projectName: proposal.projectName,
      currency: proposal.currency,
      sections: proposal.sections ?? [],
      subtotal: proposal.subtotal,
      discountTotal: proposal.discountTotal,
      grandTotal: proposal.grandTotal,
      depositAmount: proposal.depositAmount,
      /*
       * The agreed upfront share, as a percentage of whatever the total turns
       * out to be. The client page multiplies it by the live total (which moves
       * with the payment method's fee and any adjustable quantities), so the
       * figure it shows is the figure the approve endpoint will charge.
       */
      depositPercent: (() => {
        const split = depositSplit(proposal, Number(proposal.grandTotal) || 0);
        return split.staged ? Math.round(split.ratio * 10000) / 100 : null;
      })(),
      publicNotes: proposal.publicNotes,
      videoUrl: proposal.videoUrl,
      scheduleCallUrl: proposal.scheduleCallUrl,
      expiresAt: proposal.expiresAt,
      proposalDate: proposal.proposalDate,
      decisionAt: proposal.decisionAt,
      approvedByName: proposal.approvedByName,
      theme: proposal.theme,
      brandColor: proposal.brandColor,
      // The design system the client actually approved: accent colour, fonts,
      // background and layout live here, and the view falls back through
      // designTokens -> brandColor -> settings -> #e2611e exactly as legacy did.
      designTokens: proposal.designTokens,
      portfolioConfig: proposal.portfolioConfig,
      designPresetId: proposal.designPresetId,
      pricingMode: proposal.pricingMode,
      fixedPrice: proposal.fixedPrice,
      taxTotal: proposal.taxTotal,
      transactionFee: proposal.transactionFee,
      processingFee: proposal.processingFee,
      shareToken: proposal.shareToken,
      clientEmail: proposal.clientEmail,
      rejectionReason: proposal.rejectionReason,
    },
    lineItems,
    assets,
    settings: settings?.[0] ?? null,
    /*
     * PUBLISHABLE payment keys, served to the page.
     *
     * The payment panel used to read process.env.NEXT_PUBLIC_STRIPE_… — a
     * Next-ism carried into a Vite bundle, where `process` does not exist in
     * the browser. The module threw ReferenceError on evaluation, so after
     * signing the client landed on the pay page and NOTHING rendered. Serving
     * the key from here also means the same bundle works on crmx1,
     * proposals. and invoices. hosts with no rebuild.
     *
     * Publishable/client IDs only — never the secret key.
     */
    payments: {
      stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null,
      paypalClientId: process.env.PAYPAL_CLIENT_ID ?? null,
    },
  });
});

/**
 * The client accepts. Records who, when, and how they signed.
 *
 * DRAFT is deliberately accepted alongside SENT and VIEWED: a proposal shared
 * by link without pressing Send stays DRAFT, and refusing those would break the
 * common path of pasting a link into a chat.
 */
publicProposal.post("/:token/approve", async (c) => {
  const token = c.req.param("token");
  const proposal = await loadByToken(token);

  if (TERMINAL.has(proposal.status ?? "")) {
    // Already decided. Answer 200 with the existing state rather than 409 —
    // the usual cause is a double-click or a link prefetch, and showing a
    // stranger an error for succeeding twice is just confusing.
    return c.json({
      success: true,
      status: proposal.status,
      alreadyDecided: true,
      payment: null,
    });
  }

  /*
   * The FULL legacy pipeline (apps/web .../approve/route.ts), not the typed-
   * name stub this used to be. The stub recorded the approval and returned
   * {ok} — no drawn-signature handling, no client-adjusted quantities, no fee
   * recompute, no invoice, and crucially no Stripe PaymentIntent, so the page
   * had no clientSecret and the card form never appeared. That is the
   * "Approval failed" VK hit on the call (the SPA also couldn't reach this
   * route at its legacy path — mounted there now too, see index.ts).
   */
  const body = await c.req
    .json<{
      name?: string;
      email?: string | null;
      signatureType?: string;
      signatureData?: string;
      paymentMethod?: string;
      clientTimeline?: string | null;
      adjustedQuantities?: Record<string, number | string>;
    }>()
    .catch(() => ({}) as Record<string, never>);

  const name = body.name?.trim();
  if (!name) {
    throw new HTTPException(400, { message: "Please enter your name to sign" });
  }
  if (!body.signatureData) {
    throw new HTTPException(400, { message: "Please sign to approve" });
  }

  const lineItems = await crmDb
    .select()
    .from(crmProposalLineItems)
    .where(eq(crmProposalLineItems.proposalId, proposal.id))
    .orderBy(asc(crmProposalLineItems.position));

  // ---- Recompute line items with client-adjusted quantities (authoritative) ----
  const adjusted = body.adjustedQuantities ?? {};
  const lineInputs = lineItems.map((li) => {
    const adj = adjusted[String(li.position)];
    const qty =
      li.clientAdjustable && adj ? new Decimal(adj) : new Decimal(li.quantity);
    // Volume tiers: effective unit price for the (possibly adjusted) quantity.
    const unit = tierUnitPrice(
      Number(li.unitPrice),
      qty.toNumber(),
      li.tiers as never,
    );
    return {
      raw: li,
      quantity: qty,
      unitPrice: new Decimal(unit),
      discountPercent: new Decimal(li.discountPercent),
      taxRate: new Decimal(li.taxRateSnapshot ?? "0"),
    };
  });

  for (const l of lineInputs) {
    const lt = computeLineTotal(l);
    await crmDb
      .update(crmProposalLineItems)
      .set({
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString(), // lock in the agreed (tier) price
        lineSubtotal: lt.lineSubtotal.toString(),
        lineVat: lt.lineVat.toString(),
        lineTotal: lt.lineTotal.toString(),
      })
      .where(eq(crmProposalLineItems.id, l.raw.id));
  }

  // Dynamic processing fee: % of the base total by chosen payment method
  // (Stripe 3.5 / PayPal 5 / Direct 0). Authoritative server-side.
  const method = normalizePaymentMethod(body.paymentMethod);
  const pct = new Decimal(PAYMENT_METHOD_META[method]?.pct ?? 0);
  const base = computeProposalTotals(lineInputs, new Decimal(0));
  const procFee = base.grandTotal.mul(pct).div(100).toDecimalPlaces(2);
  const totals = computeProposalTotals(lineInputs, procFee);

  // ---- Signature ----
  let signatureStorageKey: string | null = null;
  let signatureTypedName: string | null = null;
  const signatureType = body.signatureType === "DRAWN" ? "DRAWN" : "TYPED";
  if (signatureType === "DRAWN") {
    try {
      const png = decodeSignaturePng(body.signatureData);
      const { url } = await put(
        `proposals/${proposal.id}/signature-${Date.now()}.png`,
        png,
        { contentType: "image/png" },
      );
      signatureStorageKey = url;
    } catch {
      throw new HTTPException(400, { message: "Invalid signature" });
    }
  } else {
    signatureTypedName = body.signatureData.slice(0, 200);
  }

  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    null;

  const settings = rowsOf(
    await crmDb.execute(
      sql`SELECT "companyName", "bankName", "bankAccountName",
                 "bankAccountNumber", "bankIban", "bankSwift", "bankRouting",
                 "bankInstructions"
            FROM "Proposal_Settings" LIMIT 1`,
    ),
  )[0] as Record<string, string | null> | undefined;

  const now = new Date();
  await crmDb
    .update(crmProposals)
    .set({
      status: "APPROVED",
      decisionAt: now,
      approvedByName: name,
      approvedByEmail: body.email?.trim() || null,
      signatureType,
      signatureTypedName,
      signatureStorageKey,
      // Kept for dispute resolution — who accepted, from where.
      signatureIpAddress: ip,
      paymentMethod: method,
      processingFee: procFee.toString(),
      subtotal: totals.subtotal.toString(),
      discountTotal: totals.discountTotal.toString(),
      taxTotal: totals.taxTotal.toString(),
      transactionFee: totals.transactionFee.toString(),
      grandTotal: totals.grandTotal.toString(),
      updatedAt: now,
    })
    .where(eq(crmProposals.id, proposal.id));

  await crmDb.insert(crmProposalActivity).values({
    id: crypto.randomUUID(),
    proposalId: proposal.id,
    actorId: null,
    action: "APPROVED",
    meta: {
      name,
      email: body.email ?? null,
      signatureType,
      paymentMethod: method,
      clientTimeline: body.clientTimeline ?? null,
      ip,
    },
    createdAt: now,
  });

  /*
   * ---- Staged billing ----
   *
   * "25% upfront" is agreed on the proposal and was, until now, thrown away at
   * the one moment it matters: the client signed and was asked for 100%. The
   * split is worked out against the FINAL, fee-inclusive total so the deposit
   * carries its share of the processing fee.
   */
  const split = depositSplit(proposal, totals.grandTotal.toNumber());

  // ---- Auto-generate the invoice ----
  let invoiceId: string | null = null;
  let amount = split.dueNow;
  try {
    const inv = await convertProposalToInvoice(proposal.id, {
      depositDue: split.staged ? split.dueNow : null,
    });
    invoiceId = inv.invoiceId;
    amount = inv.amount;
    await crmDb.insert(crmProposalActivity).values({
      id: crypto.randomUUID(),
      proposalId: proposal.id,
      actorId: null,
      action: "CONVERTED",
      meta: { invoiceId },
      createdAt: new Date(),
    });
  } catch (e) {
    console.error("[proposal approve] convert failed:", e);
  }

  // ---- Notify the team + email the signer their copy (both best-effort) ----
  await sendProposalSignedNotification({
    title: proposal.title,
    number: proposal.number,
    currency: proposal.currency,
    signerName: name,
    signerEmail: body.email ?? null,
    method,
    total: totals.grandTotal.toNumber(),
    fee: procFee.toNumber(),
    ip,
    shareToken: token,
  });

  {
    const host = c.req.header("x-forwarded-host") || c.req.header("host");
    const proto = c.req.header("x-forwarded-proto") || "https";
    const url =
      host && proposal.number != null
        ? `${proto}://${host}/proposal/${proposal.number}/${proposal.clientSlug}?t=${token}`
        : null;
    await sendSignedCopyToClient({
      to: body.email,
      signerName: name,
      title: proposal.title,
      number: proposal.number,
      currency: proposal.currency,
      total: totals.grandTotal.toNumber(),
      method,
      url,
      companyName: settings?.companyName ?? null,
    });
  }

  /*
   * ---- Build the payment response by method ----
   *
   * What the client is charged NOW: the deposit on a staged proposal, the whole
   * total otherwise. `amount` came back from the invoice, so a re-signature of
   * an already part-paid proposal collects the outstanding balance rather than
   * starting again.
   */
  const chargeAmount = amount;

  if (method === "stripe") {
    let clientSecret: string | null = null;
    if (isStripeConfigured() && chargeAmount > 0) {
      try {
        const intent = await createProposalPaymentIntent({
          amount: chargeAmount, // fee-inclusive
          currency: proposal.currency,
          description: `Proposal #${proposal.number ?? ""} — ${proposal.title}`,
          metadata: { proposalId: proposal.id, invoiceId: invoiceId ?? "" },
          receiptEmail: body.email ?? null,
        });
        clientSecret = intent.clientSecret;
        await crmDb
          .update(crmProposals)
          .set({
            stripePaymentIntentId: intent.id,
            stripeCustomerId: intent.customerId,
            paymentProvider: "stripe",
          })
          .where(eq(crmProposals.id, proposal.id));
      } catch (e) {
        console.error("[proposal approve] stripe intent failed:", e);
      }
    }
    return c.json({
      success: true,
      payment: {
        amount: chargeAmount,
        method: "stripe",
        clientSecret,
        invoiceId,
        fee: procFee.toNumber(),
        /*
         * The staged split, so the payment step can say what this charge is
         * for. Null on a proposal billed in one go.
         */
        deposit: split.staged
          ? {
              dueNow: split.dueNow,
              remaining: split.remaining,
              percent: Math.round(split.ratio * 100),
              total: totals.grandTotal.toNumber(),
            }
          : null,
        /*
         * Where to send the client next. VK: "why show proposal again in
         * invoices — show the actual invoice." The hand-off used to re-render
         * the whole proposal on the invoices host with the payment state
         * smuggled through the query string; now it lands on the real invoice
         * page, which fetches its own totals and mints its own PaymentIntent
         * from the database.
         */
        invoiceUrl: invoiceId ? buildInvoiceUrl(invoiceId) : null,
      },
    });
  }

  if (method === "paypal") {
    await crmDb
      .update(crmProposals)
      .set({ paymentProvider: "paypal" })
      .where(eq(crmProposals.id, proposal.id));
    return c.json({
      success: true,
      payment: {
        amount,
        method: "paypal",
        clientSecret: null,
        invoiceId,
        paypalConfigured: isPaypalConfigured(),
        invoiceUrl: invoiceId ? buildInvoiceUrl(invoiceId) : null,
      },
    });
  }

  // Bank transfer — record pending, hand back the account details.
  await crmDb.insert(crmProposalActivity).values({
    id: crypto.randomUUID(),
    proposalId: proposal.id,
    actorId: null,
    action: "BANK_PENDING",
    meta: { amount },
    createdAt: new Date(),
  });
  const bank = settings
    ? {
        bankName: settings.bankName ?? null,
        bankAccountName: settings.bankAccountName ?? null,
        bankAccountNumber: settings.bankAccountNumber ?? null,
        bankIban: settings.bankIban ?? null,
        bankSwift: settings.bankSwift ?? null,
        bankRouting: settings.bankRouting ?? null,
        bankInstructions: settings.bankInstructions ?? null,
      }
    : null;
  return c.json({
    success: true,
    payment: {
      amount,
      method: "bank",
      clientSecret: null,
      invoiceId,
      bank,
      invoiceUrl: invoiceId ? buildInvoiceUrl(invoiceId) : null,
    },
  });
});

/**
 * PayPal create/capture for an approved proposal. Ported from the legacy
 * paypal route; gated on env credentials exactly as before.
 */
publicProposal.post("/:token/paypal", async (c) => {
  if (!isPaypalConfigured()) {
    return c.json({ error: "PayPal not configured" }, 503);
  }
  const proposal = await loadByToken(c.req.param("token"));
  const action = c.req.query("action");

  if (action === "create") {
    try {
      const order = (await createPaypalOrder({
        amount: parseFloat(proposal.grandTotal) || 0,
        currency: proposal.currency,
        description: `Proposal #${proposal.number ?? ""} — ${proposal.title}`,
      })) as { id: string };
      await crmDb
        .update(crmProposals)
        .set({ paypalOrderId: order.id, paymentProvider: "paypal" })
        .where(eq(crmProposals.id, proposal.id));
      return c.json({ orderId: order.id });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "PayPal create failed" },
        500,
      );
    }
  }

  if (action === "capture") {
    const { orderId } = await c.req
      .json<{ orderId?: string }>()
      .catch(() => ({}) as { orderId?: string });
    if (!orderId) return c.json({ error: "Missing orderId" }, 400);
    try {
      const capture = (await capturePaypalOrder(orderId)) as {
        status?: string;
        purchase_units?: {
          payments?: { captures?: { id?: string }[] };
        }[];
      };
      if (capture?.status !== "COMPLETED") {
        return c.json({ error: "Payment not completed" }, 402);
      }
      const captureId =
        capture?.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? orderId;
      const now = new Date();
      if (proposal.status !== "PAID") {
        await crmDb
          .update(crmProposals)
          .set({
            status: "PAID",
            paidAt: now,
            paypalCaptureId: captureId,
            updatedAt: now,
          })
          .where(eq(crmProposals.id, proposal.id));
        await crmDb.insert(crmProposalActivity).values({
          id: crypto.randomUUID(),
          proposalId: proposal.id,
          actorId: null,
          action: "PAID",
          meta: { provider: "paypal", captureId },
          createdAt: now,
        });
        if (proposal.linkedInvoiceId) {
          await crmDb
            .update(invoices)
            .set({
              status: "PAID",
              paidTotal: proposal.grandTotal,
              balanceDue: "0",
              updatedAt: now,
            })
            .where(eq(invoices.id, proposal.linkedInvoiceId));
        }
        await sendFundsReceivedEmail(proposal);
      }
      return c.json({ success: true });
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "PayPal capture failed" },
        500,
      );
    }
  }

  return c.json({ error: "Unknown action" }, 400);
});

/**
 * Portfolio/PDF assets embedded in the public page. New uploads store a full
 * public URL; legacy rows store a MinIO key that publicUrl() resolves against
 * the same bucket.
 */
publicProposal.get("/:token/asset/:assetId", async (c) => {
  const proposal = await loadByToken(c.req.param("token"));

  const [asset] = await crmDb
    .select()
    .from(crmProposalAssets)
    .where(
      and(
        eq(crmProposalAssets.id, c.req.param("assetId")),
        eq(crmProposalAssets.proposalId, proposal.id),
      ),
    )
    .limit(1);
  if (!asset) throw new HTTPException(404, { message: "Not found" });

  const key = asset.storageKey;
  const { publicUrl } = await import("../storage/objects");
  return c.redirect(/^https?:\/\//.test(key) ? key : publicUrl(key));
});

publicProposal.post("/:token/reject", async (c) => {
  const proposal = await loadByToken(c.req.param("token"));

  if (TERMINAL.has(proposal.status ?? "")) {
    return c.json({ ok: true, status: proposal.status, alreadyDecided: true });
  }

  const body = await c.req
    .json<{ reason?: string }>()
    .catch(() => ({}) as { reason?: string });

  const now = new Date();
  await crmDb
    .update(crmProposals)
    .set({
      status: "REJECTED",
      decisionAt: now,
      rejectionReason: body.reason?.trim() || null,
      updatedAt: now,
    })
    .where(eq(crmProposals.id, proposal.id));

  await crmDb.insert(crmProposalActivity).values({
    id: crypto.randomUUID(),
    proposalId: proposal.id,
    actorId: null,
    action: "REJECTED",
    meta: { reason: body.reason ?? null },
    createdAt: now,
  });

  return c.json({ ok: true, status: "REJECTED" });
});

export default publicProposal;
