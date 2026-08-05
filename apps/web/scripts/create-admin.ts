// Create (or update) an admin user. Because the CRM is internal/office use,
// there's no public registration — admins onboard people with this script.
//
// Usage (creates + prints creds):
//   EMAIL=boss@domain.com PASSWORD=hunter2 NAME="Boss" pnpm exec tsx scripts/create-admin.ts
//
// If the user already exists, the password is reset to the provided value and
// role is promoted to "admin".

import { randomUUID } from "crypto";

import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";

import { db } from "../lib/db";
import { users } from "../drizzle/schema";

async function main() {
  const email = process.env.EMAIL?.trim().toLowerCase();
  const password = process.env.PASSWORD;
  const name = process.env.NAME ?? null;

  if (!email || !password) {
    console.error("Missing EMAIL or PASSWORD env.");
    console.error(
      '  Usage: EMAIL=user@domain.com PASSWORD=... NAME="..." pnpm exec tsx scripts/create-admin.ts',
    );
    process.exit(1);
  }

  const passwordHash = await hash(password, 10);

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(users)
      .set({
        password: passwordHash,
        role: "admin",
        userStatus: "ACTIVE",
        name: name ?? existing[0].name,
      })
      .where(eq(users.email, email));
    console.log(`[admin] Updated existing user ${email} (role=admin, ACTIVE).`);
  } else {
    await db.insert(users).values({
      id: randomUUID(),
      email,
      name,
      password: passwordHash,
      role: "admin",
      userStatus: "ACTIVE",
      userLanguage: "en",
      v: 0,
      isAccountAdmin: true,
      isAdmin: true,
      emailVerified: true,
      banned: false,
      createdOn: new Date().toISOString(),
    });
    console.log(`[admin] Created ${email} (role=admin, ACTIVE).`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
