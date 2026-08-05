import { db } from "./lib/db";
import { users } from "./drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const admins = await db.select().from(users).where(eq(users.role, "admin"));
  console.log(admins.map((a) => ({ email: a.email, name: a.name })));
  process.exit(0);
}

main();
