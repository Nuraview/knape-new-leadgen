/**
 * What actually went out to this lead.
 *
 * Ported from the SentEmailSection in crmx1's LeadDrawer. It reads the
 * sent_email_* snapshot the send route writes onto the lead row: the marketing
 * tables carry no CC and no lead link, and the generated_email_* draft is
 * cleared on send, so this is the only per-lead record of the message.
 *
 * Renders nothing until something has been sent.
 */
import { useState } from "react";

function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function SentEmailSection({
  subject,
  body,
  to,
  cc,
}: {
  subject: string | null;
  body: string | null;
  to: string | null;
  cc: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!subject && !body && !to) return null;
  const text = body ? htmlToText(body) : "";
  return (
    <div className="mt-6 border-t border-border pt-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Sent Email
      </div>
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
        {subject ? (
          <div className="flex items-start gap-2 font-medium">
            <span className="shrink-0">✉</span>
            <span className="min-w-0 break-words">{subject}</span>
          </div>
        ) : null}
        {to ? (
          <div className="mt-2 break-all text-xs text-muted-foreground">
            <span className="text-foreground/70">To:</span> {to}
          </div>
        ) : null}
        {cc ? (
          <div className="break-all text-xs text-muted-foreground">
            <span className="text-foreground/70">CC:</span> {cc}
          </div>
        ) : null}
        {text ? (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="mt-2 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-400"
            >
              {open ? "▾ Hide message" : "▸ Show message"}
            </button>
            {open ? (
              <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words border-t border-emerald-500/20 pt-2 text-muted-foreground">
                {text}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

export default SentEmailSection;
