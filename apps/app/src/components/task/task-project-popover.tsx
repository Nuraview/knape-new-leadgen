/**
 * Pick the work stream a card belongs to — "Win the Day Planner",
 * "Nuraview CRM". Not the board: boards here are per-person, and one board
 * carries cards from several streams.
 *
 * Creating from inside the picker is deliberate. The alternative is a settings
 * page you must visit before you can file the card you are looking at, which
 * is how people give up and use a label instead — exactly the drift this
 * replaced.
 */
import { Check, FolderKanban, Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useCreateTaskProject,
  useSetTaskProject,
} from "@/hooks/mutations/task-project/use-set-task-project";
import useTaskProjects from "@/hooks/queries/task-project/use-task-projects";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { resolveLabelColor } from "@/lib/label-color";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type Props = {
  task: Task;
  workspaceId: string;
  children: React.ReactNode;
};

export default function TaskProjectPopover({
  task,
  workspaceId,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const { data: streams = [] } = useTaskProjects(workspaceId);
  const { mutateAsync: setStream } = useSetTaskProject();
  const { mutateAsync: createStream } = useCreateTaskProject();
  const { canUpdateTasks } = useWorkspacePermission();
  const canEdit = canUpdateTasks();

  const apply = async (taskProjectId: string | null) => {
    try {
      await setStream({ taskId: task.id, taskProjectId });
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not set the project",
      );
    }
  };

  const addAndApply = async () => {
    const name = draft.trim();
    if (!name) return;
    try {
      const created = await createStream({ workspaceId, name });
      setDraft("");
      await apply(created.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create the project",
      );
    }
  };

  if (!canEdit) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="max-h-56 overflow-y-auto">
          {streams.map((s) => (
            <Button
              key={s.id}
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 px-2"
              onClick={() => apply(s.id)}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: resolveLabelColor(s.color) }}
              />
              <span className="flex-1 truncate text-left text-xs">
                {s.name}
              </span>
              {task.taskProjectId === s.id && (
                <Check className="h-3.5 w-3.5 shrink-0" />
              )}
            </Button>
          ))}
          {streams.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              No projects yet
            </p>
          )}
        </div>

        {task.taskProjectId && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 px-2 text-muted-foreground"
            onClick={() => apply(null)}
          >
            <X className="h-3.5 w-3.5" />
            <span className="text-xs">Clear</span>
          </Button>
        )}

        <div className="mt-1 flex items-center gap-1 border-t pt-1">
          <FolderKanban className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addAndApply();
              }
            }}
            placeholder="New project…"
            className="h-7 border-0 text-xs shadow-none focus-visible:ring-0"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            disabled={!draft.trim()}
            onClick={addAndApply}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
