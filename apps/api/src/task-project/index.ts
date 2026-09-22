/**
 * Work streams — the "Project" a card belongs to, as distinct from the board
 * it sits on. See taskProjectTable in database/schema.ts for why the two are
 * different things with the same name.
 *
 * Permissions ride on `label`, because a stream is the same kind of object to
 * a user: a name and a colour they attach to cards. Deletion is the exception
 * and needs `project: delete` — removing a stream nulls it on every card in
 * the workspace, which is not a change one member should be able to make to
 * everyone else's boards.
 */
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver, validator } from "hono-openapi";
import * as v from "valibot";
import db from "../database";
import { taskProjectTable, taskTable } from "../database/schema";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";

const taskProjectSchema = v.object({
  id: v.string(),
  workspaceId: v.string(),
  name: v.string(),
  color: v.string(),
  taskCount: v.optional(v.number()),
});

const taskProject = new Hono<{ Variables: { userId: string } }>()
  /** Every stream in the workspace, with how many cards each holds. */
  .get(
    "/workspace/:workspaceId",
    describeRoute({
      operationId: "listTaskProjects",
      tags: ["TaskProjects"],
      description: "List the work streams in a workspace",
      responses: {
        200: {
          description: "Work streams",
          content: {
            "application/json": {
              schema: resolver(v.array(taskProjectSchema)),
            },
          },
        },
      },
    }),
    validator("param", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ label: ["read"] }),
    async (c) => {
      const { workspaceId } = c.req.valid("param");
      const rows = await db
        .select({
          id: taskProjectTable.id,
          workspaceId: taskProjectTable.workspaceId,
          name: taskProjectTable.name,
          color: taskProjectTable.color,
          taskCount: sql<number>`(
            select count(*) from ${taskTable}
             where ${taskTable.taskProjectId} = ${taskProjectTable.id}
          )`,
        })
        .from(taskProjectTable)
        .where(eq(taskProjectTable.workspaceId, workspaceId))
        .orderBy(taskProjectTable.name);

      return c.json(rows.map((r) => ({ ...r, taskCount: Number(r.taskCount) })));
    },
  )

  /**
   * Create a stream. Idempotent on (workspace, name): the bulk importer calls
   * this for every row it reads, and a second card naming the same stream must
   * join the existing one rather than fail the import.
   */
  .post(
    "/workspace/:workspaceId",
    describeRoute({
      operationId: "createTaskProject",
      tags: ["TaskProjects"],
      description: "Create a work stream (returns the existing one by name)",
      responses: {
        200: {
          description: "The stream",
          content: {
            "application/json": { schema: resolver(taskProjectSchema) },
          },
        },
      },
    }),
    validator("param", v.object({ workspaceId: v.string() })),
    validator(
      "json",
      v.object({
        name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
        color: v.optional(v.string()),
      }),
    ),
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ label: ["create"] }),
    async (c) => {
      const { workspaceId } = c.req.valid("param");
      const { name, color } = c.req.valid("json");

      const [existing] = await db
        .select()
        .from(taskProjectTable)
        .where(
          and(
            eq(taskProjectTable.workspaceId, workspaceId),
            eq(taskProjectTable.name, name),
          ),
        )
        .limit(1);
      if (existing) return c.json(existing);

      const [created] = await db
        .insert(taskProjectTable)
        .values({ workspaceId, name, color: color || "gray" })
        .returning();
      return c.json(created);
    },
  )

  /** Rename or recolour. One place, so every card following it updates. */
  .patch(
    "/:id",
    describeRoute({
      operationId: "updateTaskProject",
      tags: ["TaskProjects"],
      description: "Rename or recolour a work stream",
      responses: {
        200: {
          description: "The updated stream",
          content: {
            "application/json": { schema: resolver(taskProjectSchema) },
          },
        },
      },
    }),
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({
        name: v.optional(
          v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(80)),
        ),
        color: v.optional(v.string()),
      }),
    ),
    workspaceAccess.fromTaskProject("id"),
    requireWorkspacePermission({ label: ["update"] }),
    async (c) => {
      const { id } = c.req.valid("param");
      const patch = c.req.valid("json");
      const [updated] = await db
        .update(taskProjectTable)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(taskProjectTable.id, id))
        .returning();
      if (!updated) throw new HTTPException(404, { message: "Not found" });
      return c.json(updated);
    },
  )

  /** Retire a stream. Cards survive — the FK is ON DELETE SET NULL. */
  .delete(
    "/:id",
    describeRoute({
      operationId: "deleteTaskProject",
      tags: ["TaskProjects"],
      description: "Delete a work stream; its cards are kept and unassigned",
      responses: { 200: { description: "Deleted" } },
    }),
    validator("param", v.object({ id: v.string() })),
    workspaceAccess.fromTaskProject("id"),
    requireWorkspacePermission({ project: ["delete"] }),
    async (c) => {
      const { id } = c.req.valid("param");
      const [deleted] = await db
        .delete(taskProjectTable)
        .where(eq(taskProjectTable.id, id))
        .returning();
      if (!deleted) throw new HTTPException(404, { message: "Not found" });
      return c.json({ success: true });
    },
  );

export default taskProject;
