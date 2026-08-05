/**
 * Assign a person to a project board.
 *
 *   bun run scripts/assign-project.ts --email javed@nuraview.com --project "Nuraview-Javed"
 *   bun run scripts/assign-project.ts --list
 *   bun run scripts/assign-project.ts --email javed@nuraview.com --clear
 *
 * Client meeting 2026-07-28: each employee opens the app and sees only their
 * own board. Assignment is what makes that true — see
 * src/project/controllers/get-projects.ts for the rule, including why someone
 * with NO assignments still sees everything.
 */
import { and, eq } from "drizzle-orm";
import db from "../src/database";
import {
  projectMemberTable,
  projectTable,
  userTable,
} from "../src/database/schema";

function arg(name: string) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]?.startsWith("--") === false) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function main() {
  if (process.argv.includes("--list")) {
    const rows = await db
      .select({
        email: userTable.email,
        name: userTable.name,
        project: projectTable.name,
      })
      .from(projectMemberTable)
      .innerJoin(userTable, eq(userTable.id, projectMemberTable.userId))
      .innerJoin(projectTable, eq(projectTable.id, projectMemberTable.projectId))
      .orderBy(userTable.email);

    if (rows.length === 0) {
      console.log("No assignments — every member currently sees every board.");
    } else {
      for (const r of rows) {
        console.log(`  ${r.name ?? r.email} (${r.email})  →  ${r.project}`);
      }
    }
    process.exit(0);
  }

  const email = arg("email")?.toLowerCase();
  if (!email) {
    console.error(
      "Usage: assign-project.ts --email <email> --project <name> | --clear | --list",
    );
    process.exit(1);
  }

  const [user] = await db
    .select()
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);

  if (!user) {
    console.error(`No user with email ${email}.`);
    process.exit(1);
  }

  if (process.argv.includes("--clear")) {
    await db
      .delete(projectMemberTable)
      .where(eq(projectMemberTable.userId, user.id));
    console.log(`Cleared assignments for ${email} — they now see every board.`);
    process.exit(0);
  }

  const projectName = arg("project");
  if (!projectName) {
    console.error("--project <name> is required.");
    process.exit(1);
  }

  const [project] = await db
    .select()
    .from(projectTable)
    .where(eq(projectTable.name, projectName))
    .limit(1);

  if (!project) {
    const all = await db.select({ name: projectTable.name }).from(projectTable);
    console.error(
      `No project named "${projectName}". Available:\n${all
        .map((p) => `  - ${p.name}`)
        .join("\n")}`,
    );
    process.exit(1);
  }

  const [existing] = await db
    .select()
    .from(projectMemberTable)
    .where(
      and(
        eq(projectMemberTable.userId, user.id),
        eq(projectMemberTable.projectId, project.id),
      ),
    )
    .limit(1);

  if (existing) {
    console.log(`${email} is already assigned to "${project.name}".`);
    process.exit(0);
  }

  await db
    .insert(projectMemberTable)
    .values({ userId: user.id, projectId: project.id, createdAt: new Date() });

  console.log(`Assigned ${email} → "${project.name}".`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
