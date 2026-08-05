/**
 * Collecting money on a proposal, via Stripe Checkout.
 *
 * WHY CHECKOUT AND NOT PAYMENT ELEMENTS: Elements needs a publishable key in
 * the bundle, a card form we host, and therefore a PCI surface we own. Checkout
 * hands the payer to a Stripe-hosted page and returns them afterwards. For an
 * agency collecting a deposit on a proposal that is strictly better — nothing
 * sensitive touches our origin, it works from an emailed link with no app
 * session, and Stripe maintains the form.
 *
 * The key in production is a RESTRICTED key (rk_live). Verified scopes:
 * payment_intents, checkout/sessions, customers, webhook_endpoints — all the
 * write paths used here. It cannot read the account object, which nothing needs.
 * A restricted key that covers the job is preferable to a full secret key.
 *
 * NOTHING HERE MARKS A PROPOSAL PAID. Only the webhook does
 * (payments/stripe-webhook.ts), because the browser returning to a success URL
 * proves the payer came back, not that the money settled.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import crmDb from "../database/crm";
import { crmProposals } from "../database/crm-schema";
import {
  EXCLUDED_PAYMENT_METHOD_TYPES,
  getStripe,
  isStripeConfigured,
} from "../payments/stripe";
import { rowsOf } from "../database/rows";

const payments = new Hono<{ Variables: { userId: string; userEmail: string } }>();

/**
 * Stripe refuses charges below a per-currency floor (error `amount-too-small`).
 * Checking here turns an opaque 500 into a sentence that says what to change:
 * a 1% deposit on a $3.92 proposal is 4 cents, and no card network will move it.
 */
const MIN_CHARGE: Record<string, number> = {
  usd: 0.5,
  eur: 0.5,
  gbp: 0.3,
  aed: 2,
  inr: 0.5,
};

/** Percentage Stripe takes, used when the fee is passed to the client. */
const DEFAULT_FEE_PERCENT = 3.5;

async function feePercent(): Promise<number> {
  // One settings row; the column carries its own default of 3.5. Raw SQL
  // because Proposal_Settings is not in crm-schema.ts — one column is not worth
  // a table definition.
  const rows = rowsOf(await crmDb.execute(
    sql`SELECT "stripeFeePercent" FROM "Proposal_Settings" LIMIT 1`,
  ));
  const raw = rows?.[0]?.stripeFeePercent;
  const parsed = raw == null ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : DEFAULT_FEE_PERCENT;
}

/**
 * Create a hosted payment page for this proposal and return its URL.
 *
 * `portion` picks what is being collected:
 *   deposit  — the upfront amount already agreed on the proposal
 *   balance  — grand total minus the deposit, for the second invoice
 *   full     — the whole thing
 *
 * VK asked for exactly this shape on the call: 25% up front and "the remaining
 * 75%, I have to send individual Stripe link" — so the balance is a first-class
 * option rather than something to be improvised later.
 */
payments.post("/:id/checkout-session", async (c) => {
  if (!isStripeConfigured()) {
    throw new HTTPException(503, {
      message: "Stripe is not configured on this server",
    });
  }

  const id = c.req.param("id");
  const body = await c.req
    .json<{ portion?: "deposit" | "balance" | "full" }>()
    .catch(() => ({}) as { portion?: "deposit" | "balance" | "full" });
  const portion = body.portion ?? "deposit";

  const [proposal] = await crmDb
    .select()
    .from(crmProposals)
    .where(and(eq(crmProposals.id, id), isNull(crmProposals.deletedAt)))
    .limit(1);

  if (!proposal) throw new HTTPException(404, { message: "Not found" });

  const grand = Number(proposal.grandTotal ?? 0);
  const deposit = Number(proposal.depositAmount ?? 0);
  if (!Number.isFinite(grand) || grand <= 0) {
    throw new HTTPException(400, {
      message: "This proposal has no total to charge",
    });
  }

  const base =
    portion === "full"
      ? grand
      : portion === "balance"
        ? Math.max(0, grand - deposit)
        : deposit > 0
          ? deposit
          : grand;

  if (base <= 0) {
    throw new HTTPException(400, {
      message:
        portion === "balance"
          ? "Nothing left to collect — the deposit covers the total"
          : "That portion is zero",
    });
  }

  const currencyKey = (proposal.currency ?? "USD").toLowerCase();
  const floor = MIN_CHARGE[currencyKey] ?? 0.5;
  if (base < floor) {
    const cur = currencyKey.toUpperCase();
    throw new HTTPException(400, {
      message:
        `That comes to ${cur} ${base.toFixed(2)}, below Stripe's ${cur} ${floor.toFixed(2)} minimum. ` +
        (portion === "deposit"
          ? "Raise the upfront percentage or the proposal total."
          : "Charge the full amount instead."),
    });
  }

  /*
   * The client pays the processing fee (VK's decision, 2026-07-29). Shown as
   * its own line so the invoice explains itself rather than presenting a total
   * that does not match the proposal and inviting the question.
   */
  const pct = await feePercent();
  const fee = Math.round(base * (pct / 100) * 100) / 100;

  const currency = currencyKey;
  const label =
    portion === "deposit"
      ? `Deposit — ${proposal.title}`
      : portion === "balance"
        ? `Balance — ${proposal.title}`
        : proposal.title;

  const baseUrl = process.env.DIALER_PUBLIC_BASE_URL ?? "https://crmx1.nuraview.com";

  let session: Awaited<
    ReturnType<ReturnType<typeof getStripe>["checkout"]["sessions"]["create"]>
  >;
  try {
    session = await getStripe().checkout.sessions.create({
    mode: "payment",
    // Crypto is never on offer — see EXCLUDED_PAYMENT_METHOD_TYPES. The hosted
    // page reads the Dashboard's method list too, so it needs the same guard as
    // the PaymentIntents.
    excluded_payment_method_types: [...EXCLUDED_PAYMENT_METHOD_TYPES],
    // Prefilled but editable — the payer may want the receipt elsewhere.
    customer_email: proposal.clientEmail ?? undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: Math.round(base * 100),
          product_data: { name: label },
        },
      },
      ...(fee > 0
        ? [
            {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: Math.round(fee * 100),
                product_data: { name: `Card processing fee (${pct}%)` },
              },
            },
          ]
        : []),
    ],
    // Carried onto the PaymentIntent so the webhook can find the proposal
    // without trusting anything the browser sends back.
    payment_intent_data: {
      metadata: { proposalId: proposal.id, portion },
      description: label,
    },
    metadata: { proposalId: proposal.id, portion },
      success_url: `${baseUrl}/proposal/${proposal.number}/${proposal.clientSlug}?paid=1`,
      cancel_url: `${baseUrl}/proposal/${proposal.number}/${proposal.clientSlug}`,
    });
  } catch (error) {
    // Stripe explains itself well; passing its message through beats a 500 that
    // sends someone to the server logs to find out what they typed wrong.
    const message =
      (error as { raw?: { message?: string } }).raw?.message ??
      (error as Error).message ??
      "Stripe rejected the request";
    console.error("[stripe] checkout session failed:", message);
    throw new HTTPException(400, { message: `Stripe: ${message}` });
  }

  // Record the intent so the webhook's lookup by paymentIntentId resolves, and
  // so a second click reuses rather than orphans the first.
  if (typeof session.payment_intent === "string") {
    await crmDb
      .update(crmProposals)
      .set({
        stripePaymentIntentId: session.payment_intent,
        paymentProvider: "stripe",
        updatedAt: new Date(),
      })
      .where(eq(crmProposals.id, proposal.id));
  }

  return c.json({
    url: session.url,
    amount: base,
    fee,
    total: base + fee,
    currency: currency.toUpperCase(),
    portion,
  });
});

export default payments;
