/**
 * Provision this instance's users and its single workspace.
 *
 * Upstream is multi-tenant SaaS: users self-register, then create a workspace.
 * This is an internal CRM with a fixed team, so neither belongs in the
 * product. Public sign-up stays off (DISABLE_REGISTRATION=true) and accounts
 * are created here, by an operator, against the server.
 *
 * This script writes the `user` and `account` rows DIRECTLY and never touches
 * the registration flag or the sign-up endpoint. An earlier version flipped
 * DISABLE_REGISTRATION for the duration of its own process to reuse
 * auth.api.signUpEmail; even scoped to one process that is a footgun on a
 * private CRM, and it is not needed — the credential row is just a bcrypt hash.
 *
 * The hash must match what src/auth.ts configures (bcrypt, 10 rounds), so a
 * password set here verifies through the normal sign-in path.
 *
 * Idempotent: re-running updates the password of an existing user rather than
 * failing, and the workspace is only created once.
 *
 *   bun run --filter @nuraview/api seed -- --email you@nuraview.com --password '...'
 */
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import db from "../src/database";
import getBrand from "../src/utils/get-brand";
import {
  account as accountTable,
  user_access as userAccessTable,
  user as userTable,
  workspace as workspaceTable,
  workspace_member as workspaceMemberTable,
} from "../src/database/schema";

/** Valid --crm values. Anything else is rejected rather than guessed at. */
const CRM_LEVELS = new Set(["none", "leads_kanban", "full"]);

/**
 * The workspace this instance's users belong to.
 *
 * Branded, not the constant "NuraView" it used to be: the name shows in the
 * workspace switcher and on every invitation, so seeding a client instance was
 * putting the vendor's name into the first thing their staff saw. Falls back to
 * "NuraView" when no brand is configured, which keeps NuraView's own seed
 * identical to what it has always produced.
 */
const WORKSPACE_NAME = getBrand().name;
const BCRYPT_ROUNDS = 10; // must match src/auth.ts

function arg(name: string, fallback?: string) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

async function main() {
  const email = arg("email", process.env.SEED_ADMIN_EMAIL)?.toLowerCase();
  const password = arg("password", process.env.SEED_ADMIN_PASSWORD);
  const name = arg("name", process.env.SEED_ADMIN_NAME ?? "Admin");
  // Workspace role governs the PROJECT BOARDS only.
  const role = arg("role", "member") as string;
  // CRM entitlement is separate and explicit — see the user_access table.
  //   none         (default) project boards only; CRM routes 403
  //   leads_kanban read-only leads, kanban view only
  //   full         everything ported so far
  // owner/admin of the instance workspace get `full` implicitly, no row needed.
  const crm = arg("crm", "none") as string;
  // Project boards, independent of the CRM level. A lead-gen employee gets
  // --crm leads_kanban --projects no and sees nothing else.
  const projectsArg = (arg("projects", "yes") as string).toLowerCase();
  const canAccessProjects = !["no", "false", "0"].includes(projectsArg);

  if (!email || !password) {
    console.error(
      "Usage: seed-instance --email <email> --password <password> [--name <name>]\n" +
        "                    [--role owner|admin|member] [--crm none|leads_kanban|full]\n" +
        "                    [--projects yes|no]\n" +
        "   or: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env vars.",
    );
    process.exit(1);
  }
  if (!CRM_LEVELS.has(crm)) {
    console.error(
      `Unknown --crm "${crm}". Expected one of: ${[...CRM_LEVELS].join(", ")}.`,
    );
    process.exit(1);
  }
  if (password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const now = new Date();

  const existing = await db
    .select()
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);

  let userId: string;

  if (existing.length > 0) {
    userId = existing[0].id;
    await db
      .update(accountTable)
      .set({ password: passwordHash, updatedAt: now })
      .where(eq(accountTable.userId, userId));
    console.log(`✓ ${email} already existed — password reset (${userId}).`);
  } else {
    const [created] = await db
      .insert(userTable)
      .values({
        name,
        email,
        emailVerified: true, // operator-provisioned; there is no verification flow
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    userId = created.id;

    // better-auth looks up credentials by providerId "credential", with
    // accountId set to the user id.
    await db.insert(accountTable).values({
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });

    console.log(`✓ Created ${email} (${userId}).`);
  }

  // One workspace for the whole instance. Its presence is what makes the
  // dashboard skip /onboarding, so nobody is ever asked to create one.
  const [workspace] = await db.select().from(workspaceTable).limit(1);

  if (workspace) {
    const member = await db
      .select()
      .from(workspaceMemberTable)
      .where(eq(workspaceMemberTable.userId, userId))
      .limit(1);

    if (member.length === 0) {
      await db.insert(workspaceMemberTable).values({
        workspaceId: workspace.id,
        userId,
        role,
        joinedAt: now,
      });
      console.log(`✓ Added to workspace "${workspace.name}" as ${role}.`);
    } else {
      console.log(`✓ Already a member of "${workspace.name}".`);
    }
  } else {
    const [ws] = await db
      .insert(workspaceTable)
      .values({
        name: WORKSPACE_NAME,
        slug: WORKSPACE_NAME.toLowerCase(),
        description: `Internal ${WORKSPACE_NAME} workspace`,
        createdAt: now,
      })
      .returning();

    await db.insert(workspaceMemberTable).values({
      workspaceId: ws.id,
      userId,
      role: "owner",
      joinedAt: now,
    });

    console.log(`✓ Created workspace "${WORKSPACE_NAME}" (owner: ${email}).`);
  }

  // Entitlement. Idempotent: re-running with different flags changes the grant
  // rather than failing.
  //
  // The row is only dropped when it would carry no information at all — no CRM
  // AND projects allowed, which is exactly what "no row" already means. Dropping
  // it whenever crm === "none" would silently restore project access to an
  // account that was meant to lose it.
  if (crm === "none" && canAccessProjects) {
    await db.delete(userAccessTable).where(eq(userAccessTable.userId, userId));
    console.log("✓ Access: projects only (no CRM).");
  } else {
    await db
      .insert(userAccessTable)
      .values({ userId, level: crm, canAccessProjects, grantedAt: now })
      .onConflictDoUpdate({
        target: userAccessTable.userId,
        set: { level: crm, canAccessProjects, grantedAt: now },
      });
    console.log(
      `✓ Access: CRM=${crm}, projects=${canAccessProjects ? "yes" : "no"}.`,
    );
  }

  console.log("\nDone. Public registration remains disabled.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
