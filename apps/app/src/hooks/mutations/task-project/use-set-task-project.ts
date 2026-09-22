import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createTaskProject, setTaskProjectOnTask } from "@/fetchers/task-project";

export function useSetTaskProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      taskProjectId,
    }: {
      taskId: string;
      taskProjectId: string | null;
    }) => setTaskProjectOnTask(taskId, taskProjectId),
    onSuccess: () => {
      // The chip lives on the board card and in the detail panel, so both
      // caches have to drop — refreshing only the panel leaves the board
      // showing the old stream until a hard reload.
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task"] });
    },
  });
}

export function useCreateTaskProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      workspaceId,
      name,
      color,
    }: {
      workspaceId: string;
      name: string;
      color?: string;
    }) => createTaskProject(workspaceId, name, color),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["task-projects", vars.workspaceId],
      });
    },
  });
}
