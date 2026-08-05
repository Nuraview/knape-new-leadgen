import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { users } from "../drizzle/schema";

async function main() {
  const result = await db.execute(sql`SELECT NOW() AS now`);
  console.log("[smoke] connected. server time:", result.rows[0]);

  const rows = await db.select({ id: users.id }).from(users).limit(1);
  console.log("[smoke] users.limit(1):", rows);

  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] failed:", err);
  process.exit(1);
});
