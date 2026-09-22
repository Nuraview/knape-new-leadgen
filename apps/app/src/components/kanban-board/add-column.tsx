/**
 * Add a column without leaving the board.
 *
 * The column editor already existed, but at Settings → Projects → <project> →
 * Workflow: three navigations away from the board you are staring at when you
 * decide you want another column. Same failure as the project access control
 * before it moved into the header — a control you have to go looking for is a
 * control people ask you to build again.
 *
 * Two mounts, because one was not enough:
 *
 *   - `AddColumnButton` sits in the board toolbar, always on screen.
 *   - `AddColumn` sits at the end of the column strip, where Trello puts it.
 *
 * The strip tile shipped alone first and was invisible in practice: four
 * columns already fill a 1080p board, so the tile lived past the right edge
 * behind a horizontal scroll nobody performs. Discoverability was the entire
 * point of moving this out of settings, so the toolbar button is the real
 * entry point and the tile is the convenience one.
 *
 * Rename, reorder, delete and the done-column toggle stay in settings; this is
 * only the one move people make from the board.
 *
 * Gated on `canManageProjects` to mirror the API's `project:update` check, so a
 * member who would get a 403 never sees the control instead of finding out by
 * typing a name and having it rejected.
 */
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import columnIcons from "@/constants/column-icons";
import { useCreateColumn } from "@/hooks/mutations/column/use-create-column";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { getColumnIcon } from "@/lib/column";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type ColumnComposerProps = {
  projectId: string;
  onCancel: () => void;
};

/**
 * Name + icon + create. The icon grid is inline rather than behind its own
 * popover: the toolbar mount is already inside a popover, and base-ui nests
 * them badly enough that a picker-inside-a-picker closes both on select.
 */
function ColumnComposer({ projectId, onCancel }: ColumnComposerProps) {
  const { t } = useTranslation();
  const { mutateAsync: createColumn, isPending } = useCreateColumn();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("Circle");
  const [iconSearch, setIconSearch] = useState("");

  const filteredIcons = Object.entries(columnIcons).filter(([iconName]) =>
    iconName.toLowerCase().includes(iconSearch.trim().toLowerCase()),
  );

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || isPending) return;

    try {
      await createColumn({ projectId, data: { name: trimmed, icon } });
      // Stays open: adding one column is usually adding two.
      setName("");
      setIcon("Circle");
      toast.success(t("settings:columnEditor.toastCreated"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("settings:columnEditor.toastCreateError"),
      );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
          {getColumnIcon("", false, icon)}
        </span>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("settings:columnEditor.newColumnPlaceholder")}
          className="h-8 flex-1 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleCreate();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        />
      </div>

      <Input
        value={iconSearch}
        onChange={(e) => setIconSearch(e.target.value)}
        placeholder={t("settings:columnEditor.searchIconsPlaceholder")}
        className="h-7 text-xs"
      />
      <div className="max-h-40 overflow-y-auto pr-1">
        <div className="grid grid-cols-6 gap-1">
          {filteredIcons.map(([iconName, Icon]) => (
            <button
              key={iconName}
              type="button"
              onClick={() => setIcon(iconName)}
              title={iconName}
              className={cn(
                "flex h-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                icon === iconName &&
                  "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-8 gap-1"
          onClick={handleCreate}
          disabled={!name.trim() || isPending}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("settings:columnEditor.add")}
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={onCancel}>
          {t("common:actions.cancel")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Toolbar entry point. Always visible, no scrolling required.
 */
export function AddColumnButton({ projectId }: { projectId?: string }) {
  const { t } = useTranslation();
  const { canManageProjects, isCheckingPermissions } = useWorkspacePermission();
  const [isOpen, setIsOpen] = useState(false);

  if (!projectId || isCheckingPermissions || !canManageProjects()) return null;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen} modal={true}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 font-medium text-foreground text-xs outline-none ring-0 hover:bg-accent/60"
        >
          <Plus className="h-3 w-3" />
          {t("tasks:kanban.addColumn")}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <ColumnComposer
          projectId={projectId}
          onCancel={() => setIsOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * End-of-strip tile, for people who look for it where Trello keeps it.
 */
export function AddColumn({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { canManageProjects, isCheckingPermissions } = useWorkspacePermission();
  const [isComposing, setIsComposing] = useState(false);

  if (isCheckingPermissions || !canManageProjects()) return null;

  return (
    <div className="h-full w-72 shrink-0">
      {isComposing ? (
        <div className="rounded-xl border border-border/70 bg-muted/40 p-2 shadow-xs/5 dark:bg-card/90">
          <ColumnComposer
            projectId={projectId}
            onCancel={() => setIsComposing(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsComposing(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-3 text-muted-foreground text-sm transition-colors hover:border-border hover:bg-muted/40 hover:text-foreground dark:bg-card/40"
        >
          <Plus className="h-4 w-4" />
          {t("tasks:kanban.addColumn")}
        </button>
      )}
    </div>
  );
}

export default AddColumn;
