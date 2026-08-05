/**
 * Brand substitution for transactional email copy.
 *
 * Every template carries a per-locale copy table with the product name baked
 * into the sentences ("Sign in to NuraView", "Bei NuraView anmelden"). One
 * codebase now serves more than one brand, and these strings go to other
 * people's inboxes, so the name has to be a variable — but pulling it out into
 * a prop threaded through every template and locale would be a large, noisy
 * change to a lot of otherwise-fine copy.
 *
 * Instead the tables keep a `{{brand}}` placeholder, exactly matching the
 * `{{inviterName}}` convention workspace-invitation.tsx already uses, and it is
 * substituted at render time.
 *
 * Read at call time rather than module load: templates render inside a
 * long-lived server and, on Vercel, a reused function instance, so caching the
 * value at import would freeze whatever was set when the module first loaded.
 */
export function getBrandName(): string {
  const value = process.env.BRAND_NAME;
  return value && value.trim() ? value.trim() : "NuraView";
}

/**
 * Replaces `{{brand}}` throughout a locale copy table.
 *
 * Typed to return the same shape it was given so callers keep autocomplete on
 * `copy.preview`, `copy.cta` and friends.
 */
export function withBrand<T extends Record<string, string>>(copy: T): T {
  const name = getBrandName();
  const out = {} as Record<string, string>;

  for (const [key, value] of Object.entries(copy)) {
    out[key] = value.replaceAll("{{brand}}", name);
  }

  return out as T;
}
