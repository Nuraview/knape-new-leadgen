import {
  WORKSPACE_CAPABILITY_NAMES,
  type WorkspaceCapability,
  type WorkspaceCapabilityMap,
} from "@nuraview/permissions";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getApiUrl } from "@/fetchers/get-api-url";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUser } from "@/hooks/queries/workspace-users/use-active-workspace-user";
import { authClient } from "@/lib/auth-client";

export type PermissionLevel = "owner" | "admin" | "member";

// Capabilities are named permission bundles resolved by the SERVER. Going
// through the server is what makes custom workspace roles work in the UI — the
// local `checkRolePermission` only knows about the four static roles compiled
// into the auth client, so it would silently return false for any custom role
// that grants the permission.
//
// The bundle definitions live in @nuraview/permissions and are read by the
// endpoint too, so the UI and the check cannot drift apart.
type Capability = WorkspaceCapability;

type CapabilityMap = WorkspaceCapabilityMap;

function emptyCapabilityMap(): CapabilityMap {
  const out = {} as CapabilityMap;
  for (const key of WORKSPACE_CAPABILITY_NAMES) {
    out[key] = false;
  }
  return out;
}

export function useWorkspacePermission() {
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: activeMember } = useGetActiveWorkspaceUser();
  const workspaceId = activeWorkspace?.id;
  const role = activeMember?.role as string | undefined;

  // ONE request for the whole map, cached by (workspaceId, role). Refetches
  // when either changes — e.g., when the admin edits the role's permissions in
  // the Roles UI and we invalidate this key.
  //
  // This used to fan out to one `/organization/has-permission` request PER
  // capability. React Query deduped it to a single query instance, but that
  // instance still issued 12 concurrent HTTP requests, so every cold page load
  // paid 12 round trips for what is one question about one role. On the leads
  // page those were 12 of ~20 requests in the waterfall.
  const {
    data: capabilities,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["workspace-capabilities", workspaceId, role],
    enabled: Boolean(workspaceId && role),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<CapabilityMap> => {
      // Resolves to all-false rather than throwing, which is what the
      // per-capability version did: better-auth returns {data, error} instead
      // of rejecting, so a 403 became `false` and the query still SETTLED.
      // Throwing here would leave `capabilities` undefined, which pins
      // `isCheckingPermissions` true forever and hides every action button
      // instead of just disabling it.
      try {
        const response = await fetch(
          getApiUrl(`workspace/${workspaceId}/capabilities`),
          { credentials: "include" },
        );

        if (!response.ok) {
          console.error(`Capability check failed (${response.status})`);
          return emptyCapabilityMap();
        }

        const granted = (await response.json()) as Partial<
          Record<Capability, boolean>
        >;

        // Rebuilt from the known key list rather than trusting the response
        // shape, so a capability the server omits reads as false instead of
        // undefined leaking into a `can…()` check.
        const map = emptyCapabilityMap();
        for (const key of WORKSPACE_CAPABILITY_NAMES) {
          map[key] = granted[key] === true;
        }
        return map;
      } catch (error) {
        console.error("Capability check failed:", error);
        return emptyCapabilityMap();
      }
    },
  });

  const can: CapabilityMap = capabilities ?? emptyCapabilityMap();

  const helpers = useMemo(() => {
    return {
      canManageProjects: () => can.manageProjects,
      canCreateProjects: () => can.createProjects,
      canDeleteProjects: () => can.deleteProjects,
      canManageTasks: () => can.manageTasks,
      canCreateTasks: () => can.createTasks,
      canAssignTasks: () => can.assignTasks,
      canManageLabels: () => can.manageLabels,
      canManageWorkspace: () => can.manageWorkspace,
      canDeleteWorkspace: () => can.deleteWorkspace,
      canInviteUsers: () => can.inviteUsers,
      canManageTeam: () => can.manageTeam,
      canRemoveMembers: () => can.removeMembers,
      // Escape hatch for ad-hoc permission checks (uncached). Prefer adding
      // a capability above.
      hasPermission: async (permissions: Record<string, string[]>) => {
        try {
          const res = await authClient.organization.hasPermission({
            organizationId: workspaceId,
            permissions,
          });
          return res.data?.success === true;
        } catch (error) {
          console.error("hasPermission check failed:", error);
          return false;
        }
      },
    };
  }, [can, workspaceId]);

  return {
    ...helpers,
    workspace: activeWorkspace,
    member: activeMember,
    role,
    isOwner: role === "owner",
    isAdmin: role === "owner" || role === "admin",
    // True while the first capability fetch is in flight. Useful for hiding
    // action UI during the initial render instead of flashing it on then
    // off when the server check resolves.
    isCheckingPermissions:
      Boolean(workspaceId && role) && (isLoading || !capabilities),
    isRefetchingPermissions: isFetching,
  };
}
