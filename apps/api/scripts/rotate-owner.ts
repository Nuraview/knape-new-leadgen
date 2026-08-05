/**
 * Hand an account over to a new owner: change the email, issue a one-time
 * password, and force the holder to replace it on first sign-in.
 *
 *   bun run scripts/rotate-owner.ts --from admin@nuraview.com \
 *                                   --to varshith@nuraview.com \
 *                                   --name Varshith
 *
 * VK 2026-07-28 asked for the owner account to become his, and to set the real
 * password himself on his own machine. So this deliberately does NOT accept a
 * password: it generates a random one, prints it once for the operator to
 * relay, and sets must_change_password. The operator can hand over the
 * temporary credential without ever learning the permanent one.
 *
 * Sessions are revoked as part of the change. The old address may still be
 * signed in somewhere, and an ownership transfer that leaves the previous
 * holder's session alive has not transferred anything.
 */
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import db from "../src/database";
import { accountTable, sessionTable, userTable } from "../src/database/schema";

const BCRYPT_ROUNDS = 12;

function arg(name: string) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]?.startsWith("--") === false) {
    return process.argv[idx + 1];
  }
  return undefined;
}

/**
 * Temporary password. Deliberately unmemorable — it exists to be typed once
 * and thrown away, and anything that looks like a real password invites
 * someone to keep it.
 */
function temporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(24));
  return `Tmp-${Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("")}`;
}

async function main() {
  const from = arg("from")?.toLowerCase();
  const to = arg("to")?.toLowerCase();
  const name = arg("name");

  if (!from || !to) {
    console.error(
      "Usage: rotate-owner.ts --from <current email> --to <new email> [--name <display name>]",
    );
    process.exit(1);
  }

  const [user] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.email, from))
    .limit(1);

  if (!user) {
    console.error(`No user with email ${from}.`);
    process.exit(1);
  }

  const [clash] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, to))
    .limit(1);

  if (clash && clash.id !== user.id) {
    console.error(
      `${to} already belongs to a different user (${clash.id}). Refusing to merge two accounts.`,
    );
    process.exit(1);
  }

  const password = temporaryPassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const now = new Date();

  await db
    .update(userTable)
    .set({
      email: to,
      ...(name ? { name } : {}),
      emailVerified: true, // operator-provisioned; there is no verification flow
      mustChangePassword: true,
      updatedAt: now,
    })
    .where(eq(userTable.id, user.id));

  // better-auth keeps the credential on `account`, not on `user`. Scoped to
  // providerId "credential": an account row can also be a linked OAuth
  // identity, and writing a bcrypt hash into one of those would be nonsense.
  const updated = await db
    .update(accountTable)
    .set({ password: passwordHash, updatedAt: now })
    .where(
      and(
        eq(accountTable.userId, user.id),
        eq(accountTable.providerId, "credential"),
      ),
    )
    .returning({ id: accountTable.id });

  if (updated.length === 0) {
    console.error(
      "No credential account row — this user signs in via OAuth only, so there is no password to rotate.",
    );
    process.exit(1);
  }

  const revoked = await db
    .delete(sessionTable)
    .where(eq(sessionTable.userId, user.id))
    .returning({ id: sessionTable.id });

  console.log(`✓ ${from} → ${to}${name ? ` (${name})` : ""}`);
  console.log(`✓ Revoked ${revoked.length} session(s).`);
  console.log("");
  console.log("  Temporary password (give this to them, once):");
  console.log(`      ${password}`);
  console.log("");
  console.log(
    "  They will be required to choose their own password on first sign-in.",
  );
  console.log(
    "  Two-factor: Settings → Account → Two-factor authentication → Set up.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
