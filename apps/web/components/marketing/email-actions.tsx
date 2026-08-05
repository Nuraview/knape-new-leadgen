'use client';

import { formatISTDate } from '@/lib/marketing/utils';
import { Reply, Forward } from 'lucide-react';
import Link from 'next/link';

interface EmailActionsProps {
  threadId: number;
  subject: string;
  lastSenderName: string;
  body: string;
  isInbox: boolean;
}

export function EmailActions({
  threadId,
  subject,
  lastSenderName,
  body,
  isInbox,
}: EmailActionsProps) {
  const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;
  const forwardSubject = subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`;

  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/marketing/compose?subject=${encodeURIComponent(replySubject)}&body=${encodeURIComponent(`\n\n--- On ${formatISTDate(new Date())}, ${lastSenderName} wrote:\n${body}`)}`}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted hover:text-primary active:scale-95"
      >
        <Reply size={14} /> Reply
      </Link>
      <Link
        href={`/marketing/compose?subject=${encodeURIComponent(forwardSubject)}&body=${encodeURIComponent(`\n\n--- Forwarded message ---\n${body}`)}`}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted hover:text-primary active:scale-95"
      >
        <Forward size={14} /> Forward
      </Link>
    </div>
  );
}
