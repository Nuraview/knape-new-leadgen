import { eq } from "drizzle-orm";
import crmDb from "../../database/crm";
import { mktUsers as users } from "../../database/crm-schema";

/**
 * Resolve (or lazily create) the mkt_users row for a CRM user, so sent emails
 * and sequences are attributed to a real sender rather than a hardcoded id.
 *
 * The legacy version called Next's getSession() internally. Here the identity
 * is passed in: Hono already has the authenticated user on the context, and a
 * function that reaches for ambient session state cannot be called from the
 * scheduler, which is where follow-ups are dispatched from.
 */
export async function resolveSenderId(
  email = "crm@nuraview.com",
  name: string | null = null,
): Promise<number> {
  const [existing] = await crmDb
    .select()
    .from(users)
    .where(eq(users.email, email));
  if (existing) return existing.id;

  const parts = name ? name.trim().split(/\s+/) : [];
  const firstName = parts[0] ?? null;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;

  const [created] = await crmDb
    .insert(users)
    .values({ email, firstName, lastName })
    .returning();
  if (!created) {
    throw new Error(`Could not create a sender row for ${email}`);
  }
  return created.id;
}
