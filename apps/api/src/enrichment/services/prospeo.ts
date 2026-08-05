// Prospeo — primary email finder + (gated) mobile phone finder.
//
// Why primary: single-lookup pricing only charges when the email is VALID
// (catch-all and not-found are free). At ~$0.039/valid-email this is the
// best ROI when hit rate is unknown.
//
// Endpoints (verified against prospeo.io docs, 2026):
//   POST https://api.prospeo.io/email-finder
//     body: { first_name, last_name, company } OR { domain }
//     header: X-KEY: <PROSPEO_API_KEY>
//   POST https://api.prospeo.io/mobile-finder
//     body: { url }   ← linkedin profile URL
//
// Returns null on missing key / no result / non-2xx after retries.

const EMAIL_ENDPOINT = "https://api.prospeo.io/email-finder";
const MOBILE_ENDPOINT = "https://api.prospeo.io/mobile-finder";
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

export interface ProspeoEmailResult {
  email: string;
  // "verified" | "valid" | "deliverable" | "catch-all" | etc — we just
  // pass through whatever Prospeo returns.
  verification?: string;
  first_name?: string;
  last_name?: string;
  // Indicates a credit was charged (true) vs. the lookup was free (false).
  // We tally `costUsd` only when this is true.
  charged?: boolean;
}

export interface ProspeoMobileResult {
  number: string;
  // Country code if Prospeo could infer one (e.g. "+1").
  country_code?: string;
  charged?: boolean;
}

async function postProspeo<TResp>(
  url: string,
  body: object,
  apiKey: string,
): Promise<TResp | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "X-KEY": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));

      if (res.status === 429 || res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }
      }
      if (res.status === 404) {
        // Prospeo uses 404 for "no result found" — return null cleanly.
        return null;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`[prospeo] HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
        return null;
      }
      const json = await res.json();
      // Prospeo wraps results: { response: { ... }, error?: bool, message?: str }
      if (json?.error) {
        console.warn(`[prospeo] error response:`, json.message ?? json);
        return null;
      }
      return (json?.response ?? json) as TResp;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
    }
  }
  console.warn(`[prospeo] all retries failed for ${url}:`, lastErr);
  return null;
}

// Find a work email for a person at a company/domain.
// Pass `domain` when known (skips Prospeo's domain-resolution step and
// produces better hit rates). Falls back to `company` name otherwise.
export async function findEmailViaProspeo(args: {
  firstName: string;
  lastName: string;
  domain?: string | null;
  company?: string | null;
}): Promise<ProspeoEmailResult | null> {
  const apiKey = process.env.PROSPEO_API_KEY;
  if (!apiKey) {
    console.warn("[prospeo] PROSPEO_API_KEY missing — email step disabled");
    return null;
  }
  if (!args.firstName || !args.lastName) return null;

  const body: Record<string, string> = {
    first_name: args.firstName,
    last_name: args.lastName,
  };
  if (args.domain) {
    body.domain = args.domain;
  } else if (args.company) {
    body.company = args.company;
  } else {
    return null;
  }
  return postProspeo<ProspeoEmailResult>(EMAIL_ENDPOINT, body, apiKey);
}

// Find a mobile number from a LinkedIn profile URL. Costs ~$0.39/valid
// number — the waterfall ONLY calls this on Deep-enrich (manual click).
export async function findMobileViaProspeo(args: {
  linkedinUrl: string;
}): Promise<ProspeoMobileResult | null> {
  const apiKey = process.env.PROSPEO_API_KEY;
  if (!apiKey) {
    console.warn("[prospeo] PROSPEO_API_KEY missing — mobile step disabled");
    return null;
  }
  if (!args.linkedinUrl) return null;
  return postProspeo<ProspeoMobileResult>(
    MOBILE_ENDPOINT,
    { url: args.linkedinUrl },
    apiKey,
  );
}
