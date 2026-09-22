import { Badge } from "@/components/ui/badge";
import useGetLabelsByTask from "@/hooks/queries/label/use-get-labels-by-task";
import { resolveLabelColor } from "@/lib/label-color";

/**
 * Labels on a card front.
 *
 * `dense` drops the words and keeps the colours: on a compact board the names
 * are the widest thing on the card, and three of them push everything else onto
 * another line. The full name stays in the tooltip.
 */
function TaskCardLabels({
  taskId,
  dense = false,
}: {
  taskId: string;
  dense?: boolean;
}) {
  const { data: labels = [] } = useGetLabelsByTask(taskId);

  if (!labels.length) return null;

  if (dense) {
    return (
      <span className="inline-flex items-center gap-1">
        {labels.map((label: { id: string; name: string; color: string }) => (
          <span
            key={label.id}
            title={label.name}
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: resolveLabelColor(label.color) }}
          />
        ))}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {labels.map((label: { id: string; name: string; color: string }) => (
        <Badge
          key={label.id}
          variant="outline"
          className="flex items-center px-1.5 py-0 text-[10px]"
          title={label.name}
        >
          <span
            className="mr-1 inline-block h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: resolveLabelColor(label.color),
            }}
          />
          <span className="max-w-20 truncate">{label.name}</span>
        </Badge>
      ))}
    </span>
  );
}

export default TaskCardLabels;
