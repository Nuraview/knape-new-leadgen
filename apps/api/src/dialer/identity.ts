// Twilio Voice client identities are per-CRM-user: `agent_<userId>` with the
// uuid dashes swapped for underscores (Twilio client identities must match
// [a-zA-Z0-9_]). The legacy standalone app used a single shared identity
// ("dialer-agent"); per-user identity lets presence + call attribution map to
// actual CRM users.

const PREFIX = "agent_";

export function identityForUser(userId: string): string {
  return PREFIX + userId.replace(/-/g, "_");
}

export function userIdFromIdentity(identity: string): string | null {
  if (!identity.startsWith(PREFIX)) return null;
  const raw = identity.slice(PREFIX.length).replace(/_/g, "-");
  // uuid sanity check so legacy identities ("dialer-agent") map to null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    raw,
  )
    ? raw
    : null;
}

/** Strips Twilio's `client:` prefix from a From/To value, if present. */
export function stripClientPrefix(value: string | null | undefined): string {
  return (value ?? "").replace(/^client:/, "");
}
