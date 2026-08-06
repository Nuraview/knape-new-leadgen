import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgenEmailExtras } from "@/fetchers/leadgen/emails";

/**
 * One sent email, exactly as it landed, with what happened to it.
 *
 * The Sent list answers "did it go?"; this answers "what did they get, and did
 * they read it?" — subject, the rendered HTML, opens, clicks and the bounce
 * reason when there is one.
 *
 * Opens and clicks come from the cockpit already filtered for scanner traffic
 * (Proofpoint, Mimecast, Safe Links auto-open every link). Large industrial firms are
 * heavily scanned, so an unfiltered "opened" number here would be flattering
 * and wrong.
 *
 * The body renders in a sandboxed iframe — see EmailPreview for why.
 */
export function SentEmailDialog({
  stepId,
  onClose,
}: {
  stepId: number;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["leadgen", "step", stepId],
    queryFn: () => leadgenEmailExtras.step(stepId),
  });

  const when = (v?: number | null) =>
    v ? new Date(v * 1000).toLocaleString() : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      role="presentation"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Sent email"
      >
        <header className="flex items-start gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <div className="truncate font-medium">
              {data?.subject ?? (isLoading ? "Loading…" : "Email")}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {data
                ? `${data.company ?? ""}${data.person_name ? ` · ${data.person_name}` : ""} · to ${data.to_email} · from ${data.from_email}`
                : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ms-auto rounded p-1 hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </header>

        {data ? (
          <div className="flex flex-wrap gap-3 border-b border-border px-4 py-2 text-xs">
            {data.angle ? (
              <span className="rounded bg-muted px-1.5 py-0.5">
                {data.angle}
              </span>
            ) : null}
            <span className="text-muted-foreground">
              sent {when(data.sent_at) ?? "—"}
            </span>
            <span
              className={
                data.open_count ? "text-emerald-500" : "text-muted-foreground"
              }
            >
              {data.open_count ?? 0} opens
              {when(data.first_open_at) ? ` · first ${when(data.first_open_at)}` : ""}
            </span>
            <span
              className={
                data.click_count ? "text-emerald-500" : "text-muted-foreground"
              }
            >
              {data.click_count ?? 0} clicks
            </span>
            {data.bounced ? (
              <span className="text-red-500" title={data.bounce_info ?? ""}>
                bounced{data.bounce_info ? ` — ${data.bounce_info}` : ""}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {isLoading ? (
            <Skeleton className="h-96" />
          ) : error ? (
            <p className="text-sm text-red-500">{String(error as Error)}</p>
          ) : data?.html ? (
            <iframe
              title="Sent email"
              sandbox=""
              srcDoc={data.html}
              className="h-[60vh] w-full rounded-md border border-border bg-white"
            />
          ) : (
            <pre className="whitespace-pre-wrap text-sm">{data?.body ?? ""}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default SentEmailDialog;
