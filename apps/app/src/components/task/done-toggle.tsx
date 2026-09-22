/**
 * The tick on the front of a card.
 *
 * Finishing a task meant dragging it to the last column, across a board that
 * scrolls sideways, with the pointer held down the whole way — "dragging cards
 * is tedious!!" (VK, 2026-09-04). A status is one field; this is one click.
 *
 * Deliberately NOT a checkbox element: the card it sits on is itself a button
 * (it opens the task) and a drag handle, so every event this fires has to stop
 * where it is. Pointer-down is swallowed too, not just the click — dnd-kit
 * starts a drag from pointer-down, and a tick that sometimes picks the card up
 * instead is worse than no tick.
 */
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSetTaskStatus } from "@/hooks/mutations/task/use-set-task-status";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import { type ColumnLike, doneSlugOf, isDoneStatus, openSlugOf } from "@/lib/task-done";

type DoneToggleProps = {
  taskId: string;
  projectId?: string;
  status: string | null | undefined;
  columns: ColumnLike[] | undefined | null;
  /** Bigger hit area on the card front than in a dense checklist row. */
  size?: "sm" | "md";
  className?: string;
  disabled?: boolean;
  onToggled?: (done: boolean) => void;
};

export function DoneToggle({
  taskId,
  projectId,
  status,
  columns,
  size = "md",
  className,
  disabled = false,
  onToggled,
}: DoneToggleProps) {
  const { t } = useTranslation();
  const { mutateAsync: setStatus, isPending } = useSetTaskStatus();

  const done = isDoneStatus(status, columns);
  const doneSlug = doneSlugOf(columns);
  const openSlug = openSlugOf(columns);
  const target = done ? openSlug : doneSlug;

  // A board with no final column has no notion of done, and a board with only
  // final columns has nothing to go back to. Render nothing rather than a
  // control that cannot do anything.
  if (!target) return null;

  const toggle = async () => {
    if (disabled || isPending) return;
    try {
      await setStatus({ taskId, projectId, status: target });
      onToggled?.(!done);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("tasks:update.error"),
      );
    }
  };

  return (
    <button
      type="button"
      aria-pressed={done}
      disabled={disabled || isPending}
      title={
        done
          ? t("tasks:done.undoAction", { defaultValue: "Mark as not done" })
          : t("tasks:done.action", { defaultValue: "Mark as done" })
      }
      aria-label={
        done
          ? t("tasks:done.undoAction", { defaultValue: "Mark as not done" })
          : t("tasks:done.action", { defaultValue: "Mark as done" })
      }
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        void toggle();
      }}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border transition-colors",
        size === "md" ? "size-4.5" : "size-4",
        done
          ? "border-emerald-500 bg-emerald-500 text-white"
          : "border-muted-foreground/40 text-transparent hover:border-emerald-500 hover:text-emerald-500/70",
        isPending && "opacity-60",
        className,
      )}
    >
      <Check className={size === "md" ? "size-3" : "size-2.5"} strokeWidth={3} />
    </button>
  );
}

export default DoneToggle;
