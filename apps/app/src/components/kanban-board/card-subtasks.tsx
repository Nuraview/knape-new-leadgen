/**
 * The checklist on the front of a card.
 *
 * Subtasks are real tasks here, so the board used to draw each one as a card
 * of its own next to its parent: a twelve-row import with three subtasks each
 * arrived as forty-eight cards, and the checklist was scattered across the
 * column it belonged to ("its adding as separate tasks when bulk import", VK).
 *
 * They are hidden as cards now, which is only fair if the parent shows what it
 * is holding — so the 2/5 badge opens into the list, and each line ticks off
 * in place. That is also the fastest way to finish a subtask that exists: no
 * card to open, no column to drag to.
 */
import { ChevronDown, ListChecks } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import DoneToggle from "@/components/task/done-toggle";
import { cn } from "@/lib/cn";
import type { ColumnLike } from "@/lib/task-done";
import type Task from "@/types/task";

type CardSubtasksProps = {
  task: Task;
  columns: ColumnLike[] | undefined | null;
};

export function CardSubtasks({ task, columns }: CardSubtasksProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const subtasks = task.subtasks ?? [];
  const total = task.subtaskTotal ?? subtasks.length;
  if (total === 0) return null;

  const done = task.subtaskDone ?? subtasks.filter((s) => s.done).length;
  const complete = done === total;

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        title={t("tasks:badges.subtasks", {
          done,
          total,
          defaultValue: `${done} of ${total} subtasks done`,
        })}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((value) => !value);
        }}
        className={cn(
          "inline-flex items-center gap-1 rounded transition-colors hover:text-foreground",
          complete && "text-emerald-500",
        )}
      >
        <ListChecks className="h-3.5 w-3.5" />
        {done}/{total}
        {subtasks.length > 0 && (
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform",
              open && "rotate-180",
            )}
          />
        )}
      </button>

      {open && subtasks.length > 0 && (
        // biome-ignore lint/a11y/noStaticElementInteractions: the card behind this is the click target it is shielding
        <div
          className="mt-1.5 w-full space-y-1 border-t border-border/60 pt-1.5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {subtasks.map((subtask) => (
            <div key={subtask.id} className="flex items-start gap-1.5">
              <DoneToggle
                taskId={subtask.id}
                projectId={task.projectId}
                status={subtask.status}
                columns={columns}
                size="sm"
                className="mt-px"
              />
              <span
                className={cn(
                  "min-w-0 break-words text-[11px] leading-4",
                  subtask.done && "text-muted-foreground line-through",
                )}
              >
                {subtask.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default CardSubtasks;
