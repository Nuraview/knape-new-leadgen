// Findymail — fallback email finder. Different data sources than Prospeo,
// catches what Prospeo misses. Used in the waterfall ONLY when Prospeo
// returns null — at $0.049/email, primary-on-fallback minimizes spend.
//
// Endpoint (findymail.com docs, 2026):
//   POST https://app.findymail.com/api/search/name
//     body: { name, domain }   (Findymail wants full name, not split)
//     header: Authorization: Bearer <FINDYMAIL_API_KEY>
//
// Findymail only charges on hit, and credits roll over up to 2× the
// monthly allotment.

const ENDPOINT = "https://app.findymail.com/api/search/name";
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;

export interface FindymailResult {
  email: string;
  // "valid" | "risky" — Findymail tags deliverability inline.
  verification?: string;
  // Findymail returns the full name back; useful when we passed only a
  // partial name and they corrected it.
  name?: string;
  domain?: string;
}

export async function findEmailViaFindymail(args: {
  firstName: string;
  lastName: string;
  domain: string;
}): Promise<FindymailResult | null> {
  const apiKey = process.env.FINDYMAIL_API_KEY;
  if (!apiKey) {
    console.warn(
      "[findymail] FINDYMAIL_API_KEY missing — fallback step disabled",
    );
    return null;
  }
  if (!args.firstName || !args.lastName || !args.domain) return null;

  const body = {
    name: `${args.firstName} ${args.lastName}`.trim(),
    domain: args.domain,
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
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
      if (res.status === 404 || res.status === 422) {
        // No match found.
        return null;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`[findymail] HTTP ${res.status}: ${text.slice(0, 200)}`);
        return null;
      }
      const json = await res.json();
      // Findymail wraps in { contact: { ... } } on hit.
      const contact = json?.contact ?? json;
      if (!contact?.email) return null;
      return {
        email: contact.email,
        verification: contact.verification ?? contact.status,
        name: contact.name,
        domain: contact.domain,
      };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
    }
  }
  console.warn("[findymail] all retries failed:", lastErr);
  return null;
}
