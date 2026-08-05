'use client';

import { Ban, CheckCircle, Clock, Loader2, Timer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type ActiveSequence = {
  id: number;
  contactEmail: string;
  subject: string | null;
  createdAt: string | null;
  totalSteps: number;
  sentSteps: number;
  scheduledSteps: number;
  nextScheduledAt: string | null;
};

function formatRelativeTime(dateStr: string | null, now: number): string {
  if (!dateStr) return '';
  const diff = new Date(dateStr).getTime() - now;
  if (diff < 0) return 'overdue';
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

function SequenceRow({ seq }: { seq: ActiveSequence }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  // Relative time depends on the current clock, which differs between the SSR
  // render and the client. Keep it null until mount so server/client first
  // render match (no hydration mismatch), then tick it every 30s to stay fresh.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const handleCancel = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm(`Cancel all follow-ups for ${seq.contactEmail}? This cannot be undone.`)) {
      return;
    }
    
    setState('loading');
    try {
      const res = await fetch(`/api/marketing/sequences/${seq.id}/stop`, { method: 'POST' });
      if (res.ok) {
        setState('done');
        router.refresh();
      } else {
        setState('idle');
      }
    } catch {
      setState('idle');
    }
  };

  if (state === 'done') {
    return (
      <tr className="bg-green-50/50 dark:bg-green-900/5">
        <td colSpan={4} className="px-6 py-3 text-center text-xs font-medium text-green-700 dark:text-green-300">
          <span className="inline-flex items-center gap-1.5">
            <CheckCircle size={14} /> Follow-ups for {seq.contactEmail} cancelled
          </span>
        </td>
      </tr>
    );
  }

  return (
    <tr className="group transition-colors hover:bg-muted/50">
      <td className="px-6 py-4">
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{seq.contactEmail}</span>
          <span className="text-xs text-muted-foreground truncate max-w-[250px]">
            {seq.subject || '(No Subject)'}
          </span>
        </div>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {Array.from({ length: seq.totalSteps }).map((_, i) => (
              <div
                key={i}
                className={`h-2 w-2 rounded-full ${
                  i < seq.sentSteps
                    ? 'bg-green-500'
                    : 'bg-amber-400 animate-pulse'
                }`}
              />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {seq.sentSteps}/{seq.totalSteps} sent
          </span>
        </div>
      </td>
      <td className="px-6 py-4">
        {seq.nextScheduledAt && now !== null && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Timer size={12} />
            Next {formatRelativeTime(seq.nextScheduledAt, now)}
          </span>
        )}
      </td>
      <td className="px-6 py-4 text-right">
        <button
          onClick={handleCancel}
          disabled={state === 'loading'}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm transition-colors hover:bg-red-100 active:scale-95 disabled:opacity-60 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-300 dark:hover:bg-red-900/20"
        >
          {state === 'loading' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Ban size={12} />
          )}
          {state === 'loading' ? 'Cancelling...' : 'Cancel'}
        </button>
      </td>
    </tr>
  );
}

export function ActiveFollowups({ sequences }: { sequences: ActiveSequence[] }) {
  if (sequences.length === 0) return null;

  return (
    <div className="mb-8 rounded-xl border border-amber-200 bg-amber-50/30 shadow-sm dark:border-amber-900/30 dark:bg-amber-900/5">
      <div className="flex items-center justify-between border-b border-amber-200/50 px-6 py-4 dark:border-amber-900/20">
        <div className="flex items-center gap-2">
          <Clock size={18} className="text-amber-600 dark:text-amber-400" />
          <h2 className="text-base font-semibold text-foreground">Active Follow-ups</h2>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            {sequences.length}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-amber-200/30 text-left text-xs font-semibold text-muted-foreground dark:border-amber-900/10">
              <th className="px-6 py-3 font-medium">Recipient</th>
              <th className="px-6 py-3 font-medium">Progress</th>
              <th className="px-6 py-3 font-medium">Next Send</th>
              <th className="px-6 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-200/20 dark:divide-amber-900/10">
            {sequences.map((seq) => (
              <SequenceRow key={seq.id} seq={seq} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
