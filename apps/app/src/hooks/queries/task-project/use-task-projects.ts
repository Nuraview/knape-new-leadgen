import { useQuery } from "@tanstack/react-query";
import { listTaskProjects } from "@/fetchers/task-project";

/** Work streams for the workspace. Short list, changes rarely. */
export function useTaskProjects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: ["task-projects", workspaceId],
    queryFn: () => listTaskProjects(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60_000,
  });
}

export default useTaskProjects;
