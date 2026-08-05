/**
 * The upfront split — mirror of apps/api/src/proposal/lib/deposit.ts.
 *
 * This app still serves the client share links, so the fix has to live in both
 * or a signed proposal keeps asking for 100% when 25% was agreed. Keep the two
 * in step; the API copy carries the full reasoning.
 */

export type DepositSource = {
  depositAmount: string | number | null | undefined;
  grandTotal: string | number | null | undefined;
  subtotal?: string | number | null | undefined;
};

export type DepositSplit = {
  staged: boolean;
  ratio: number;
  dueNow: number;
  remaining: number;
};

const num = (v: string | number | null | undefined): number => {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function depositSplit(
  source: DepositSource,
  chargeable: number,
): DepositSplit {
  const total = round2(Math.max(0, num(chargeable)));
  const stored = num(source.depositAmount);
  const basis = num(source.grandTotal) || num(source.subtotal);

  if (stored <= 0 || basis <= 0 || total <= 0) {
    return { staged: false, ratio: 0, dueNow: total, remaining: 0 };
  }

  const ratio = stored / basis;
  if (ratio >= 0.995) {
    return { staged: false, ratio: 1, dueNow: total, remaining: 0 };
  }

  const dueNow = round2(total * ratio);
  const remaining = round2(total - dueNow);

  if (dueNow <= 0 || remaining <= 0) {
    return { staged: false, ratio: 0, dueNow: total, remaining: 0 };
  }

  return { staged: true, ratio, dueNow, remaining };
}
