import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import crmDb from "../database/crm";
import { nvCustomers, nvPortalGrants } from "../database/crm-schema";

/** How long an invitation stays usable. */
const GRANT_TTL_DAYS = 30;

/**
 * Mint a portal invitation for a customer.
 *
 * VK, 2026-08-03: "a unique link would be generated, all automated by the way,
 * and sent as an email where a person can log in or sign up with his own email.
 * We don't have to provide him any access."
 *
 * The token is 32 random bytes, not a signed payload. A signed token would let
 * anyone holding the secret mint access for any customer forever; a stored
 * token can be expired, revoked and audited — and this table has to exist
 * anyway to answer "did they ever open it?".
 *
 * Returns the link rather than emailing it. Sending is the caller's decision:
 * an order going paid sends it, an operator re-sending does not want a second
 * grant minted.
 */
export async function createPortalGrant(
  customerId: string,
): Promise<{ token: string; url: string }> {
  const [existing] = await crmDb
    .select()
    .from(nvPortalGrants)
    .where(eq(nvPortalGrants.customerId, customerId))
    .limit(1);

  /*
   * Reuse an unclaimed, unexpired invitation rather than minting another.
   * Two live links for one customer means the one already sitting in their
   * inbox is the older — and the newer one is the only one anybody tested.
   */
  if (
    existing &&
    !existing.claimedAt &&
    existing.expiresAt &&
    existing.expiresAt > new Date()
  ) {
    return { token: existing.token, url: portalUrl(existing.token) };
  }

  const [customer] = await crmDb
    .select({ email: nvCustomers.email })
    .from(nvCustomers)
    .where(eq(nvCustomers.id, customerId))
    .limit(1);

  const token = randomBytes(32).toString("base64url");

  await crmDb.insert(nvPortalGrants).values({
    token,
    customerId,
    // Recorded on the grant so the claim flow can require that the person
    // signing up is the person invited, without a second lookup.
    email: customer?.email ?? "",
    expiresAt: new Date(Date.now() + GRANT_TTL_DAYS * 86_400_000),
  });

  return { token, url: portalUrl(token) };
}

export function portalUrl(token: string): string {
  const base = (
    process.env.APP_URL ??
    process.env.NURAVIEW_CLIENT_URL ??
    ""
  ).replace(/\/+$/, "");
  return `${base}/portal/claim/${token}`;
}

/** Null when unknown, expired or revoked. */
export async function resolveGrant(token: string) {
  const [grant] = await crmDb
    .select()
    .from(nvPortalGrants)
    .where(eq(nvPortalGrants.token, token))
    .limit(1);

  if (!grant) return null;
  if (grant.expiresAt && grant.expiresAt < new Date()) return null;
  return grant;
}
