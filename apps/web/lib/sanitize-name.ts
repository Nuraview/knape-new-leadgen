// Reject obvious placeholder/garbage tokens that drift in from LLM
// hallucinations (Gemini, GPT-5) and lazy enrichment-provider responses.
// Returns null when the input is empty OR matches the reject set;
// returns the trimmed value otherwise.
//
// Why this exists: we caught Gemini returning literal "Person" as a lastName
// for an Upwork client whose real surname was nowhere in the source data.
// Once "Person" landed in crm_Leads.lastName, the enrichLead waterfall
// treated the field as populated and refused to overwrite it, freezing the
// bad value forever. Same hazard with "Unknown", "Client", "User", etc.

const PLACEHOLDER_TOKENS = new Set<string>([
  // Generic
  "person",
  "user",
  "anonymous",
  "anon",
  "unknown",
  "none",
  "n/a",
  "na",
  "null",
  "undefined",
  "not found",
  "notfound",
  "not available",
  "tbd",
  "to be determined",
  // Role labels often emitted instead of names
  "client",
  "freelancer",
  "customer",
  "buyer",
  "seller",
  "vendor",
  "contractor",
  "employer",
  // Field labels (LLM leaks the label as the value)
  "name",
  "first name",
  "last name",
  "full name",
  "firstname",
  "lastname",
  "fullname",
  "company",
  "company name",
  "companyname",
  // Test / example
  "test",
  "example",
  "sample",
  "demo",
  "placeholder",
]);

export function isPlaceholderName(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const t = v.trim().toLowerCase();
  if (!t) return true;
  return PLACEHOLDER_TOKENS.has(t);
}

export function sanitizeName(
  v: string | null | undefined,
): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  if (PLACEHOLDER_TOKENS.has(t.toLowerCase())) return null;
  return t;
}

// Exposed for the cleanup script + tests — lets callers iterate the
// reject set without copy-pasting it.
export function placeholderTokens(): readonly string[] {
  return Array.from(PLACEHOLDER_TOKENS);
}
