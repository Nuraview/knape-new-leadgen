import {
  WORKSPACE_CAPABILITIES,
  type WorkspaceCapability,
  type WorkspaceCapabilityMap,
} from "@nuraview/permissions";
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import * as v from "valibot";
import { auth } from "../auth";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import getWorkspaceMembersCtrl from "./controllers/get-workspace-members";

const workspace = new Hono<{
  Variables: {
    userId: string;
    workspaceId: string;
  };
}>().get(
  "/:workspaceId/members",
  describeRoute({
    operationId: "getWorkspaceMembers",
    tags: ["Workspaces"],
    description: "Get all members of a workspace",
    responses: {
      200: {
        description: "List of workspace members",
        content: {
          "application/json": {
            schema: resolver(
              v.array(
                v.object({
                  id: v.string(),
                  name: v.string(),
                  email: v.string(),
                  image: v.nullable(v.string()),
                  role: v.string(),
                }),
              ),
            ),
          },
        },
      },
    },
  }),
  validator("param", v.object({ workspaceId: v.string() })),
  workspaceAccess.fromParam("workspaceId"),
  async (c) => {
    const workspaceId = c.get("workspaceId");
    const members = await getWorkspaceMembersCtrl(workspaceId);
    return c.json(members);
  },
)
  /**
   * Every UI capability for the caller, in ONE request.
   *
   * The browser used to ask `/organization/has-permission` once per capability
   * — 12 requests on every page load, each re-running the same member+role
   * lookup, each paying a full round trip. Evaluating them here keeps the
   * answers identical (same better-auth call, so custom workspace roles still
   * resolve) while collapsing 12 network round trips into one.
   *
   * Deliberately goes through `auth.api.hasPermission` rather than reading the
   * role rows directly: the role -> permission mapping is better-auth's, and a
   * second implementation of it here would be a silent authorization drift the
   * moment either side changed.
   */
  .get(
    "/:workspaceId/capabilities",
    describeRoute({
      operationId: "getWorkspaceCapabilities",
      tags: ["Workspaces"],
      description:
        "Resolve every named permission bundle for the current user in one call",
      responses: {
        200: {
          description: "Map of capability name to whether the caller has it",
          content: {
            "application/json": {
              schema: resolver(v.record(v.string(), v.boolean())),
            },
          },
        },
      },
    }),
    validator("param", v.object({ workspaceId: v.string() })),
    workspaceAccess.fromParam("workspaceId"),
    async (c) => {
      const workspaceId = c.get("workspaceId");
      const headers = c.req.raw.headers;

      const entries = Object.entries(WORKSPACE_CAPABILITIES) as Array<
        [WorkspaceCapability, Record<string, string[]>]
      >;

      const results = await Promise.all(
        entries.map(async ([name, permissions]) => {
          try {
            const result = await auth.api.hasPermission({
              headers,
              body: {
                organizationId: workspaceId,
                // better-auth types this as its own statement shape; the
                // bundles are defined against the same `ac` statement object.
                permissions: permissions as never,
              },
            });
            return [name, result?.success === true] as const;
          } catch {
            // A failed check is "no". Denying an action the user actually has
            // is recoverable by a reload; granting one they do not is not.
            return [name, false] as const;
          }
        }),
      );

      const capabilities = Object.fromEntries(results) as WorkspaceCapabilityMap;

      return c.json(capabilities);
    },
  );

export default workspace;
