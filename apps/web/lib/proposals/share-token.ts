import { customAlphabet } from "nanoid";

// URL-safe alphabet (no ambiguous chars). 32 chars ≈ 190 bits of entropy —
// the token is a bearer credential for the public proposal page.
const nano = customAlphabet(
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  32,
);

export function generateShareToken(): string {
  return nano();
}

function appBaseUrl(): string {
  // Proposal links can live on their own branded domain (proposals.nuraview.com)
  // WITHOUT moving the rest of the CRM. Falls back to the app URL if unset.
  const url =
    process.env.NEXT_PUBLIC_PROPOSAL_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_DOMAIN ||
    "";
  return url.replace(/\/$/, "");
}

/**
 * Public client-facing URL: /proposal/{number}/{slug}?t={token}
 * The token validates access; number+slug make the URL human-readable
 * (e.g. neuraview.com/proposal/123/chilo-plungers).
 */
export function buildPublicProposalUrl(
  number: number | null,
  slug: string | null,
  token: string,
): string {
  const n = number ?? 0;
  const s = slug || "proposal";
  return `${appBaseUrl()}/proposal/${n}/${s}?t=${token}`;
}
