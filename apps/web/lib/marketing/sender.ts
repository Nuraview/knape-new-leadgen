import { eq } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { mktUsers as users } from "@/lib/db";

/**
 * Resolve (or lazily create) the mkt_users row for the signed-in CRM user, so
 * sent emails / sequences are attributed to a real sender rather than a
 * hardcoded id. Returns a system row's id when there's no session.
 */
export async function resolveSenderId(): Promise<number> {
  const session = await getSession();
  const email = session?.user?.email ?? "crm@nuraview.com";
  const name = session?.user?.name ?? null;

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email));
  if (existing) return existing.id;

  const parts = name ? name.trim().split(/\s+/) : [];
  const firstName = parts[0] ?? null;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;

  const [created] = await db
    .insert(users)
    .values({ email, firstName, lastName })
    .returning();
  return created.id;
}
