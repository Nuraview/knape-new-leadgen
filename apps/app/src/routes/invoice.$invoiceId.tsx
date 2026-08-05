/**
 * The client-facing invoice — /invoice/:id?t=<token>
 *
 * Served on invoices.nuraview.com (meeting 2026-07-30: proposals and invoices
 * get their own branded hosts, never crmx1). Public by design: the HMAC in `t`
 * is the credential, so no login stands between a client and paying.
 *
 * Two ways a client arrives here: they signed a proposal and were handed off,
 * or VK created the invoice by hand and sent the link (the non-signer).
 *
 * DESIGN INTENT. VK: "the entire invoice page looks like a shitty scam page."
 * He was right, and the worst offender was arithmetic, not styling — the old
 * layout showed "Subtotal $600 / Amount due $621" with the $21 unexplained.
 * Nothing reads as a scam faster than a total that does not add up. So this
 * page states every number it charges, names the company it comes from, and
 * says who is processing the card:
 *
 *   - real letterhead: logo, company name, address, email, phone, website
 *   - FROM and BILLED TO blocks, the way a bill is actually laid out
 *   - invoice number and issue/due dates
 *   - every component of the total on its own line — subtotal, processing fee,
 *     tax — so the figure at the bottom is arithmetic the client can follow
 *   - "Payments are processed by Stripe. This page never sees your card."
 *   - a PAID stamp and a printable view once settled
 *
 * Brand colour comes from Proposal_Settings, so it matches the proposal the
 * client just read rather than looking like a different company's page.
 */
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { CheckCircle2, Loader2, Lock, Printer } from "lucide-react";
import { useMemo, useState } from "react";
import { getApiUrl } from "@/fetchers/get-api-url";

type Line = {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
};

type BillingSnapshot = {
  clientName?: string | null;
  clientCompany?: string | null;
  clientEmail?: string | null;
  clientAddress?: string | null;
  processingFee?: string | null;
  paymentMethod?: string | null;
  proposalNumber?: number | null;
  /** Staged billing: what was due at signature, and what follows it. */
  depositDue?: string | null;
  depositRemaining?: string | null;
};

type Payload = {
  invoice: {
    id: string;
    status: string;
    currency: string;
    issueDate: string | null;
    dueDate: string | null;
    subtotal: string;
    vatTotal: string;
    grandTotal: string;
    balanceDue: string;
    paidTotal?: string | null;
    publicNotes: string | null;
    billingSnapshot: BillingSnapshot | null;
  };
  lineItems: Line[];
  clientName: string | null;
  settings: Record<string, string | null> | null;
  payments: { stripePublishableKey: string | null; testMode?: boolean };
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-stone-50 p-8 text-center text-stone-600">
      <div>{children}</div>
    </div>
  );
}

/**
 * The card / wallet form.
 *
 * The status handling here is the important part. `confirmPayment` with
 * `redirect: "if_required"` resolves WITHOUT an error for methods that merely
 * need a further step — Cash App shows a QR, and dismissing that QR unpaid
 * still comes back error-free. Treating "no error" as success told a client
 * "Payment received" when nothing had been paid: VK closed the QR without
 * scanning and got a green tick. That is the worst possible lie for this page
 * to tell, because work gets delivered against it.
 *
 * So the PaymentIntent's own status decides, and nothing else.
 */
function CardForm({
  label,
  brand,
  onPaid,
}: {
  label: string;
  brand: string;
  onPaid: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"paid" | "processing" | null>(null);

  if (outcome === "paid") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-2 size-7 text-emerald-600" />
        <p className="font-medium text-emerald-800">Payment received</p>
        <p className="mt-1 text-sm text-emerald-700">
          Thank you — a receipt is on its way to your inbox.
        </p>
      </div>
    );
  }

  if (outcome === "processing") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center">
        <Loader2 className="mx-auto mb-2 size-6 animate-spin text-amber-600" />
        <p className="font-medium text-amber-800">Payment processing</p>
        <p className="mt-1 text-sm text-amber-700">
          Your bank is still confirming this one. We will email you the moment it
          clears — there is no need to pay again.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy || !stripe}
        onClick={async () => {
          if (!stripe || !elements) return;
          setBusy(true);
          setError(null);
          /*
           * return_url is REQUIRED for every redirect-based method — Cash App,
           * Klarna, Amazon Pay, Link, Bank. Without it Stripe rejects
           * the confirm outright, so anything other than a card was dead on
           * arrival.
           */
          const res = await stripe.confirmPayment({
            elements,
            confirmParams: { return_url: window.location.href },
            redirect: "if_required",
          });

          setBusy(false);

          if (res.error) {
            setError(res.error.message ?? "Payment failed");
            return;
          }

          const status = res.paymentIntent?.status;
          if (status === "succeeded") {
            setOutcome("paid");
            onPaid();
            return;
          }
          if (status === "processing") {
            setOutcome("processing");
            onPaid();
            return;
          }
          // requires_action / requires_payment_method / canceled — the client
          // backed out of the QR or wallet step. Not paid. Say nothing
          // reassuring.
          setError(
            "Payment not completed. Nothing has been charged — you can try again, or choose another method.",
          );
        }}
        className="w-full rounded-lg px-5 py-3.5 font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
        style={{ background: brand }}
      >
        {busy ? "Processing…" : `Pay ${label}`}
      </button>
      <p className="flex items-center justify-center gap-1.5 text-xs text-stone-400">
        <Lock className="size-3" />
        Payments are processed by Stripe. This page never sees your card details.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  strong = false,
  muted = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={`flex justify-between ${strong ? "text-base font-semibold text-stone-900" : muted ? "text-stone-500" : "text-stone-600"}`}
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function RouteComponent() {
  const { invoiceId } = Route.useParams();
  const { t: token, redirect_status: redirectStatus } = useSearch({
    from: "/invoice/$invoiceId",
  });

  const q = useQuery({
    queryKey: ["public-invoice", invoiceId, token],
    queryFn: async (): Promise<Payload> => {
      const r = await fetch(
        getApiUrl(`invoice-public/${invoiceId}?t=${encodeURIComponent(token)}`),
      );
      if (!r.ok) throw new Error("This invoice link is not valid.");
      return r.json();
    },
    enabled: Boolean(token),
    retry: false,
  });

  const intent = useMutation({
    mutationFn: async (): Promise<{
      clientSecret: string | null;
      paymentMethodTypes?: string[];
    }> => {
      const r = await fetch(
        getApiUrl(
          `invoice-public/${invoiceId}/payment-intent?t=${encodeURIComponent(token)}`,
        ),
        { method: "POST" },
      );
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const pk = q.data?.payments.stripePublishableKey ?? null;
  const stripePromise = useMemo(() => (pk ? loadStripe(pk) : null), [pk]);

  if (!token) return <Shell>This link is missing its access token.</Shell>;
  if (q.isLoading) {
    return (
      <Shell>
        <Loader2 className="size-5 animate-spin" />
      </Shell>
    );
  }
  if (q.isError || !q.data) {
    return <Shell>This invoice link is not valid, or it has expired.</Shell>;
  }

  const { invoice, lineItems, clientName, settings, payments } = q.data;
  const snap = invoice.billingSnapshot ?? {};
  const currency = invoice.currency;
  const brand = settings?.brandColor || "#1c1917";
  const company = settings?.companyName || "NuraView";

  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      }).format(n);
    } catch {
      return `${currency} ${n.toFixed(2)}`;
    }
  };

  const subtotal = Number(invoice.subtotal) || 0;
  const vat = Number(invoice.vatTotal) || 0;
  const grand = Number(invoice.grandTotal) || 0;
  /*
   * The fee is whatever the total is not otherwise accounted for. Taking it
   * from the snapshot when present and deriving it otherwise means the column
   * of numbers ALWAYS adds up to the amount charged — the previous page left a
   * silent $21 gap, which is precisely what made it look fraudulent.
   */
  const fee = snap.processingFee
    ? Number(snap.processingFee) || 0
    : Math.max(0, Math.round((grand - subtotal - vat) * 100) / 100);

  const due = Number(invoice.balanceDue ?? invoice.grandTotal) || 0;
  /*
   * Staged billing — "25% upfront, balance on completion".
   *
   * The client agreed a percentage on the proposal, so the invoice must ask for
   * that percentage and say what happens to the rest. Asking for the full total
   * here (which is what this page used to do, because the deposit never left the
   * proposal editor) is the fastest way to lose a signed deal.
   */
  const alreadyPaid = Number(invoice.paidTotal ?? 0) || 0;
  /*
   * Returning from Stripe says a PAYMENT succeeded, not that the INVOICE is
   * settled — the webhook is what credits it, and on a staged invoice the
   * deposit clearing leaves a balance. Treating redirect_status=succeeded as
   * "paid in full" would stamp PAID over an invoice with 75% outstanding.
   */
  const settledNow = redirectStatus === "succeeded" && alreadyPaid + due >= grand - 0.01;
  const paid = invoice.status === "PAID" || settledNow;
  /** A deposit just cleared; the webhook may not have caught up yet. */
  const depositReceipt = !paid && redirectStatus === "succeeded";
  const staged = !paid && due > 0 && due < grand - 0.009;
  const afterThis = Math.max(0, Math.round((grand - alreadyPaid - due) * 100) / 100);
  const clientSecret = intent.data?.clientSecret ?? null;
  const METHOD_NAMES: Record<string, string> = {
    card: "Card",
    link: "Link",
    cashapp: "Cash App Pay",
    klarna: "Klarna",
    afterpay_clearpay: "Afterpay",
    affirm: "Affirm",
    amazon_pay: "Amazon Pay",
    us_bank_account: "US bank transfer",
    ideal: "iDEAL",
    bancontact: "Bancontact",
    eps: "EPS",
    giropay: "giropay",
    pay_by_bank: "Pay by Bank",
  };
  /*
   * Crypto is excluded on the intent itself (see the API's
   * EXCLUDED_PAYMENT_METHOD_TYPES). Filtering again here means an intent minted
   * before that change — or any method we later stop taking — never gets named
   * on the invoice as something the client can pay with.
   */
  const NEVER_OFFERED = ["crypto"];
  const accepted = (intent.data?.paymentMethodTypes ?? [])
    .filter((t) => !NEVER_OFFERED.includes(t))
    .map((t) => METHOD_NAMES[t] ?? t.replace(/_/g, " "));
  const billedTo = snap.clientCompany || clientName || snap.clientName || null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-stone-100">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        {payments.testMode ? (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-center text-sm font-medium text-amber-800">
            TEST INVOICE — Stripe test mode. No money will be charged.
          </div>
        ) : null}

        {/* ---------------- the document ---------------- */}
        <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04),0_12px_32px_-16px_rgba(0,0,0,0.12)]">
          {/* Brand bar — ties the invoice to the proposal the client just read */}
          <div className="h-1.5" style={{ background: brand }} />

          <div className="p-6 sm:p-10">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                {/*
                  The real mark, not a typeface impression of it.

                  An account that uploaded its own logo keeps it. Otherwise a
                  company still trading as NuraView gets the NuraView wordmark —
                  the same asset the website ships. A company that renamed itself
                  keeps the serif name instead: printing our logo over someone
                  else's business name is worse than plain text.

                  The asset is white-on-transparent (it lives on the site's dark
                  header), so `invert` renders it black for this white document.
                */}
                {settings?.logoStorageKey ? (
                  <>
                    <img
                      src={settings.logoStorageKey}
                      alt={company}
                      className="mb-3 h-8 object-contain"
                    />
                    <div
                      className="text-xl font-semibold text-stone-900"
                      style={{
                        fontFamily: "Georgia, 'Times New Roman', serif",
                      }}
                    >
                      {company}
                    </div>
                  </>
                ) : company.trim().toLowerCase() === "nuraview" ? (
                  <img
                    src="/nuraview-logo.png"
                    alt="NuraView"
                    className="h-7 w-auto object-contain invert"
                  />
                ) : (
                  <div
                    className="text-xl font-semibold text-stone-900"
                    style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
                  >
                    {company}
                  </div>
                )}
                <div className="mt-1 space-y-0.5 text-xs leading-relaxed text-stone-500">
                  {settings?.companyAddress ? (
                    <div className="whitespace-pre-line">
                      {settings.companyAddress}
                    </div>
                  ) : null}
                  {settings?.companyEmail ? (
                    <div>{settings.companyEmail}</div>
                  ) : null}
                  {settings?.companyPhone ? (
                    <div>{settings.companyPhone}</div>
                  ) : null}
                  {settings?.companyWebsite ? (
                    <div>{settings.companyWebsite}</div>
                  ) : null}
                </div>
              </div>

              <div className="text-right">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">
                  Invoice
                </div>
                <div className="mt-1 font-mono text-sm font-medium text-stone-800">
                  #{invoice.id.slice(0, 8).toUpperCase()}
                </div>
                <dl className="mt-3 space-y-1 text-xs text-stone-500">
                  {invoice.issueDate ? (
                    <div className="flex justify-end gap-2">
                      <dt>Issued</dt>
                      <dd className="text-stone-700">
                        {new Date(invoice.issueDate).toLocaleDateString()}
                      </dd>
                    </div>
                  ) : null}
                  {invoice.dueDate ? (
                    <div className="flex justify-end gap-2">
                      <dt>Due</dt>
                      <dd className="text-stone-700">
                        {new Date(invoice.dueDate).toLocaleDateString()}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {paid ? (
                  <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    <CheckCircle2 className="size-3.5" />
                    Paid
                  </div>
                ) : null}
              </div>
            </div>

            {/* FROM / BILLED TO — how a bill is actually laid out */}
            <div className="mt-8 grid grid-cols-1 gap-6 border-t border-stone-100 pt-6 sm:grid-cols-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">
                  Billed to
                </div>
                <div className="mt-1.5 text-sm font-medium text-stone-900">
                  {billedTo ?? "—"}
                </div>
                <div className="mt-0.5 space-y-0.5 text-xs text-stone-500">
                  {snap.clientName && snap.clientName !== billedTo ? (
                    <div>{snap.clientName}</div>
                  ) : null}
                  {snap.clientEmail ? <div>{snap.clientEmail}</div> : null}
                  {snap.clientAddress ? (
                    <div className="whitespace-pre-line">
                      {snap.clientAddress}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="sm:text-right">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-400">
                  Amount {paid ? "paid" : "due"}
                </div>
                <div className="mt-1 text-3xl font-semibold text-stone-900">
                  {fmt(paid ? grand : due)}
                </div>
                <div className="text-xs text-stone-500">{currency}</div>
                {staged ? (
                  <div className="mt-1.5 text-xs leading-relaxed text-stone-500">
                    {Math.round((due / grand) * 100)}% upfront of {fmt(grand)}
                    <br />
                    {fmt(afterThis)} due on completion
                  </div>
                ) : null}
              </div>
            </div>

            {/* Line items */}
            <div className="mt-8 overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-[11px] uppercase tracking-wider text-stone-400">
                    <th className="py-2.5 text-left font-semibold">
                      Description
                    </th>
                    <th className="py-2.5 text-right font-semibold">Qty</th>
                    <th className="py-2.5 text-right font-semibold">
                      Unit price
                    </th>
                    <th className="py-2.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems.map((l) => (
                    <tr key={l.id} className="border-b border-stone-100">
                      <td className="py-3.5 pe-3 align-top text-stone-800">
                        {l.description}
                      </td>
                      <td className="py-3.5 text-right align-top tabular-nums text-stone-500">
                        {Number(l.quantity)}
                      </td>
                      <td className="py-3.5 text-right align-top tabular-nums text-stone-500">
                        {fmt(Number(l.unitPrice) || 0)}
                      </td>
                      <td className="py-3.5 text-right align-top font-medium tabular-nums text-stone-900">
                        {fmt(Number(l.lineTotal) || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals — every component named, so the bottom line adds up */}
            <div className="mt-5 flex justify-end">
              <div className="w-full space-y-1.5 text-sm sm:w-72">
                <Row label="Subtotal" value={fmt(subtotal)} muted />
                {fee > 0 ? (
                  <Row
                    label={
                      snap.paymentMethod === "paypal"
                        ? "Processing fee (PayPal)"
                        : "Processing fee (card)"
                    }
                    value={fmt(fee)}
                    muted
                  />
                ) : null}
                {vat > 0 ? <Row label="Tax" value={fmt(vat)} muted /> : null}
                <div className="border-t border-stone-200 pt-2">
                  <Row label="Total" value={fmt(grand)} strong />
                </div>
                {paid ? (
                  <Row label="Paid" value={`− ${fmt(grand)}`} muted />
                ) : alreadyPaid > 0 ? (
                  <Row label="Paid so far" value={`− ${fmt(alreadyPaid)}`} muted />
                ) : null}
                {paid ? (
                  <div className="border-t border-stone-200 pt-2">
                    <Row label="Balance" value={fmt(0)} strong />
                  </div>
                ) : staged || alreadyPaid > 0 ? (
                  <div className="space-y-1.5 border-t border-stone-200 pt-2">
                    <Row label="Due now" value={fmt(due)} strong />
                    {afterThis > 0 ? (
                      <Row
                        label="Due on completion"
                        value={fmt(afterThis)}
                        muted
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {invoice.publicNotes ? (
              <p className="mt-8 border-t border-stone-100 pt-5 whitespace-pre-line text-sm text-stone-500">
                {invoice.publicNotes}
              </p>
            ) : null}
          </div>
        </div>

        {/* ---------------- payment ---------------- */}
        <div className="mt-5 rounded-2xl border border-stone-200 bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] sm:p-8">
          {paid ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-2 size-8 text-emerald-600" />
              <p className="text-lg font-semibold text-stone-900">
                Paid in full
              </p>
              <p className="mt-1 text-sm text-stone-500">
                Thank you — nothing further is due on this invoice.
              </p>
              <button
                type="button"
                onClick={() => window.print()}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
              >
                <Printer className="size-3.5" />
                Print / save PDF
              </button>
            </div>
          ) : depositReceipt ? (
            <div className="text-center">
              <CheckCircle2 className="mx-auto mb-2 size-8 text-emerald-600" />
              <p className="text-lg font-semibold text-stone-900">
                Payment received
              </p>
              <p className="mt-1 text-sm text-stone-500">
                Thank you — your upfront payment has gone through. The remaining{" "}
                {fmt(afterThis > 0 ? afterThis : Math.max(0, grand - alreadyPaid - due))}{" "}
                is due on completion; we will send it to this same page.
              </p>
            </div>
          ) : clientSecret && stripePromise ? (
            <>
              <h2 className="mb-4 text-sm font-semibold text-stone-900">
                Pay this invoice
              </h2>
              {/*
                What the invoice accepts, from the intent itself.

                The Payment Element only renders methods the BUYER's country can
                use: Klarna and Afterpay are enabled on the account and present
                on every intent, yet Stripe hides them for a buyer in a country
                they do not serve, and no client-side option changes that. Saying
                so plainly beats looking mis-configured — and a client in the US,
                UK or EU sees those options appear on their own.
              */}
              {accepted.length > 0 ? (
                <p className="mb-4 text-xs text-stone-400">
                  Accepts {accepted.join(", ")} — the options below are the ones
                  available in your country.
                </p>
              ) : null}
              <Elements
                stripe={stripePromise}
                options={{
                  clientSecret,
                  appearance: {
                    theme: "stripe",
                    variables: { colorPrimary: brand, borderRadius: "8px" },
                  },
                }}
              >
                <CardForm
                  label={fmt(due)}
                  brand={brand}
                  onPaid={() => {
                    // The webhook is the record; refetch so the page ends up
                    // showing the row's own PAID state, not a local flag.
                    setTimeout(() => void q.refetch(), 2500);
                  }}
                />
              </Elements>
            </>
          ) : (
            <div className="text-center">
              <p className="text-sm text-stone-600">
                Pay securely by card, Link, Cash App, Klarna or bank — whichever
                is available in your country.
              </p>
              <button
                type="button"
                disabled={intent.isPending || !pk}
                onClick={() => intent.mutate()}
                className="mt-4 w-full rounded-lg px-5 py-3.5 font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: brand }}
              >
                {intent.isPending ? "Preparing…" : `Pay ${fmt(due)}`}
              </button>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-stone-400">
                <Lock className="size-3" />
                Payments are processed by Stripe. This page never sees your card
                details.
              </p>
              {intent.isError ? (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  Card payment is unavailable right now. Please reply to the
                  email and we will sort it out.
                </p>
              ) : null}
              {!pk ? (
                <p className="mt-3 text-sm text-stone-500">
                  Card payment is not configured yet.
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* Bank details, when the company publishes them — a real alternative
            to card for a client who prefers a transfer. */}
        {!paid && settings?.bankName ? (
          <details className="mt-4 rounded-2xl border border-stone-200 bg-white p-5 text-sm">
            <summary className="cursor-pointer font-medium text-stone-800">
              Prefer a bank transfer?
            </summary>
            <div className="mt-3 space-y-1 text-stone-600">
              {settings.bankName ? <div>Bank: {settings.bankName}</div> : null}
              {settings.bankAccountName ? (
                <div>Account name: {settings.bankAccountName}</div>
              ) : null}
              {settings.bankAccountNumber ? (
                <div>Account no.: {settings.bankAccountNumber}</div>
              ) : null}
              {settings.bankIban ? <div>IBAN: {settings.bankIban}</div> : null}
              {settings.bankSwift ? <div>SWIFT: {settings.bankSwift}</div> : null}
              {settings.bankRouting ? (
                <div>Routing: {settings.bankRouting}</div>
              ) : null}
              <div className="pt-1 font-medium text-stone-800">
                Reference: #{invoice.id.slice(0, 8).toUpperCase()}
              </div>
              {settings.bankInstructions ? (
                <p className="pt-2 whitespace-pre-line text-stone-500">
                  {settings.bankInstructions}
                </p>
              ) : null}
            </div>
          </details>
        ) : null}

        <p className="mt-8 text-center text-xs leading-relaxed text-stone-400">
          {settings?.footerText || `${company} · Thank you for your business.`}
          {snap.proposalNumber ? (
            <span className="block">
              Issued against proposal #{snap.proposalNumber}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/invoice/$invoiceId")({
  validateSearch: (raw: Record<string, unknown>) => ({
    t: typeof raw.t === "string" ? raw.t : "",
    /*
     * Stripe appends these to return_url after a redirect method completes.
     * They must be declared or the router drops them and the client returns to
     * a page that looks like nothing happened.
     */
    redirect_status:
      typeof raw.redirect_status === "string" ? raw.redirect_status : undefined,
    payment_intent:
      typeof raw.payment_intent === "string" ? raw.payment_intent : undefined,
  }),
  component: RouteComponent,
});
