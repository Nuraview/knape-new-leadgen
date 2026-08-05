'use client';

import {
  ArrowUpRight,
  Building2,
  Eye,
  Loader2,
  Mail,
  MousePointer,
  Phone,
  UserX,
} from 'lucide-react';
import { useState } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/marketing/ui/sheet';
import { formatISTDateTime } from '@/lib/marketing/utils';

type Kind = 'opened' | 'clicked' | 'unsubscribed';

type EngagementRow = {
  id: number;
  subject: string | null;
  body: string | null;
  bodyHtml: string | null;
  sentDate: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  unsubscribedAt: string | null;
  openedCount: number | null;
  clickedCount: number | null;
  recipientEmail: string;
  recipientName: string | null;
  company: string | null;
  phone: string | null;
};

const CONFIG: Record<
  Kind,
  { label: string; icon: typeof Eye; color: string; verb: string }
> = {
  opened: { label: 'Opened', icon: Eye, color: 'text-purple-600', verb: 'opened' },
  clicked: {
    label: 'Clicked',
    icon: MousePointer,
    color: 'text-orange-600',
    verb: 'clicked',
  },
  unsubscribed: {
    label: 'Unsubscribed',
    icon: UserX,
    color: 'text-red-600',
    verb: 'unsubscribed',
  },
};

function EngagementRowCard({ row, kind }: { row: EngagementRow; kind: Kind }) {
  const [showPreview, setShowPreview] = useState(false);
  const when =
    kind === 'opened'
      ? row.openedAt
      : kind === 'clicked'
        ? row.clickedAt
        : row.unsubscribedAt;

  // The email markup can live in either column; whichever has content, render it
  // as HTML when it looks like HTML, otherwise as plain text with line breaks.
  const content = row.bodyHtml || row.body || '';
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(content);

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-foreground">
            {row.recipientName || row.recipientEmail}
          </p>
          {row.company && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 size={12} /> {row.company}
            </p>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatISTDateTime(when)}
        </span>
      </div>

      <div className="mt-3 space-y-1.5 text-sm">
        <a
          href={`mailto:${row.recipientEmail}`}
          className="flex items-center gap-2 text-blue-600 hover:underline"
        >
          <Mail size={14} className="shrink-0" /> {row.recipientEmail}
        </a>
        {row.phone ? (
          <a
            href={`tel:${row.phone}`}
            className="flex items-center gap-2 text-foreground hover:underline"
          >
            <Phone size={14} className="shrink-0 text-muted-foreground" /> {row.phone}
          </a>
        ) : (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Phone size={14} className="shrink-0" /> No phone on file
          </p>
        )}
      </div>

      {kind !== 'unsubscribed' && (
        <div className="mt-3 rounded-md bg-muted/40 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Subject
          </p>
          <p className="truncate text-sm font-medium text-foreground">
            {row.subject || '(No subject)'}
          </p>
        </div>
      )}

      {kind !== 'unsubscribed' && (
        <button
          onClick={() => setShowPreview((v) => !v)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Eye size={13} /> {showPreview ? 'Hide email preview' : 'Preview email'}
        </button>
      )}

      {kind !== 'unsubscribed' && showPreview && (
        <div className="mt-3 max-h-96 overflow-auto rounded-lg border border-border bg-white p-4 text-sm leading-relaxed text-gray-800 [&_a]:break-words [&_a]:text-blue-600 [&_a]:underline [&_p]:mb-3 [&_p:last-child]:mb-0">
          {content ? (
            looksLikeHtml ? (
              // Our own outbound email content — safe to render as HTML.
              <div dangerouslySetInnerHTML={{ __html: content }} />
            ) : (
              <div className="whitespace-pre-wrap">{content}</div>
            )
          ) : (
            <p className="text-muted-foreground">(Empty email)</p>
          )}
        </div>
      )}
    </div>
  );
}

export function EngagementStatCard({ kind, value }: { kind: Kind; value: number }) {
  const { label, icon: Icon, color, verb } = CONFIG[kind];
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<EngagementRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const handleOpen = async (next: boolean) => {
    setOpen(next);
    if (next && rows === null && !loading) {
      setLoading(true);
      try {
        const res = await fetch(`/api/marketing/engagement?kind=${kind}`);
        setRows(res.ok ? await res.json() : []);
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpen(true)}
        className="group relative w-full overflow-hidden rounded-xl border border-border/50 bg-card p-6 text-left shadow-sm transition-all hover:border-border hover:shadow-md"
      >
        <div className="absolute top-0 right-0 p-4 opacity-50 transition-opacity group-hover:opacity-100">
          <div className={`rounded-xl p-2.5 ${color} bg-opacity-10`}>
            <Icon size={20} className={color.replace('bg-', 'text-')} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <h3 className="text-3xl font-bold tracking-tight text-foreground">{value}</h3>
          <span className="mt-1 inline-flex items-center text-xs font-medium text-muted-foreground transition-colors group-hover:text-primary">
            View who {verb} <ArrowUpRight size={12} className="ml-0.5" />
          </span>
        </div>
      </button>

      <Sheet open={open} onOpenChange={handleOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-none sm:w-[70vw]">
          <SheetHeader className="p-0">
            <SheetTitle className="flex items-center gap-2">
              <Icon size={18} className={color} /> {label} — {value}
            </SheetTitle>
            <SheetDescription>
              {kind === 'unsubscribed'
                ? 'People who unsubscribed, with their company and phone. Their follow-ups have been stopped automatically.'
                : `People who ${verb} an email, with their company and phone. Click “Preview email” to see exactly what was sent.`}
            </SheetDescription>
          </SheetHeader>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : !rows || rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {kind === 'unsubscribed'
                ? 'No one has unsubscribed yet.'
                : `No one has ${verb} an email yet.`}
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((row) => (
                <EngagementRowCard key={row.id} row={row} kind={kind} />
              ))}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
