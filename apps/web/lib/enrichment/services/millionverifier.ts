// MillionVerifier — email deliverability verification. Cheapest in market
// at $0.0037/verify; credits never expire; doesn't charge for catch-all
// or unknown results. Used as the final gate before persisting an email
// as a lead's primary contact.
//
// Endpoint (millionverifier.com docs, 2026):
//   GET https://api.millionverifier.com/api/v3/?api=<KEY>&email=<EMAIL>&timeout=10
//
// Returns:
//   result: "ok" | "catch_all" | "unknown" | "invalid" | "disposable" | ...
//   quality: "good" | "risky" | "bad"
//
// Persistence rule: only treat result === "ok" or quality === "good" as
// safe-to-send. Everything else stays in the audit log but doesn't fill
// the lead's email column.

const ENDPOINT = "https://api.millionverifier.com/api/v3/";
const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

export interface MillionVerifierResult {
  email: string;
  result: string;
  quality?: string;
  resultcode?: number;
  free?: boolean;
  role?: boolean;
  didyoumean?: string;
  disposable?: boolean;
}

// Placeholder/example domains and local-parts we should never pay to
// verify. Caught a real incident on 2026-05-21 where the waterfall paid
// $0.156 verifying `email1@example.com` (a literal sample) — the email
// was fabricated upstream because firstName+company was searched against
// LinkedIn and the resulting profile carried a sample address.
const PLACEHOLDER_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "example.io",
  "domain.com",
  "company.com",
  "email.com",
  "test.com",
  "mail.com",
  "yourdomain.com",
  "yourcompany.com",
]);

const PLACEHOLDER_LOCAL_PATTERNS = [
  /^email\d*$/i, // email, email1, email2 ...
  /^name\d*$/i, // name, name1, name2 ...
  /^test\d*$/i,
  /^example\d*$/i,
  /^sample\d*$/i,
  /^firstname$/i,
  /^lastname$/i,
  /^fullname$/i,
  /^noreply$/i, // we never want to verify a noreply target
  /^no-reply$/i,
];

export function isLikelyPlaceholderEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes("@")) return false;
  const at = trimmed.lastIndexOf("@");
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (PLACEHOLDER_DOMAINS.has(domain)) return true;
  if (domain.endsWith(".example") || domain.endsWith(".test")) return true;
  return PLACEHOLDER_LOCAL_PATTERNS.some((re) => re.test(local));
}

export async function verifyEmailViaMillionVerifier(
  email: string,
): Promise<MillionVerifierResult | null> {
  const apiKey = process.env.MILLIONVERIFIER_API_KEY;
  if (!apiKey) {
    console.warn(
      "[millionverifier] MILLIONVERIFIER_API_KEY missing — verify step disabled",
    );
    return null;
  }
  if (!email) return null;
  if (isLikelyPlaceholderEmail(email)) {
    console.warn(
      `[millionverifier] refusing to verify placeholder email '${email}'`,
    );
    return { email, result: "invalid", quality: "bad" };
  }

  const url = `${ENDPOINT}?api=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}&timeout=10`;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, { signal: ctrl.signal }).finally(() =>
        clearTimeout(timer),
      );

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
          `[millionverifier] HTTP ${res.status}: ${text.slice(0, 200)}`,
        );
        return null;
      }
      return (await res.json()) as MillionVerifierResult;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        continue;
      }
    }
  }
  console.warn(`[millionverifier] all retries failed for ${email}:`, lastErr);
  return null;
}

// Stricter than `quality === "good"`: only return true when MillionVerifier
// is fully confident the address accepts mail. We persist a found email as
// the lead's PRIMARY only when this is true; risky/catch-all results are
// kept in the audit log but not propagated to the lead row.
export function isVerifiedDeliverable(
  result: MillionVerifierResult | null,
): boolean {
  if (!result) return false;
  if (result.result === "ok") return true;
  if (result.quality === "good") return true;
  return false;
}
