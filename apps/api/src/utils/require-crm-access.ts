/**
 * Gate for the CRM domains (leads, and whatever else gets ported next).
 *
 * NuraView's team splits into groups: people who run outreach and see the whole
 * lead pipeline, people who only ever look at the leads kanban, and people who
 * only work on project boards. Employees in the last group must not be able to
 * read 50k leads, client contact details or enrichment data.
 *
 * Enforcement lives HERE, on the server, not in the sidebar. Hiding a nav item
 * from someone who can still curl /api/lead/view is not access control.
 *
 * ---------------------------------------------------------------------------
 * Two things changed after a projects-only account was shown to reach the whole
 * CRM on production:
 *
 * 1. Role is read from the INSTANCE workspace only. It used to be "highest role
 *    the user holds in ANY workspace", so creating a workspace (which makes you
 *    its owner) promoted you to CRM access everywhere. Workspace creation is now
 *    disabled in auth.ts as well; this is the second lock, because the rule was
 *    wrong on its own terms — being owner of some other board should never have
 *    granted the lead pipeline.
 *
 * 2. Entitlement is explicit, in `crm_access`, rather than inferred from how
 *    much of the project boards you administer. Owner/admin of the instance
 *    still implies `full` so the existing admin needs no row.
 * ---------------------------------------------------------------------------
 */
import { and, asc, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  user_access as userAccessTable,
  workspace as workspaceTable,
  workspace_member as workspaceMemberTable,
  projectMemberTable,
} from "../database/schema";

/** Everything ported so far. */
export const CRM_FULL = "full";
/** Read-only leads, kanban only: no writes, no activity counters. */
export const CRM_LEADS_KANBAN = "leads_kanban";

export type CrmLevel = typeof CRM_FULL | typeof CRM_LEADS_KANBAN | "none";

const INSTANCE_ROLES_WITH_FULL_CRM = new Set(["owner", "admin"]);

/**
 * The single NuraView workspace: the oldest row. Cached for the process
 * lifetime — the instance workspace is provisioned once by seed-instance.ts and
 * never changes, and this sits in front of every CRM request.
 */
let instanceWorkspaceId: string | null = null;

async function getInstanceWorkspaceId(): Promise<string | null> {
  if (instanceWorkspaceId) return instanceWorkspaceId;

  const [row] = await db
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .orderBy(asc(workspaceTable.createdAt))
    .limit(1);

  instanceWorkspaceId = row?.id ?? null;
  return instanceWorkspaceId;
}

/** The user's role in the instance workspace, ignoring every other workspace. */
export async function getUserWorkspaceRole(
  userId: string,
): Promise<string | null> {
  if (!userId) return null;

  const workspaceId = await getInstanceWorkspaceId();
  if (!workspaceId) return null;

  const [row] = await db
    .select({ role: workspaceMemberTable.role })
    .from(workspaceMemberTable)
    .where(
      and(
        eq(workspaceMemberTable.userId, userId),
        eq(workspaceMemberTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  return row?.role ?? null;
}

async function getGrant(userId: string) {
  const [grant] = await db
    .select({
      level: userAccessTable.level,
      canAccessProjects: userAccessTable.canAccessProjects,
    })
    .from(userAccessTable)
    .where(eq(userAccessTable.userId, userId))
    .limit(1);

  return grant ?? null;
}

export async function getCrmLevel(userId: string): Promise<CrmLevel> {
  if (!userId) return "none";

  const role = await getUserWorkspaceRole(userId);
  if (role && INSTANCE_ROLES_WITH_FULL_CRM.has(role)) return CRM_FULL;

  const grant = await getGrant(userId);

  // An unrecognised level is treated as no access rather than as some default,
  // so a typo in a grant fails closed.
  if (grant?.level === CRM_FULL) return CRM_FULL;
  if (grant?.level === CRM_LEADS_KANBAN) return CRM_LEADS_KANBAN;

  return "none";
}

/**
 * Project boards. Independent of CRM level: a lead-gen employee reads the leads
 * kanban and nothing else, while a projects-only employee is the reverse.
 *
 * Absence of a grant row means "projects allowed" — that is the default shape
 * of an ordinary employee, and it keeps every account that predates this table
 * working unchanged.
 */
export async function canAccessProjects(userId: string): Promise<boolean> {
  if (!userId) return false;

  const grant = await getGrant(userId);
  if (!grant) return true;

  return grant.canAccessProjects;
}

export async function canAccessCrm(userId: string): Promise<boolean> {
  return (await getCrmLevel(userId)) === CRM_FULL;
}

export async function canReadLeads(userId: string): Promise<boolean> {
  const level = await getCrmLevel(userId);
  return level === CRM_FULL || level === CRM_LEADS_KANBAN;
}

function deny(): never {
  // 403 rather than 404 deliberately: the caller is authenticated and the route
  // exists, they simply are not entitled to it.
  throw new HTTPException(403, {
    message:
      "This account does not have CRM access. Ask an admin if you need leads.",
  });
}

/** Full CRM only. Default for anything that writes or exposes more than leads. */
export async function requireCrmAccess(c: Context, next: Next) {
  const userId = c.get("userId") as string | undefined;
  if (!userId || !(await canAccessCrm(userId))) deny();
  await next();
}

/**
 * The whole /lead domain, for anyone with any level of leads access.
 *
 * Was read-only, then an allow-list of individual write paths, and both were
 * wrong in the same direction: leads ARE the lead-gen role's job, so every time
 * the product grew a lead endpoint the role lost a piece of its own work and
 * someone had to notice and re-open it. The role could research a lead, save
 * the address it found and draft the outreach — then got 403 on Send.
 *
 * So the boundary is the DOMAIN, not the verb: everything under /lead is open
 * to a leads account, and everything outside it still needs full CRM. The
 * consequence is deliberate — a new /lead endpoint is reachable by the lead-gen
 * role the day it ships. Anything that should NOT be must live outside /lead,
 * which is the honest place for it anyway.
 *
 * Still refuses accounts with no leads grant at all (level "none").
 */
export async function requireLeadsAccess(c: Context, next: Next) {
  const userId = c.get("userId") as string | undefined;
  if (!userId || !(await canReadLeads(userId))) deny();
  await next();
}

/**
 * Project boards and everything that hangs off them.
 *
 * Applied by prefix in index.ts rather than inside each router, so the whole PM
 * surface is covered in one place and a newly mounted PM domain is a one-line
 * addition to that list instead of an edit to the domain itself.
 */
export async function requireProjectAccess(c: Context, next: Next) {
  const userId = c.get("userId") as string | undefined;

  if (!userId || !(await canAccessProjects(userId))) {
    throw new HTTPException(403, {
      message:
        "This account does not have access to project boards. Ask an admin if you need them.",
    });
  }

  await next();
}

/**
 * May this user open THIS project?
 *
 * canAccessProjects answers a coarser question — "is the PM module on for this
 * account" — and requireProjectAccess only ever asked that. So a member who was
 * assigned to one board could still fetch any other board by id: the sidebar
 * hid it, the API did not. Hiding a nav item from someone who can still GET the
 * resource is not access control.
 *
 * Same rule as the project list, kept in one place so the two cannot drift:
 *   owner / admin           -> any project
 *   member WITH assignments -> only those
 *   member WITHOUT any      -> none
 */
export async function canOpenProject(
  userId: string,
  projectId: string,
): Promise<boolean> {
  if (!userId || !projectId) return false;
  if (!(await canAccessProjects(userId))) return false;

  const role = await getUserWorkspaceRole(userId);
  if (role === "owner" || role === "admin") return true;

  const [row] = await db
    .select({ projectId: projectMemberTable.projectId })
    .from(projectMemberTable)
    .where(
      and(
        eq(projectMemberTable.userId, userId),
        eq(projectMemberTable.projectId, projectId),
      ),
    )
    .limit(1);

  return Boolean(row);
}

/** Throws 404, not 403 — a board you may not open should not confirm it exists. */
export async function assertCanOpenProject(userId: string, projectId: string) {
  if (!(await canOpenProject(userId, projectId))) {
    throw new HTTPException(404, { message: "Project not found" });
  }
}

export { and };
