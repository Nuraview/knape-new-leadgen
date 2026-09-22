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
  updateNotificationPreferences,
  upsertWorkspaceRule,
} from "../src/notification-preferences/service";
import {
  account as accountTable,
  user_access as userAccessTable,
  userNotificationPreferenceTable,
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

  /*
   * Re-run against an existing account WITHOUT touching its password.
   *
   * Re-running this script is how an existing account picks up something the
   * script has learned to do since — the notification rows below, for one. The
   * only way to do that was to pass a password, which resets it: correcting
   * Peter's notification settings would have locked Peter out of his own CRM
   * and handed his new password to whoever ran the script.
   */
  const keepPassword = process.argv.includes("--keep-password");

  if (!email || (!password && !keepPassword)) {
    console.error(
      "Usage: seed-instance --email <email> --password <password> [--name <name>]\n" +
        "                    [--role owner|admin|member] [--crm none|leads_kanban|full]\n" +
        "                    [--projects yes|no]\n" +
        "   or: seed-instance --email <email> --keep-password   (existing account,\n" +
        "                    re-applies role/access/notification settings only)\n" +
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
  if (!keepPassword && password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }

  const passwordHash = keepPassword
    ? null
    : await bcrypt.hash(password, BCRYPT_ROUNDS);
  const now = new Date();

  const existing = await db
    .select()
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);

  let userId: string;

  if (existing.length > 0) {
    userId = existing[0].id;
    if (passwordHash) {
      await db
        .update(accountTable)
        .set({ password: passwordHash, updatedAt: now })
        .where(eq(accountTable.userId, userId));
      console.log(`✓ ${email} already existed — password reset (${userId}).`);
    } else {
      console.log(`✓ ${email} already existed — password untouched (${userId}).`);
    }
  } else {
    if (!passwordHash) {
      console.error(
        `--keep-password needs an existing account, and there is no ${email}.`,
      );
      process.exit(1);
    }
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
  let workspaceId = workspace?.id ?? null;

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

    workspaceId = ws.id;
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

  /*
   * Turn email notifications ON for this account.
   *
   * deliverNotification() bails twice before it ever reaches SMTP: once when
   * the user has no user_notification_preference row at all, and again when
   * they have no ACTIVE user_notification_workspace_rule for the workspace the
   * task is in. Both `email_enabled` columns default to false. Nothing in the
   * product writes either row — they are created by the user's own Settings →
   * Account → Notifications page.
   *
   * So a freshly seeded account got the in-app bell and nothing else, forever,
   * unless the person happened to find that page and flip two switches. VK
   * asked on 2026-09-22 for tagging Peter, Oswe or Catherine to email them,
   * "just like crm.tech5SA" — where the old watcher path emailed
   * unconditionally, with no preference table in front of it. An opt-in that
   * nobody is told about is indistinguishable from a bug.
   *
   * Seeded through the service rather than by writing the tables directly, so
   * the channel cascade and secret handling stay in one place. Existing rows
   * are left as they are: this sets a starting point, it does not overrule
   * somebody who has since turned email off.
   */
  if (workspaceId) {
    const existingPreference =
      await db.query.userNotificationPreferenceTable.findFirst({
        where: eq(userNotificationPreferenceTable.userId, userId),
      });

    if (!existingPreference) {
      await updateNotificationPreferences(userId, email, {
        emailEnabled: true,
        taskAssignmentEnabled: true,
        taskCommentEnabled: true,
        taskStatusChangeEnabled: true,
        dueDateReminderEnabled: true,
      });

      await upsertWorkspaceRule(userId, workspaceId, email, {
        isActive: true,
        emailEnabled: true,
        ntfyEnabled: false,
        gotifyEnabled: false,
        webhookEnabled: false,
        // Every board in the workspace. "selected" would need a list of
        // project ids that do not exist yet on a fresh instance.
        projectMode: "all",
      });

      console.log("✓ Email notifications on (mentions, comments, assignment).");
    } else {
      console.log("✓ Notification preferences already set — left alone.");
    }
  }

  console.log("\nDone. Public registration remains disabled.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
