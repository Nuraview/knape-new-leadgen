'use client';

import { Ban, CheckCircle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface CancelFollowupsProps {
  sequenceId: number;
  scheduledCount: number;
}

export function CancelFollowups({ sequenceId, scheduledCount }: CancelFollowupsProps) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');

  if (scheduledCount === 0) return null;

  const handleCancel = async () => {
    if (!confirm(`Cancel ${scheduledCount} follow-up${scheduledCount > 1 ? 's' : ''}? This cannot be undone.`)) {
      return;
    }
    
    setState('loading');
    try {
      const res = await fetch(`/api/marketing/sequences/${sequenceId}/stop`, { method: 'POST' });
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
      <div className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 dark:border-green-900/30 dark:bg-green-900/10 dark:text-green-300">
        <CheckCircle size={14} /> Follow-ups cancelled
      </div>
    );
  }

  return (
    <button
      onClick={handleCancel}
      disabled={state === 'loading'}
      className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 shadow-sm transition-colors hover:bg-amber-100 active:scale-95 disabled:opacity-60 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-300 dark:hover:bg-amber-900/20"
    >
      {state === 'loading' ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <Ban size={14} />
      )}
      {state === 'loading' ? 'Cancelling...' : `Cancel ${scheduledCount} follow-up${scheduledCount > 1 ? 's' : ''}`}
    </button>
  );
}
