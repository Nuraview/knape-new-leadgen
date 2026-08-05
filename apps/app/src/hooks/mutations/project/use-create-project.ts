import { useMutation, useQueryClient } from "@tanstack/react-query";
import createProject from "@/fetchers/project/create-project";

function useCreateProject({
  name,
  slug,
  workspaceId,
  icon,
}: {
  name: string;
  slug: string;
  workspaceId: string;
  icon: string;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createProject({ name, slug, workspaceId, icon }),
    // Without this the project list keeps serving its cached (usually empty)
    // result, so creating a project reported success and then still showed
    // "No projects yet" until a manual reload. The row was in the database the
    // whole time — only the cache was stale.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects", workspaceId] });
    },
  });
}

export default useCreateProject;
