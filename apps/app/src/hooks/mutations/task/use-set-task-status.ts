import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTaskStatus from "@/fetchers/task/update-task-status";

/**
 * Move one task to a status, by id.
 *
 * useUpdateTaskStatus wants a whole Task and is what the context menu passes.
 * The tick on a card front and the checkboxes in its subtask list have an id
 * and a slug and nothing else — the subtasks arrive as four fields on the
 * parent — so this takes what those callers actually hold.
 */
export function useSetTaskStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: string; projectId?: string }) =>
      updateTaskStatus(taskId, { status }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["task", variables.taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks", variables.projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["task-relations"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export default useSetTaskStatus;
