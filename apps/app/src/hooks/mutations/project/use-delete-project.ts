import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteProject from "@/fetchers/project/delete-project";

/**
 * Delete a project.
 *
 * Invalidates the projects list HERE rather than leaving it to each caller.
 * There was previously no onSuccess at all, so every call site had to remember
 * to refetch: the sidebar did, the Projects table did not. That produced the
 * worst shape of bug — the delete succeeded server-side, the row stayed on
 * screen, and the operator clicked again on another row believing nothing had
 * happened. Several projects were removed that way before anyone realised the
 * list was simply stale.
 *
 * Owning it in the hook means a future call site cannot reintroduce it.
 */
function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteProject,
    onSuccess: () => {
      // Prefix match: every ["projects", workspaceId] cache entry.
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export default useDeleteProject;
