import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-side proxy to the NuraView email-generator service. Keeps the
// backend URL + API key off the client, and makes the call same-origin so
// it works under https (no mixed-content block) and needs no CORS.
// Two setups:
//  - "current" → the original generator that returns a single { subject, body }.
//  - "updated" → the new agent (port 8002) that returns a 5-email thread:
//    email1 (warm-up, sent immediately) + email2..email5 (threaded follow-ups),
//    each { subject, body }, plus a `usage` token block. The follow-ups go out
//    at +10 min / +3h / +9h / +24h in the SAME thread.
const CURRENT_GENERATOR_URL =
  process.env.EMAIL_GENERATOR_CURRENT_URL ??
  "http://185.245.182.175:8000/generate-email";
const UPDATED_GENERATOR_URL =
  process.env.EMAIL_GENERATOR_UPDATED_URL ??
  process.env.EMAIL_GENERATOR_URL ??
  "http://185.245.182.175:8002/generate-email";
const GENERATOR_API_KEY = process.env.EMAIL_GENERATOR_API_KEY ?? "";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  let body: { description?: string; mode?: "current" | "updated" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.description || typeof body.description !== "string") {
    return NextResponse.json(
      { error: "Missing 'description' in request body" },
      { status: 400 }
    );
  }

  const mode = body.mode === "updated" ? "updated" : "current";
  const generatorUrl =
    mode === "updated" ? UPDATED_GENERATOR_URL : CURRENT_GENERATOR_URL;

  try {
    const upstream = await fetch(generatorUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(GENERATOR_API_KEY ? { "x-api-key": GENERATOR_API_KEY } : {}),
      },
      body: JSON.stringify({ description: body.description }),
      // Don't hang the request forever if the upstream is wedged.
      signal: AbortSignal.timeout(60_000),
    });

    const text = await upstream.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }

    if (!upstream.ok) {
      // Surface the upstream's own error (e.g. OpenAI quota 429 -> 502)
      // so the UI can show something actionable instead of "no response".
      const detail =
        (data as { detail?: string })?.detail ??
        `Email service responded ${upstream.status}`;
      return NextResponse.json(
        { error: "Email service error", detail },
        { status: 502 }
      );
    }

    type EmailPart = { subject?: string; body?: string };
    const result = data as {
      subject?: string;
      email_subject?: string;
      body?: string;
      email_body?: string;
      // Updated setup (port 8002) shape: a 5-email thread.
      email1?: EmailPart;
      email2?: EmailPart;
      email3?: EmailPart;
      email4?: EmailPart;
      email5?: EmailPart;
      usage?: Record<string, number>;
    };

    // Both setups now return email1 (the initial email) plus AI-written
    // follow-ups: the current generator (8000) returns email2..email4, the
    // updated agent (8002) returns email2..email5. Surface email1 as
    // subject/body and the rest as an ordered `followups` array. The send route
    // schedules them per setup (current: +6h/+24h/+36h; updated: +10min/+3h/
    // +9h/+24h).
    if (result.email1) {
      const followups = [
        result.email2,
        result.email3,
        result.email4,
        result.email5,
      ]
        .filter((f): f is EmailPart => Boolean(f))
        .map((f) => ({ subject: f.subject ?? "", body: f.body ?? "" }));
      return NextResponse.json({
        subject: result.email1.subject ?? "No subject received",
        body: result.email1.body ?? "No body received",
        followups,
        usage: result.usage ?? null,
      });
    }

    // Legacy fallback: a generator that still returns a single { subject, body }.
    return NextResponse.json({
      subject: result.subject ?? result.email_subject ?? "No subject received",
      body: result.body ?? result.email_body ?? "No body received",
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "TimeoutError"
          ? "Email service timed out"
          : err.message
        : "Failed to reach email service";
    return NextResponse.json(
      { error: "Failed to generate email", detail: message },
      { status: 502 }
    );
  }
}
