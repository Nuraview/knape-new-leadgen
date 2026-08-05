// Apify — additional fail-proof enrichment layers (client ask, May 2026):
//
//   • scrapeLinkedInProfileViaApify — from the Serper-found profile URL
//     (or name+company) scrape the LinkedIn profile for richer
//     first/last/headline, and an email if the actor surfaces one. Feeds
//     better inputs into the email finders.
//   • findEmailViaApify — last-resort email finder when Prospeo AND
//     Findymail both miss.
//
// Apify actors are pay-per-result and account-specific, so BOTH the token
// AND the actor id must be configured, or the layer is skipped — it never
// breaks the waterfall (same graceful-null contract as the other
// providers). Requiring an explicit actor id (no hardcoded default) is
// deliberate: we must never invoke/bill an actor the operator didn't
// choose.
//
// Configure (set the *_ACTOR env to the actor's "username~actor-name"
// slug, e.g. dev_fusion~linkedin-profile-scraper):
//   APIFY_API_TOKEN      — Apify account token
//   APIFY_LINKEDIN_ACTOR — a LinkedIn-profile scraper actor slug
//   APIFY_EMAIL_ACTOR    — an email/contact finder actor slug
//
// API: POST
//   https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items?token=…
//   body = actor input JSON; response = array of dataset items.
// Returns null on missing token/actor, no result, or non-2xx after retries.

const APIFY_BASE = "https://api.apify.com/v2/acts";
const TIMEOUT_MS = 120_000; // LinkedIn scrapers are slow; bound it
const MAX_RETRIES = 1; // actors are expensive — don't hammer
const RETRY_DELAY_MS = 2_000;

export interface ApifyLinkedInProfile {
  firstName: string | null;
  lastName: string | null;
  headline: string | null;
  email: string | null;
  linkedinUrl: string | null;
  raw: unknown;
}

export interface ApifyEmailResult {
  email: string;
  raw: unknown;
}

async function runApifyActor<TItem = unknown>(
  actor: string,
  input: object,
  token: string,
): Promise<TItem[] | null> {
  const url =
    `${APIFY_BASE}/${encodeURIComponent(actor)}` +
    `/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));

      if (res.status === 429 || res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, RETRY_DELAY_MS * (attempt + 1)),
          );
          continue;
        }
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(
          `[apify] HTTP ${res.status} for ${actor}: ${text.slice(0, 200)}`,
        );
        return null;
      }
      const json = await res.json().catch(() => null);
      if (!Array.isArray(json)) return null;
      return json as TItem[];
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
    }
  }
  console.warn(`[apify] all retries failed for ${actor}:`, lastErr);
  return null;
}

// Pull the first non-empty string value among candidate keys — actors
// disagree on field naming (email vs emailAddress, firstName vs
// first_name), so probe the common ones defensively.
import { sanitizeName } from "@/lib/sanitize-name";

function pick(
  obj: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// Same as pick() but routes the result through sanitizeName so
// placeholder-actor responses ("Person", "Unknown", etc.) don't leak
// into our DB as fake last names.
function pickName(
  obj: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  return sanitizeName(pick(obj, ...keys));
}

export async function scrapeLinkedInProfileViaApify(args: {
  linkedinUrl?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
}): Promise<ApifyLinkedInProfile | null> {
  const token = process.env.APIFY_API_TOKEN;
  const actor = process.env.APIFY_LINKEDIN_ACTOR;
  if (!token || !actor) {
    console.warn(
      "[apify] APIFY_API_TOKEN/APIFY_LINKEDIN_ACTOR missing — linkedin layer disabled",
    );
    return null;
  }
  if (!args.linkedinUrl && !(args.firstName && args.company)) return null;

  // Flexible input — LinkedIn profile actors variously accept
  // profileUrls / urls / startUrls or a search query. Send the common
  // keys; Apify ignores unknown input fields.
  const input: Record<string, unknown> = {};
  if (args.linkedinUrl) {
    input.profileUrls = [args.linkedinUrl];
    input.urls = [args.linkedinUrl];
    input.startUrls = [{ url: args.linkedinUrl }];
  } else {
    const q = [args.firstName, args.lastName, args.company]
      .filter(Boolean)
      .join(" ");
    input.queries = [q];
    input.searchQuery = q;
  }

  const items = await runApifyActor<Record<string, unknown>>(
    actor,
    input,
    token,
  );
  if (!items || items.length === 0) return null;
  const it = items[0];
  return {
    firstName: pickName(it, "firstName", "first_name", "givenName"),
    lastName: pickName(it, "lastName", "last_name", "familyName", "surname"),
    headline: pick(it, "headline", "title", "jobTitle", "occupation"),
    email: pick(it, "email", "emailAddress", "workEmail"),
    linkedinUrl:
      pick(it, "linkedinUrl", "profileUrl", "url", "publicProfileUrl") ??
      args.linkedinUrl ??
      null,
    raw: it,
  };
}

export async function findEmailViaApify(args: {
  firstName: string;
  lastName: string;
  domain?: string | null;
  company?: string | null;
}): Promise<ApifyEmailResult | null> {
  const token = process.env.APIFY_API_TOKEN;
  const actor = process.env.APIFY_EMAIL_ACTOR;
  if (!token || !actor) {
    console.warn(
      "[apify] APIFY_API_TOKEN/APIFY_EMAIL_ACTOR missing — email layer disabled",
    );
    return null;
  }
  if (!args.firstName || !args.lastName || !(args.domain || args.company)) {
    return null;
  }

  const input: Record<string, unknown> = {
    firstName: args.firstName,
    lastName: args.lastName,
    fullName: `${args.firstName} ${args.lastName}`,
  };
  if (args.domain) input.domain = args.domain;
  if (args.company) input.company = args.company;

  const items = await runApifyActor<Record<string, unknown>>(
    actor,
    input,
    token,
  );
  if (!items || items.length === 0) return null;
  const email = pick(
    items[0],
    "email",
    "emailAddress",
    "workEmail",
    "professionalEmail",
  );
  if (!email) return null;
  return { email, raw: items[0] };
}
