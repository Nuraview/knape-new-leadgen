/**
 * Who can see a project.
 *
 * VK: "I would like to manually add people to its project and they can only
 * see and access those projects. For ex: one member can see a single client project
 * dashboard."
 *
 * Assignment already existed as a table and a CLI script; what was missing was
 * any way to do it without SSH, which meant in practice nobody was assigned —
 * and since the list defaulted to "unassigned sees everything", every employee
 * could read every client's board.
 *
 * Only owners and admins may read or change this. A member being able to list
 * who else is on a board tells them boards exist that they cannot open.
 */
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  projectMemberTable,
  projectTable,
  userTable,
  workspace_member as workspaceMemberTable,
} from "../database/schema";
import { getUserWorkspaceRole } from "../utils/require-crm-access";

async function requireAdmin(userId: string) {
  const role = await getUserWorkspaceRole(userId);
  if (role !== "owner" && role !== "admin") {
    throw new HTTPException(403, {
      message: "Only owners and admins can manage project access.",
    });
  }
}

const members = new Hono<{ Variables: { userId: string } }>()
  /**
   * Everyone in the workspace, flagged with whether they are on this project.
   *
   * One list rather than "members" and "candidates" separately: the UI is a
   * set of checkboxes, and two endpoints to render one list is two chances for
   * them to disagree about who exists.
   */
  .get("/:projectId/members", async (c) => {
    await requireAdmin(c.get("userId"));
    const projectId = c.req.param("projectId");

    const [project] = await db
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(eq(projectTable.id, projectId))
      .limit(1);
    if (!project) throw new HTTPException(404, { message: "Project not found" });

    const assigned = await db
      .select({ userId: projectMemberTable.userId })
      .from(projectMemberTable)
      .where(eq(projectMemberTable.projectId, projectId));
    const assignedIds = new Set(assigned.map((a) => a.userId));

    const people = await db
      .select({
        id: userTable.id,
        name: userTable.name,
        email: userTable.email,
        image: userTable.image,
        role: workspaceMemberTable.role,
      })
      .from(workspaceMemberTable)
      .innerJoin(userTable, eq(userTable.id, workspaceMemberTable.userId))
      .orderBy(userTable.name);

    return c.json({
      items: people.map((p) => ({
        ...p,
        assigned: assignedIds.has(p.id),
        // Owners and admins see every board regardless, so a checkbox for them
        // would be a control that does nothing.
        alwaysHasAccess: p.role === "owner" || p.role === "admin",
      })),
    });
  })

  /** Add someone to the project. Idempotent. */
  .post("/:projectId/members", async (c) => {
    await requireAdmin(c.get("userId"));
    const projectId = c.req.param("projectId");
    const { userId } = await c.req.json<{ userId?: string }>();
    if (!userId) throw new HTTPException(400, { message: "userId is required" });

    const [existing] = await db
      .select({ id: projectMemberTable.id })
      .from(projectMemberTable)
      .where(
        and(
          eq(projectMemberTable.projectId, projectId),
          eq(projectMemberTable.userId, userId),
        ),
      )
      .limit(1);

    if (!existing) {
      await db
        .insert(projectMemberTable)
        .values({ projectId, userId, createdAt: new Date() });
    }

    return c.json({ projectId, userId, assigned: true });
  })

  /** Remove someone. */
  .delete("/:projectId/members/:userId", async (c) => {
    await requireAdmin(c.get("userId"));
    const projectId = c.req.param("projectId");
    const userId = c.req.param("userId");

    await db
      .delete(projectMemberTable)
      .where(
        and(
          eq(projectMemberTable.projectId, projectId),
          eq(projectMemberTable.userId, userId),
        ),
      );

    return c.json({ projectId, userId, assigned: false });
  });

export default members;
