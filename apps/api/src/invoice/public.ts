/**
 * The client-facing invoice: read it, pay it by card.
 *
 * UNAUTHENTICATED BY DESIGN, exactly like the public proposal — the recipient
 * is a client, not a user, and the link in their inbox is the credential. Here
 * the credential is an HMAC over the invoice id (lib/token.ts), so a share
 * link needs no column on the Invoices table and guessing an id gets you
 * nothing.
 *
 * This is the "Steve with Uncorp" path from the 2026-07-30 meeting: a client
 * who never signed a proposal but is ready to pay.
 */
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import crmDb from "../database/crm";
import {
  crmAccounts,
  invoiceLineItems,
  invoices,
} from "../database/crm-schema";
import {
  EXCLUDED_PAYMENT_METHOD_TYPES,
  getStripe,
  isStripeConfigured,
  type StripeMode,
  stripePublishableKey,
} from "../payments/stripe";
import { rowsOf } from "../database/rows";
import { sql } from "drizzle-orm";
import { verifyInvoiceToken } from "./lib/token";

const publicInvoice = new Hono();

/**
 * TEST INVOICES.
 *
 * VK needs to walk the whole flow — link, card form, "paid" — without money
 * moving. An invoice created with the test flag carries `[test]` in
 * internalNotes (a staff-only column; the client never sees it) and resolves to
 * Stripe's TEST keys, where card 4242 4242 4242 4242 succeeds and nothing is
 * charged.
 *
 * The flag is on the ROW, set by an admin at creation. It is deliberately not a
 * query parameter: `?test=1` on a payment page would let anyone mark a real
 * invoice paid with a test card.
 */
function invoiceMode(internalNotes: string | null | undefined): StripeMode {
  return internalNotes?.startsWith("[test]") ? "test" : "live";
}

async function loadByIdAndToken(id: string, token: string | undefined) {
  // Wrong or missing token is a 404, never a 403: telling a stranger that an
  // invoice exists but is off-limits is itself a leak.
  if (!verifyInvoiceToken(id, token)) {
    throw new HTTPException(404, { message: "Not found" });
  }

  const [row] = await crmDb
    .select()
    .from(invoices)
    .where(eq(invoices.id, id))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Not found" });
  return row;
}

/** Everything the pay page renders. */
publicInvoice.get("/:id", async (c) => {
  const id = c.req.param("id");
  const row = await loadByIdAndToken(id, c.req.query("t"));

  const lineItems = await crmDb
    .select({
      id: invoiceLineItems.id,
      description: invoiceLineItems.description,
      quantity: invoiceLineItems.quantity,
      unitPrice: invoiceLineItems.unitPrice,
      lineTotal: invoiceLineItems.lineTotal,
    })
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, id))
    .orderBy(asc(invoiceLineItems.position));

  const [account] = row.accountId
    ? await crmDb
        .select({ name: crmAccounts.name })
        .from(crmAccounts)
        .where(eq(crmAccounts.id, row.accountId))
        .limit(1)
    : [];

  const settings = rowsOf(
    await crmDb.execute(
      sql`SELECT "companyName", "companyWebsite", "companyAddress",
                 "companyEmail", "companyPhone", "logoStorageKey",
                 "brandColor", "footerText", "bankName",
                 "bankAccountName", "bankAccountNumber", "bankIban",
                 "bankSwift", "bankRouting", "bankInstructions"
            FROM "Proposal_Settings" LIMIT 1`,
    ),
  )[0] as Record<string, string | null> | undefined;

  return c.json({
    invoice: {
      id: row.id,
      status: row.status,
      currency: row.currency,
      issueDate: row.issueDate,
      dueDate: row.dueDate,
      subtotal: row.subtotal,
      vatTotal: row.vatTotal,
      grandTotal: row.grandTotal,
      balanceDue: row.balanceDue,
      // What has already cleared. A staged invoice ("25% upfront") is part-paid
      // for most of its life, and a page that cannot say so reads as a demand
      // for money the client already sent.
      paidTotal: row.paidTotal,
      publicNotes: row.publicNotes,
      // The $21 that used to appear out of nowhere between subtotal and total.
      billingSnapshot: row.billingSnapshot ?? null,
    },
    lineItems,
    clientName: account?.name ?? null,
    settings: settings ?? null,
    payments: {
      // Publishable key only — same reasoning as the proposal page. A test
      // invoice gets the TEST publishable key, so the card form it renders
      // talks to Stripe's test environment.
      stripePublishableKey: stripePublishableKey(invoiceMode(row.internalNotes)),
      testMode: invoiceMode(row.internalNotes) === "test",
    },
  });
});

/**
 * Mint (or reuse) the PaymentIntent for this invoice.
 *
 * Amount comes from the DATABASE, never the request: a client-supplied amount
 * on a payment endpoint is a discount button. Reusing the stored intent keeps a
 * page refresh from stacking half-finished intents in Stripe.
 *
 * The intent carries invoiceId in metadata so the webhook can mark this row
 * paid — the browser's confirmation resolves before Stripe finalises and a page
 * that can be closed mid-flight is not a payment record.
 */
publicInvoice.post("/:id/payment-intent", async (c) => {
  const id = c.req.param("id");
  const row = await loadByIdAndToken(id, c.req.query("t"));

  if (row.status === "PAID") {
    return c.json({ alreadyPaid: true, clientSecret: null });
  }
  const mode = invoiceMode(row.internalNotes);
  if (!isStripeConfigured(mode)) {
    return c.json(
      {
        error:
          mode === "test"
            ? "Stripe test keys are not configured on this server"
            : "Card payment is not configured",
      },
      503,
    );
  }

  const due = Number(row.balanceDue ?? row.grandTotal) || 0;
  if (due <= 0) {
    return c.json({ error: "Nothing to pay" }, 400);
  }

  const stripe = getStripe(mode);
  const intent = await stripe.paymentIntents.create({
    amount: Math.round(due * 100),
    currency: row.currency.toLowerCase(),
    description: `Invoice ${row.id.slice(0, 8)}`,
    metadata: { invoiceId: row.id, mode },
    automatic_payment_methods: { enabled: true },
    // Crypto is never on offer — see EXCLUDED_PAYMENT_METHOD_TYPES.
    excluded_payment_method_types: [...EXCLUDED_PAYMENT_METHOD_TYPES],
  });

  return c.json({
    clientSecret: intent.client_secret,
    /*
     * What this invoice ACCEPTS, straight from the intent.
     *
     * The Payment Element renders only what the buyer's own country can use —
     * Klarna and Afterpay are hidden for a buyer in India however they are
     * configured, and no client-side option overrides that. Returning the
     * full list lets the page say "Klarna accepted" truthfully instead of
     * looking like it was never enabled.
     *
     * Excluded methods are filtered out again here: the intent still echoes
     * what the account has enabled, and naming crypto on an invoice that will
     * not render it is exactly the mis-statement this list exists to avoid.
     */
    paymentMethodTypes: (intent.payment_method_types ?? []).filter(
      (t) =>
        !(EXCLUDED_PAYMENT_METHOD_TYPES as readonly string[]).includes(t),
    ),
  });
});

export default publicInvoice;
