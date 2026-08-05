/**
 * Minimal PayPal Orders v2 helper (REST). Used as an alternative to Stripe for
 * collecting payment after a proposal is approved. Gated on env credentials.
 */

export function isPaypalConfigured(): boolean {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET);
}

function apiBase(): string {
  return process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function accessToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!id || !secret) throw new Error("PayPal is not configured");
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error("PayPal auth failed");
  const json = await res.json();
  return json.access_token as string;
}

export async function createPaypalOrder(args: {
  amount: number;
  currency: string;
  description: string;
}) {
  const token = await accessToken();
  const res = await fetch(`${apiBase()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          description: args.description,
          amount: {
            currency_code: args.currency.toUpperCase(),
            value: args.amount.toFixed(2),
          },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error("PayPal order creation failed");
  return res.json();
}

export async function capturePaypalOrder(orderId: string) {
  const token = await accessToken();
  const res = await fetch(
    `${apiBase()}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );
  if (!res.ok) throw new Error("PayPal capture failed");
  return res.json();
}
