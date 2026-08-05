"use client";

import { useMemo, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import {
  PayPalScriptProvider,
  PayPalButtons,
} from "@paypal/react-paypal-js";

const STRIPE_PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const PAYPAL_CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;

function StripeCheckout({ fmt, amount }: { fmt: (n: number) => string; amount: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const pay = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    const { error } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) { setError(error.message ?? "Payment failed"); setBusy(false); }
    else { setDone(true); setBusy(false); }
  };

  if (done) return <div className="text-center text-green-700 font-medium">Funds received — thank you!</div>;
  return (
    <div className="space-y-4">
      <PaymentElement />
      {error && <div className="text-sm text-red-600">{error}</div>}
      <button type="button" disabled={busy || !stripe} onClick={pay} className="w-full px-5 py-3 rounded-md bg-stone-900 text-white font-medium disabled:opacity-50">
        {busy ? "Processing…" : `Pay ${fmt(amount)}`}
      </button>
    </div>
  );
}

export function PaymentPanel({
  token,
  amount,
  method,
  clientSecret,
  bank,
  paypalConfigured,
  fmt,
}: {
  token: string;
  amount: number;
  currency: string;
  method: "stripe" | "paypal" | "bank";
  clientSecret: string | null;
  invoiceId: string | null;
  bank?: Record<string, string | null> | null;
  paypalConfigured?: boolean;
  fmt: (n: number) => string;
}) {
  const stripePromise = useMemo(() => (STRIPE_PK ? loadStripe(STRIPE_PK) : null), []);
  const [paid, setPaid] = useState(false);

  return (
    <div className="rounded-2xl border bg-white p-6 ring-1 ring-stone-200/70">
      <div className="text-center mb-5">
        <div className="text-2xl">🎉</div>
        <h2 className="text-lg font-semibold text-stone-800 mt-1">Thank you — proposal approved!</h2>
        <p className="text-stone-500 text-sm">Complete your payment of {fmt(amount)} to get started.</p>
      </div>

      {method === "stripe" &&
        (STRIPE_PK && clientSecret && stripePromise ? (
          <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "stripe" } }}>
            <StripeCheckout fmt={fmt} amount={amount} />
          </Elements>
        ) : (
          <Fallback amount={amount} fmt={fmt} />
        ))}

      {method === "paypal" &&
        (PAYPAL_CLIENT_ID && paypalConfigured ? (
          paid ? (
            <div className="text-center text-green-700 font-medium">Funds received — thank you!</div>
          ) : (
            <PayPalScriptProvider options={{ clientId: PAYPAL_CLIENT_ID, currency: "USD", intent: "capture" }}>
              <PayPalButtons
                style={{ layout: "vertical" }}
                createOrder={async () => {
                  const r = await fetch(`/api/proposals/public/${token}/paypal?action=create`, { method: "POST" });
                  const j = await r.json();
                  if (!r.ok) throw new Error(j.error || "PayPal error");
                  return j.orderId;
                }}
                onApprove={async (data) => {
                  const r = await fetch(`/api/proposals/public/${token}/paypal?action=capture`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ orderId: data.orderID }),
                  });
                  if (r.ok) setPaid(true);
                }}
              />
            </PayPalScriptProvider>
          )
        ) : (
          <Fallback amount={amount} fmt={fmt} />
        ))}

      {method === "bank" && (
        <div className="rounded-lg bg-stone-50 border p-4 text-sm text-stone-700 space-y-1">
          <div className="font-medium text-stone-800 mb-1">Bank transfer details</div>
          {bank?.bankName && <Line k="Bank" v={bank.bankName} />}
          {bank?.bankAccountName && <Line k="Account name" v={bank.bankAccountName} />}
          {bank?.bankAccountNumber && <Line k="Account no." v={bank.bankAccountNumber} />}
          {bank?.bankIban && <Line k="IBAN" v={bank.bankIban} />}
          {bank?.bankSwift && <Line k="SWIFT" v={bank.bankSwift} />}
          {bank?.bankRouting && <Line k="Routing" v={bank.bankRouting} />}
          <div className="pt-2 font-medium">Amount: {fmt(amount)}</div>
          {bank?.bankInstructions && <p className="pt-2 text-stone-500 whitespace-pre-line">{bank.bankInstructions}</p>}
          {!bank?.bankName && <p className="text-stone-500">Bank details will be emailed to you shortly.</p>}
          <p className="pt-2 text-green-700">Your proposal is approved — we&apos;ll confirm once funds arrive.</p>
        </div>
      )}
    </div>
  );
}

function Line({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-stone-400">{k}</span>
      <span className="font-medium text-stone-800">{v}</span>
    </div>
  );
}

function Fallback({ amount, fmt }: { amount: number; fmt: (n: number) => string }) {
  return (
    <div className="rounded-md bg-stone-50 border p-4 text-center text-sm text-stone-600">
      An invoice for {fmt(amount)} has been created. Payment instructions will follow shortly by email.
    </div>
  );
}
