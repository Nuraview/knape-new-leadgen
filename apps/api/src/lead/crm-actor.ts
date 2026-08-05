import { randomUUID } from "node:crypto";
/**
 * Resolve the authenticated user to a CRM user UUID.
 *
 * The two systems identify users differently: better-auth issues cuid2 text
 * ids, while the CRM's actor columns (`highlighted_by`, `last_contacted_by`,
 * `irrelevant_by`, `updatedBy`) are uuid — and `irrelevant_by` carries a
 * foreign key to `Users(id)`. Writing a cuid2 there fails outright.
 *
 * Email is the only stable identifier both sides share, so it is the join key.
 * When there is no match the caller writes NULL rather than guessing: the
 * columns are nullable, and a wrong attribution on a lead is worse than a
 * missing one.
 *
 * Cached per process — the CRM currently has a single user and this sits on
 * every write path.
 */
import { eq, sql } from "drizzle-orm";
import crmDb from "../database/crm";

const cache = new Map<string, string | null>();

export async function resolveCrmActorId(
  email: string | undefined | null,
): Promise<string | null> {
  if (!email) return null;

  const cached = cache.get(email);
  if (cached !== undefined) return cached;

  // `Users` is not in crm-schema.ts (nothing else needs it yet), so this is a
  // narrow raw query rather than a table definition carried for one lookup.
  const result = await crmDb.execute<{ id: string }>(
    sql`select id from "Users" where lower(email) = lower(${email}) limit 1`,
  );

  const row = (result as unknown as { rows?: { id: string }[] }).rows?.[0];
  const id = row?.id ?? null;

  if (!id) {
    console.warn(
      `[lead] No CRM user matches ${email}; actor columns will be written as NULL.`,
    );
  }

  cache.set(email, id);
  return id;
}

/**
 * Like resolveCrmActorId, but guarantees a real row.
 *
 * Some CRM columns are NOT NULL **and** foreign-keyed — `crm_Proposals.createdBy`
 * is both. A missing actor there is not "write NULL", it is a 500: proposal
 * creation failed for every user with a hardcoded zero-uuid standing in for the
 * real id, because that uuid references nothing and the FK rejected it.
 *
 * So when the signed-in user has no CRM row, create one. They are already
 * authenticated against the app; the CRM `Users` table is simply a second
 * directory that predates it. Provisioning on demand keeps attribution HONEST —
 * the proposal really was created by that person — where the alternatives are a
 * hard failure or crediting the work to whoever happens to be first in the table.
 */
export async function requireCrmActorId(
  email: string | undefined | null,
  name?: string | null,
): Promise<string> {
  const existing = await resolveCrmActorId(email);
  if (existing) return existing;

  if (!email) {
    throw new Error("Cannot attribute this record: no signed-in email");
  }

  const id = randomUUID();
  await crmDb.execute(
    sql`INSERT INTO "Users" (id, email, name, "userStatus", role, "emailVerified")
        VALUES (${id}, ${email}, ${name ?? email}, 'ACTIVE', 'member', true)
        ON CONFLICT (email) DO NOTHING`,
  );

  // Re-read rather than trusting the insert: a concurrent request may have won
  // the race, in which case ON CONFLICT did nothing and their id is the real one.
  cache.delete(email);
  const resolved = await resolveCrmActorId(email);
  if (!resolved) {
    throw new Error(`Failed to provision a CRM user for ${email}`);
  }
  return resolved;
}

export { eq };
