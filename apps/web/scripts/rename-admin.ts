// One-off: rename an existing admin user's email and reset their password.
// Preserves the user's UUID so all FK relationships (records, sessions tied
// to userId) stay intact.
//
// Usage:
//   FROM_EMAIL=admin@domain.com TO_EMAIL=varshith@nuraview.com NAME="Varshith" \
//     pnpm exec tsx scripts/rename-admin.ts

import { randomBytes } from "crypto";

import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "../lib/db";
import { users } from "../drizzle/schema";

function generatePassword(): string {
  // 18 url-safe chars, no ambiguous 0/O/1/l/I
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#%&*";
  const bytes = randomBytes(18);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function main() {
  const from = process.env.FROM_EMAIL?.trim().toLowerCase();
  const to = process.env.TO_EMAIL?.trim().toLowerCase();
  const name = process.env.NAME ?? null;

  if (!from || !to) {
    console.error("Missing FROM_EMAIL or TO_EMAIL env.");
    process.exit(1);
  }

  const existing = await db.select().from(users).where(eq(users.email, from)).limit(1);
  if (existing.length === 0) {
    console.error(`[rename] No user found with email ${from}`);
    process.exit(1);
  }

  const collision = await db.select().from(users).where(eq(users.email, to)).limit(1);
  if (collision.length > 0 && collision[0].id !== existing[0].id) {
    console.error(`[rename] Target email ${to} is already taken by another user.`);
    process.exit(1);
  }

  const password = generatePassword();
  const passwordHash = await hash(password, 10);

  await db
    .update(users)
    .set({
      email: to,
      name: name ?? existing[0].name,
      password: passwordHash,
      role: "admin",
      userStatus: "ACTIVE",
      isAdmin: true,
      isAccountAdmin: true,
      emailVerified: true,
      banned: false,
    })
    .where(eq(users.id, existing[0].id));

  console.log(`[rename] ${from} -> ${to}`);
  console.log(`[rename] Name: ${name ?? existing[0].name}`);
  console.log(`[rename] Password: ${password}`);
  console.log(`[rename] User ID preserved: ${existing[0].id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
