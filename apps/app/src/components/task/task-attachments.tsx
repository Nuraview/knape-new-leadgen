/**
 * Attachments panel on a task.
 *
 * Trello shows files as their own section — file-type badge, name, when it was
 * added, and a way to open it. The Trello import originally appended them to
 * the description as markdown, which is a large part of why an imported card
 * read as one undifferentiated wall of text next to the original.
 *
 * Files we mirrored into MinIO get a direct link; anything we could not mirror
 * still shows with its original source link, so provenance is never lost — a
 * missing file should look missing, not disappear.
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Paperclip } from "lucide-react";
import { getApiUrl } from "@/fetchers/get-api-url";

type Attachment = {
  id: string;
  name: string;
  storageKey: string | null;
  sourceUrl: string | null;
  contentType: string | null;
  bytes: number | null;
  createdAt: string;
};

/** Short type badge from the extension — PDF, AI, PNG… */
function kindOf(name: string, contentType: string | null): string {
  const ext = name.split(".").pop()?.toUpperCase();
  if (ext && ext.length <= 4 && /^[A-Z0-9]+$/.test(ext)) return ext;
  if (contentType?.startsWith("image/")) return "IMG";
  return "FILE";
}

function sizeOf(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function TaskAttachments({ taskId }: { taskId: string }) {
  const { data } = useQuery({
    queryKey: ["task", taskId, "attachments"],
    queryFn: async (): Promise<{ items: Attachment[] }> => {
      const r = await fetch(getApiUrl(`task/${taskId}/attachments`), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load attachments");
      return r.json();
    },
  });

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="mb-2.5 flex items-center gap-2">
        <Paperclip className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Attachments</h3>
        <span className="text-xs text-muted-foreground">({items.length})</span>
      </div>

      <ul className="space-y-1.5">
        {items.map((a) => {
          const href = a.storageKey ?? a.sourceUrl ?? undefined;
          const mirrored = Boolean(a.storageKey);

          return (
            <li key={a.id}>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-lg border border-border p-2.5 transition-colors hover:bg-accent/40"
              >
                <span className="grid h-10 w-12 shrink-0 place-items-center rounded bg-muted text-[10px] font-bold tracking-wide text-muted-foreground">
                  {kindOf(a.name, a.contentType)}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {a.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {[sizeOf(a.bytes), `Added ${when(a.createdAt)}`]
                      .filter(Boolean)
                      .join(" · ")}
                    {mirrored ? "" : " · on Trello"}
                  </span>
                </span>

                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default TaskAttachments;
