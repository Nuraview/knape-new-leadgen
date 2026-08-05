'use client';

import { ThreadActions } from '@/components/marketing/thread-actions';
import { mktEmails as emails, mktUsers as users } from '@/lib/db';
import { formatEmailString, formatISTDate } from '@/lib/marketing/utils';
import {
  CheckCircle,
  Clock,
  Eye,
  MousePointerClick,
  PenSquare,
  Search,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Email = Omit<typeof emails.$inferSelect, 'threadId'> & {
  sender: Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>;
};
type User = typeof users.$inferSelect;

type ThreadWithEmails = {
  id: number;
  subject: string | null;
  lastActivityDate: Date | null;
  emails: Email[];
};

interface ThreadListProps {
  folderName: string;
  threads: ThreadWithEmails[];
  searchQuery?: string;
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;

  const configs: Record<
    string,
    { icon: React.ReactNode; label: string; color: string }
  > = {
    sent: {
      icon: <Clock size={12} />,
      label: 'Sent',
      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    },
    delivered: {
      icon: <CheckCircle size={12} />,
      label: 'Delivered',
      color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    },
    opened: {
      icon: <Eye size={12} />,
      label: 'Opened',
      color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    },
    clicked: {
      icon: <MousePointerClick size={12} />,
      label: 'Clicked',
      color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    },
    bounced: {
      icon: <XCircle size={12} />,
      label: 'Bounced',
      color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    },
    failed: {
      icon: <XCircle size={12} />,
      label: 'Failed',
      color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    },
    complained: {
      icon: <XCircle size={12} />,
      label: 'Complained',
      color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    },
    draft: {
      icon: <Clock size={12} />,
      label: 'Draft',
      color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    },
    queued: {
      icon: <Clock size={12} />,
      label: 'Queued',
      color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
    },
  };

  const config = configs[status];
  if (!config) return null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${config.color}`}
    >
      {config.icon}
      {config.label}
    </span>
  );
}

export function ThreadHeader({
  folderName,
  count,
}: {
  folderName: string;
  count?: number | undefined;
}) {
  return (
    <div className="flex h-[72px] items-center justify-between border-b border-border/40 bg-background/80 px-6 backdrop-blur-md sticky top-0 z-20">
      <h1 className="flex items-center text-xl font-bold capitalize tracking-tight text-foreground">
        {folderName}
        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{count}</span>
      </h1>
      <div className="flex items-center space-x-1">
        <Link
          href="/marketing/compose"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-primary/10 hover:text-primary active:scale-95"
          title="Compose"
        >
          <PenSquare size={18} />
        </Link>
        <Link
          href="/marketing/search"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-95"
          title="Search"
        >
          <Search size={18} />
        </Link>
      </div>
    </div>
  );
}

export function ThreadList({ folderName, threads }: ThreadListProps) {
  const [hoveredThread, setHoveredThread] = useState<number | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(window.matchMedia('(hover: none)').matches);
    };

    checkIsMobile();
    window.addEventListener('resize', checkIsMobile);

    return () => {
      window.removeEventListener('resize', checkIsMobile);
    };
  }, []);

  const handleMouseEnter = (threadId: number) => {
    if (!isMobile) {
      setHoveredThread(threadId);
    }
  };

  const handleMouseLeave = () => {
    if (!isMobile) {
      setHoveredThread(null);
    }
  };

  return (
    <div className="grow overflow-hidden border-r border-border bg-background">
      <ThreadHeader folderName={folderName} count={threads.length} />
      <div className="h-[calc(100vh-72px)] overflow-auto">
        {threads.map((thread) => {
          const latestEmail = thread.emails[0];

          return (
            <Link
              key={thread.id}
              href={`/marketing/f/${folderName.toLowerCase()}/${thread.id}`}
              className="block cursor-pointer border-b border-border/40 bg-card transition-colors hover:bg-muted/40"
            >
              <div
                className="flex items-center py-4"
                onMouseEnter={() => handleMouseEnter(thread.id)}
                onMouseLeave={handleMouseLeave}
              >
                <div className="flex grow items-center overflow-hidden pl-6 pr-4">
                  <div className="mr-4 w-[200px] shrink-0">
                    <span className="block truncate text-sm font-semibold text-foreground">
                      {formatEmailString(latestEmail.sender)}
                    </span>
                  </div>
                  <div className="flex grow items-center overflow-hidden gap-3">
                    <span className="max-w-[300px] min-w-[150px] truncate text-sm font-medium text-foreground">
                      {thread.subject || <span className="italic text-muted-foreground">(No Subject)</span>}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">
                      - {(latestEmail.body?.replace(/<[^>]*>?/gm, '') || '').substring(0, 100)}
                    </span>
                  </div>
                </div>
                <div className="flex w-48 shrink-0 items-center justify-end gap-3 px-6">
                  {latestEmail.status && (
                    <StatusBadge status={latestEmail.status} />
                  )}
                   {!isMobile && hoveredThread === thread.id ? (
                     <ThreadActions threadId={thread.id} />
                   ) : (
                     <span className="text-xs font-medium text-muted-foreground">
                       {formatISTDate(thread.lastActivityDate)}
                     </span>
                   )}
                </div>
              </div>
            </Link>
          );
        })}
        {threads.length === 0 && (
            <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                <p className="text-sm">No emails in {folderName}</p>
            </div>
        )}
      </div>
    </div>
  );
}
