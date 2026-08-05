import { useQuery } from "@tanstack/react-query";
import getLabelsByWorkspace from "@/fetchers/label/get-label-by-workspace";
import { useMyAccess } from "@/hooks/queries/use-my-access";

/**
 * Workspace labels.
 *
 * Gated on project access because the create-task modal — one of its callers —
 * is mounted globally by the command palette, so this request fired on every
 * page for every account. A lead-gen account gets 403 from /api/label/*, which
 * meant console errors on a page with no labels anywhere in sight.
 */
function useGetLabelsByWorkspace(workspaceId: string) {
  const { data: access } = useMyAccess();

  return useQuery({
    enabled: Boolean(workspaceId) && access?.canAccessProjects === true,
    queryKey: ["labels", workspaceId],
    queryFn: () => getLabelsByWorkspace({ workspaceId }),
  });
}

export default useGetLabelsByWorkspace;
