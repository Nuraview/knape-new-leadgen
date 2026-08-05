import { Decimal } from "decimal.js";
import {
  computeInvoiceTotals,
  computeLineTotal,
  type LineInput,
} from "./invoice-totals";

export { computeLineTotal };
export type { LineInput };

export interface ProposalTotals {
  subtotal: Decimal;
  discountTotal: Decimal;
  taxTotal: Decimal;
  transactionFee: Decimal;
  grandTotal: Decimal;
}

const TWO_DP = 2;

/**
 * Line-item pricing: delegates to the invoice totals engine, then adds an
 * optional flat transaction fee on top of the grand total.
 */
export function computeProposalTotals(
  lines: LineInput[],
  transactionFee: Decimal = new Decimal(0),
): ProposalTotals {
  const t = computeInvoiceTotals(lines);
  const fee = transactionFee.toDecimalPlaces(TWO_DP);
  return {
    subtotal: t.subtotal,
    discountTotal: t.discountTotal,
    taxTotal: t.vatTotal,
    transactionFee: fee,
    grandTotal: t.grandTotal.add(fee).toDecimalPlaces(TWO_DP),
  };
}

/**
 * Fixed-price pricing: a single agreed amount, no line items. The fixed price
 * is the subtotal and grand total (+ optional transaction fee).
 */
export function computeFixedPriceTotals(
  fixedPrice: Decimal,
  transactionFee: Decimal = new Decimal(0),
): ProposalTotals {
  const sub = fixedPrice.toDecimalPlaces(TWO_DP);
  const fee = transactionFee.toDecimalPlaces(TWO_DP);
  return {
    subtotal: sub,
    discountTotal: new Decimal(0),
    taxTotal: new Decimal(0),
    transactionFee: fee,
    grandTotal: sub.add(fee).toDecimalPlaces(TWO_DP),
  };
}
