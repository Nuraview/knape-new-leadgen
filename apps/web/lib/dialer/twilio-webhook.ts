// Shared helpers for Twilio-called webhook routes (/api/twilio/*).
//
// - Twilio POSTs application/x-www-form-urlencoded → req.formData(), never json.
// - Signature validation uses a PINNED public base URL (DIALER_PUBLIC_BASE_URL)
//   instead of reconstructing from x-forwarded-* headers, which are ambiguous
//   behind Vercel's proxy. The same pinned URL builds TwiML action URLs, so
//   what Twilio signs is exactly what we validate.
// - The standalone app had NO signature validation; it's mandatory here.

import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";

export async function readTwilioParams(
  req: NextRequest,
): Promise<Record<string, string>> {
  if (req.method === "GET") {
    return Object.fromEntries(req.nextUrl.searchParams);
  }
  const form = await req.formData();
  const params: Record<string, string> = {};
  form.forEach((v, k) => {
    params[k] = String(v);
  });
  return params;
}

export function publicBaseUrl(): string {
  const base =
    process.env.DIALER_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new Error("DIALER_PUBLIC_BASE_URL not configured");
  return base.replace(/\/$/, "");
}

export function validateTwilioSignature(
  req: NextRequest,
  params: Record<string, string>,
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;
  const url = publicBaseUrl() + req.nextUrl.pathname + req.nextUrl.search;
  return twilio.validateRequest(
    authToken,
    req.headers.get("x-twilio-signature") ?? "",
    url,
    // For GET, params live in the query string of `url` already.
    req.method === "GET" ? {} : params,
  );
}

export function twimlResponse(xml: string): NextResponse {
  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export const forbidden = () =>
  NextResponse.json({ error: "Invalid Twilio signature" }, { status: 403 });
