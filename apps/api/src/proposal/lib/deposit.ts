/**
 * The upfront split — what a client pays on signing, and what is left after.
 *
 * The proposal editor asks for a PERCENTAGE ("25% upfront") and stores the
 * money it works out to, in `depositAmount`, against the draft's own total.
 * Everything downstream then ignored it: the approve handler minted a
 * PaymentIntent for the full grand total, the auto-created invoice carried
 * balanceDue = grand total, and a client who agreed to pay 25% up front was
 * asked for 100% at the last step. Only the internal "Collect deposit" button
 * ever read the field.
 *
 * A RATIO, not the stored amount, is what travels forward. Two reasons:
 *
 *   - the total moves between drafting and signing. The processing fee is only
 *     known once the client picks a method (Stripe 3.5%, PayPal 5%, bank 0),
 *     and client-adjustable quantities are recomputed at signature. A stored
 *     $1.25 against a total that became $5.18 is no longer 25% of anything.
 *   - a percentage is what was actually agreed, so a percentage is what should
 *     survive. The deposit carries its share of the fee with it rather than
 *     leaving the fee to be swallowed by the final invoice.
 */

export type DepositSource = {
  depositAmount: string | number | null | undefined;
  /** The draft totals the deposit was worked out against. */
  grandTotal: string | number | null | undefined;
  subtotal?: string | number | null | undefined;
};

export type DepositSplit = {
  /** True when this proposal is billed in two parts. */
  staged: boolean;
  /** Fraction of the total due at signature — 0 when there is no deposit. */
  ratio: number;
  /** Money due now, fee-inclusive, 2dp. Equals the total when not staged. */
  dueNow: number;
  /** What is still owed after `dueNow` clears. 0 when not staged. */
  remaining: number;
};

const num = (v: string | number | null | undefined): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * @param source     the proposal row as drafted (deposit + the totals it was
 *                   computed against)
 * @param chargeable the CURRENT total to split — fee-inclusive, as recomputed
 *                   at signature
 */
export function depositSplit(
  source: DepositSource,
  chargeable: number,
): DepositSplit {
  const total = round2(Math.max(0, num(chargeable)));
  const stored = num(source.depositAmount);
  // The basis the editor divided by. grandTotal is what the editor reads back
  // as a percentage, so it is the basis used here; subtotal covers a draft
  // saved before totals were computed.
  const basis = num(source.grandTotal) || num(source.subtotal);

  if (stored <= 0 || basis <= 0 || total <= 0) {
    return { staged: false, ratio: 0, dueNow: total, remaining: 0 };
  }

  const ratio = stored / basis;
  // A deposit of "100%" (or a rounding artefact above it) is not a deposit —
  // it is the whole invoice, and splitting it would leave a 1-cent second
  // invoice nobody wants to chase.
  if (ratio >= 0.995) {
    return { staged: false, ratio: 1, dueNow: total, remaining: 0 };
  }

  const dueNow = round2(total * ratio);
  const remaining = round2(total - dueNow);

  // Below Stripe's floor the split cannot be charged at all; taking the whole
  // amount beats handing the client a payment page that errors.
  if (dueNow <= 0 || remaining <= 0) {
    return { staged: false, ratio: 0, dueNow: total, remaining: 0 };
  }

  return { staged: true, ratio, dueNow, remaining };
}
