import { useTranslation } from "react-i18next";
import CommentEditor from "@/components/activity/comment-editor";

type TaskDescriptionEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  taskId?: string;
  ensureTaskId?: () => Promise<string | null>;
};

export default function TaskDescriptionEditor({
  value,
  onChange,
  placeholder,
  taskId,
  ensureTaskId,
}: TaskDescriptionEditorProps) {
  const { t } = useTranslation();

  return (
    <CommentEditor
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? t("tasks:detail.addDescription")}
      taskId={taskId}
      ensureTaskId={ensureTaskId}
      uploadSurface="description"
      className="[&_.nuraview-comment-editor-content_.ProseMirror]:min-h-[11rem] [&_.nuraview-comment-editor-content_.ProseMirror]:max-h-none [&_.nuraview-comment-editor-content_.ProseMirror]:overflow-visible [&_.nuraview-comment-editor-content_.ProseMirror]:px-0 [&_.nuraview-comment-editor-content_.ProseMirror]:pt-1 [&_.nuraview-comment-editor-content_.ProseMirror]:pb-2"
    />
  );
}
