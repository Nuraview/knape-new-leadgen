import { produce } from "immer";
import { Archive, CircleCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useDeleteColumn } from "@/hooks/mutations/column/use-delete-column";
import { useUpdateColumn } from "@/hooks/mutations/column/use-update-column";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useGetColumns } from "@/hooks/queries/column/use-get-columns";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getColumnIcon } from "@/lib/column";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import { ArchiveTasksModal } from "../../shared/modals/archive-tasks-modal";

type ColumnHeaderProps = {
  column: ProjectWithTasks["columns"][number];
};

export function ColumnHeader({ column }: ColumnHeaderProps) {
  const { t } = useTranslation();
  const { project, setProject } = useProjectStore();
  const { mutate: updateTask } = useUpdateTask();
  const { canUpdateTasks, canCreateTasks, canManageProjects } =
    useWorkspacePermission();
  const canTask = canUpdateTasks();
  const canCreate = canCreateTasks();
  // Same gate as Add column, which sits beside this: the API asks for
  // project:update on every column write, so a member who cannot add one
  // cannot rename one either.
  const canManageColumns = canManageProjects();

  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);

  /*
   * Renaming needs the column's ROW id, and the board payload does not carry
   * one: get-tasks.ts sets `id: column.slug`, because the board groups cards by
   * status slug and that is what every card comparison uses. So the real id is
   * looked up by slug from /column/:projectId, which is already cached by the
   * time anyone right-clicks.
   */
  const { data: realColumns } = useGetColumns(project?.id ?? "");
  const columnId = realColumns?.find((c) => c.slug === column.slug)?.id;

  const { mutateAsync: updateColumn } = useUpdateColumn();
  const { mutateAsync: deleteColumn } = useDeleteColumn();

  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(column.name);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) renameInputRef.current?.select();
  }, [isRenaming]);

  const startRename = () => {
    setDraftName(column.name);
    setIsRenaming(true);
  };

  const commitRename = async () => {
    const name = draftName.trim();
    setIsRenaming(false);
    if (!columnId || !project?.id || !name || name === column.name) return;
    try {
      await updateColumn({ id: columnId, projectId: project.id, data: { name } });
      toast.success(t("settings:columnEditor.toastRenamed"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:columnEditor.toastRenameError"),
      );
    }
  };

  const toggleFinal = async () => {
    if (!columnId || !project?.id) return;
    const isFinal = !column.isFinal;
    try {
      await updateColumn({ id: columnId, projectId: project.id, data: { isFinal } });
      toast.success(
        isFinal
          ? t("settings:columnEditor.toastFinalOn")
          : t("settings:columnEditor.toastFinalOff"),
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:columnEditor.toastUpdateError"),
      );
    }
  };

  const removeColumn = async () => {
    if (!columnId || !project?.id) return;
    // Cards would be orphaned, not deleted — but a column with work in it is
    // never what someone means to remove from a right-click menu.
    if (column.tasks.length > 0) {
      toast.error(t("tasks:kanban.columnNotEmpty"));
      return;
    }
    try {
      await deleteColumn({ id: columnId, projectId: project.id });
      toast.success(t("settings:columnEditor.toastDeleted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:columnEditor.toastDeleteError"),
      );
    }
  };

  const handleConfirmArchive = () => {
    if (!column.isFinal || !project) return;

    const updatedProject = produce(project, (draft) => {
      const archivedColumn = draft?.columns?.find(
        (col) => col.id === column.id,
      );
      if (!archivedColumn) return;

      for (const task of archivedColumn.tasks) {
        updateTask({
          ...task,
          status: "archived",
        });
      }

      archivedColumn.tasks = [];
    });

    setProject(updatedProject);
    toast.success(t("tasks:archive.success", { count: column.tasks.length }));
    setIsArchiveModalOpen(false);
  };

  const header = (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-muted-foreground">
          {getColumnIcon(column.id, column.isFinal, column.icon)}
        </span>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setIsRenaming(false);
            }}
            className="min-w-0 flex-1 rounded-sm border border-ring/40 bg-background px-1 py-0.5 text-sm font-medium text-foreground/95 outline-none"
          />
        ) : (
          // Double-click renames too. The right-click menu is the discoverable
          // route; this is the one people try first.
          <span
            onDoubleClick={canManageColumns ? startRename : undefined}
            className={`truncate text-sm font-medium text-foreground/95 ${
              canManageColumns ? "cursor-text" : ""
            }`}
            title={canManageColumns ? t("tasks:kanban.renameColumnHint") : undefined}
          >
            {column.name}
          </span>
        )}
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
          {column.tasks.length}
        </span>
      </div>

      <div className="flex items-center">
        {canTask && column.isFinal && column.tasks.length > 0 && (
          <button
            type="button"
            onClick={() => setIsArchiveModalOpen(true)}
            className="flex items-center rounded-md px-2 py-1 text-left text-muted-foreground transition-colors hover:bg-accent/50"
            title={t("tasks:listView.archiveAllTooltip")}
          >
            <Archive className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
        {canCreate && (
          <button
            type="button"
            onClick={() => setIsTaskModalOpen(true)}
            className="flex items-center rounded-md px-2 py-1 text-left text-muted-foreground transition-colors hover:bg-accent/50"
            title={t("tasks:kanban.addTask")}
          >
            <Plus className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      <CreateTaskModal
        open={isTaskModalOpen}
        onClose={() => setIsTaskModalOpen(false)}
        projectId={project?.id}
        status={column.id}
      />

      <ArchiveTasksModal
        open={isArchiveModalOpen}
        onClose={() => setIsArchiveModalOpen(false)}
        onConfirm={handleConfirmArchive}
        taskCount={column.tasks.length}
      />
    </div>
  );

  /*
   * Rename, the done-column toggle and delete all lived in Settings →
   * Projects → Workflow, three navigations from the board you are looking at
   * when you decide a column is called the wrong thing. Same reasoning that
   * moved Add column out of settings: a control you have to go looking for is
   * a control people ask you to build again.
   *
   * Settings keeps its copy — reordering still belongs there, and so does
   * editing a board you are not currently on.
   */
  if (!canManageColumns) return header;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{header}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={startRename} disabled={!columnId}>
          <Pencil className="text-muted-foreground" />
          {t("tasks:kanban.renameColumn")}
        </ContextMenuItem>
        <ContextMenuItem onClick={toggleFinal} disabled={!columnId}>
          <CircleCheck className="text-muted-foreground" />
          {column.isFinal
            ? t("tasks:kanban.unsetDoneColumn")
            : t("tasks:kanban.setDoneColumn")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={removeColumn}
          disabled={!columnId}
        >
          <Trash2 />
          {t("tasks:kanban.deleteColumn")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
