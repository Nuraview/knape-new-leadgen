/**
 * Public landing-page enquiries, forwarded to the cockpit's inbound capture.
 *
 * The WorkBoat 2026 page (/workboat-2026 in the SPA) is public, so its form
 * cannot go through the /leadgen proxy, which needs a CRM session. It posts
 * here instead, mounted with the other pre-session routes, and this hands the
 * enquiry to the cockpit's own unauthenticated endpoint,
 * POST /api/public/sample-request: the same honeypot, per-IP rate limit,
 * `sample_leads` row (the CRM's Inbound page) and lead alert as every other
 * landing-page form. Nothing new is stored on this side.
 *
 * Only the fields below are forwarded, mapped onto that endpoint's wire names
 * (company -> school, interest -> school_type, message -> notes). The visitor's
 * IP goes in X-Real-IP so the cockpit's 5-per-hour limit applies per visitor
 * rather than to every Vercel egress address at once.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { leadgenBase } from "./index";

/** Pages allowed to post, so the source column stays meaningful. */
const SOURCES: Record<string, true> = { "workboat-2026-landing": true };

const clip = (v: unknown, n: number) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";

const leadgenPublic = new Hono().post("/inquiry", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid request" });
  }

  const source = clip(body.source, 100);
  if (!SOURCES[source]) {
    throw new HTTPException(400, { message: "Unknown form" });
  }

  const payload = {
    name: clip(body.name, 200),
    email: clip(body.email, 254),
    phone: clip(body.phone, 40),
    school: clip(body.company, 300),
    role: clip(body.role, 100),
    school_type: clip(body.interest, 60),
    notes: clip(body.message, 2000),
    // Honeypot: passed through untouched so the cockpit drops the bot quietly.
    website: clip(body.website, 200),
    source,
  };

  const ip =
    (c.req.header("x-real-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0] ||
      "").trim();

  const res = await fetch(`${leadgenBase()}/api/public/sample-request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(ip ? { "X-Real-IP": ip } : {}),
      "User-Agent": c.req.header("user-agent") ?? "",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 422 || res.status === 429) {
    const err: unknown = await res.json().catch(() => null);
    const detail =
      err && typeof err === "object" && "detail" in err ? err.detail : null;
    return c.json(
      {
        ok: false,
        error:
          typeof detail === "string"
            ? detail
            : res.status === 429
              ? "Too many requests. Try again later."
              : "A name and a valid email are required.",
      },
      res.status,
    );
  }
  if (!res.ok) {
    throw new HTTPException(502, {
      message: "We could not send your message. Please email us instead.",
    });
  }
  return c.json({ ok: true });
});

export default leadgenPublic;
