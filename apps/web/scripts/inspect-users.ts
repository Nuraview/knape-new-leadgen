import { db } from "../lib/db";
import { users } from "../drizzle/schema";

async function main() {
  const allUsers = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
  }).from(users);
  console.log("Users in database:", JSON.stringify(allUsers, null, 2));
}

main().catch(console.error);
