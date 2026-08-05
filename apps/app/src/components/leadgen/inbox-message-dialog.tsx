/**
 * Open a message from the mailbox and read it.
 *
 * The inbox listed forty rows and none of them did anything when clicked. The
 * endpoint to fetch a single message has existed the whole time — the list just
 * never called it — so the only way to read the reply that Robin Huston sent
 * was to leave the CRM and open Zoho.
 *
 * The body renders in a sandboxed iframe with no allow-* flags. This is
 * untrusted mail arriving from strangers: it can carry tracking pixels, remote
 * images and scripts, and dropping it into the page would let a school's mail
 * server run code in a session that has the whole CRM behind it. `sandbox=""`
 * blocks scripts, forms, popups and same-origin access outright.
 */
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";

type FullMessage = {
  id?: string | number;
  from_name?: string;
  from_email?: string;
  to?: string;
  subject?: string;
  date?: string;
  body?: string;
  html?: string;
  text?: string;
};

export function InboxMessageDialog({
  messageId,
  agentNote,
  onClose,
}: {
  messageId: string;
  agentNote?: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["leadgen", "inbox-message", messageId],
    queryFn: () =>
      leadgen.get<FullMessage>(`/api/emails/inbox/${encodeURIComponent(messageId)}`),
  });

  const body = data?.html || data?.body || data?.text || "";
  // Plain-text mail must not be dumped into an iframe as HTML — the angle
  // brackets in a signature block would be eaten as markup.
  const isHtml = /<\w+[\s>]/.test(body);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      role="presentation"
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-card"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Message"
      >
        <header className="flex items-start gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <div className="truncate font-medium">
              {data?.subject ?? (isLoading ? "Loading…" : "Message")}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {data?.from_name || data?.from_email || ""}
              {data?.from_email && data?.from_name ? ` · ${data.from_email}` : ""}
              {data?.date ? ` · ${new Date(data.date).toLocaleString()}` : ""}
            </div>
          </div>
          {data?.from_email ? (
            <a
              href={`mailto:${data.from_email}?subject=${encodeURIComponent(
                `Re: ${data.subject ?? ""}`,
              )}`}
              className="ms-auto flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted"
            >
              Reply <ExternalLink className="size-3" />
            </a>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`shrink-0 rounded p-1 hover:bg-muted ${data?.from_email ? "" : "ms-auto"}`}
          >
            <X className="size-4" />
          </button>
        </header>

        {/* What the agent already did about this message, if anything. */}
        {agentNote ? (
          <div className="border-b border-border bg-emerald-500/10 px-4 py-2 text-xs text-emerald-500">
            Handled automatically: {agentNote}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {isLoading ? (
            <Skeleton className="h-96" />
          ) : error ? (
            <p className="text-sm text-red-500">{(error as Error).message}</p>
          ) : isHtml ? (
            <iframe
              title="Message"
              sandbox=""
              srcDoc={body}
              className="h-[60vh] w-full rounded-md border border-border bg-white"
            />
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
              {body || "(no content)"}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default InboxMessageDialog;
