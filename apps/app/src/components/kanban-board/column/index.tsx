import { useState } from "react";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { ProjectWithTasks } from "@/types/project";
import { ColumnDropzone } from "./column-dropzone";
import { ColumnHeader } from "./column-header";

type ColumnProps = {
  column: ProjectWithTasks["columns"][number];
  disableDragDrop?: boolean;
};

function Column({ column, disableDragDrop = false }: ColumnProps) {
  const [isDropzoneOver, setIsDropzoneOver] = useState(false);
  const compact = useUserPreferencesStore((state) => state.compactMode);

  return (
    <div
      className={`group relative flex h-full min-h-0 w-full flex-col rounded-xl border transition-colors duration-150 ${
        isDropzoneOver
          ? "border-ring/40 bg-accent/60 shadow-md ring-2 ring-ring/30"
          : "border-border/70 bg-muted/40 shadow-xs/5 hover:border-border/90 dark:bg-card/90"
      }`}
    >
      <div
        className={`shrink-0 border-b border-border/60 ${
          compact ? "px-2 py-1" : "px-2.5 py-1.5"
        }`}
      >
        <ColumnHeader column={column} />
      </div>
      <div
        className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden [-webkit-overflow-scrolling:touch] ${
          compact ? "px-1.5 py-1" : "px-2 py-1.5"
        }`}
      >
        <ColumnDropzone
          column={column}
          disableDragDrop={disableDragDrop}
          onIsOverChange={setIsDropzoneOver}
        />
      </div>
    </div>
  );
}

export default Column;
