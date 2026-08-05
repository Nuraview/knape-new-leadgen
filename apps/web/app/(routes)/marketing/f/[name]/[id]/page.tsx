import { RightSidebar } from '@/components/marketing/right-sidebar';
import { ThreadActions } from '@/components/marketing/thread-actions';
import { EmailActions } from '@/components/marketing/email-actions';
import { CancelFollowups } from '@/components/marketing/cancel-followups';
import { getEmailsForThread, getActiveSequenceForThread } from '@/lib/marketing/queries';
import { formatISTDateTime, formatISTFull } from '@/lib/marketing/utils';
import {
  CheckCircle,
  Clock,
  Eye,
  MousePointerClick,
  XCircle,
  User,
  ArrowLeft
} from 'lucide-react';
import { notFound } from 'next/navigation';
import Link from 'next/link';

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

function EngagementPanel({
  email,
}: {
  email: {
    resendId: string | null;
    status: string | null;
    openedCount: number | null;
    clickedCount: number | null;
    openedAt: Date | null;
    clickedAt: Date | null;
    deliveredAt: Date | null;
    bouncedAt: Date | null;
  };
}) {
  if (!email.resendId) return null;

  return (
    <div className="mt-4 rounded-lg border border-border/50 bg-card p-4 shadow-sm">
      <h4 className="mb-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Engagement Tracking
      </h4>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="text-center">
          <div className="text-lg font-bold text-green-600 dark:text-green-400">
            {email.deliveredAt ? '✓' : '—'}
          </div>
          <div className="text-xs font-medium text-muted-foreground">Delivered</div>
          {email.deliveredAt && (
            <div className="mt-0.5 text-[10px] text-muted-foreground/60">
              {formatISTFull(email.deliveredAt)}
            </div>
          )}
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-purple-600 dark:text-purple-400">
            {email.openedCount || 0}
          </div>
          <div className="text-xs font-medium text-muted-foreground">Opens</div>
          {email.openedAt && (
            <div className="mt-0.5 text-[10px] text-muted-foreground/60">
              First: {formatISTFull(email.openedAt)}
            </div>
          )}
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-orange-600 dark:text-orange-400">
            {email.clickedCount || 0}
          </div>
          <div className="text-xs font-medium text-muted-foreground">Clicks</div>
          {email.clickedAt && (
            <div className="mt-0.5 text-[10px] text-muted-foreground/60">
              First: {formatISTFull(email.clickedAt)}
            </div>
          )}
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-red-600 dark:text-red-400">
            {email.bouncedAt ? '✗' : '—'}
          </div>
          <div className="text-xs font-medium text-muted-foreground">Bounced</div>
          {email.bouncedAt && (
            <div className="mt-0.5 text-[10px] text-muted-foreground/60">
              {formatISTFull(email.bouncedAt)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function EmailPage({
  params,
}: {
  params: Promise<{ name: string; id: string }>;
}) {
  let { name, id } = await params;
  let thread = await getEmailsForThread(id);

  if (!thread || thread.emails.length === 0) {
    notFound();
  }
  
  const contactId = thread.emails[0].sender.id;

  const resendIds = thread.emails
    .map((e) => e.resendId)
    .filter((id): id is string => id !== null);
  const activeSequence = resendIds.length > 0
    ? await getActiveSequenceForThread(resendIds)
    : null;

  return (
    <div className="flex h-full bg-background">
      <div className="grow overflow-auto">
        <div className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-border/40 bg-background/80 px-4 backdrop-blur-md sm:px-8">
            <div className="flex items-center gap-4">
                <Link href={`/marketing/f/${name}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-95">
                    <ArrowLeft size={20} />
                </Link>
                <h1 className="truncate text-lg font-bold tracking-tight text-foreground max-w-[200px] sm:max-w-md md:max-w-lg">
                {thread.subject || <span className="italic text-muted-foreground">(No Subject)</span>}
                </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {activeSequence && (
                <CancelFollowups
                  sequenceId={activeSequence.id}
                  scheduledCount={activeSequence.scheduledCount}
                />
              )}
              <EmailActions
                threadId={thread.id}
                subject={thread.subject || ''}
                lastSenderName={`${thread.emails[0].sender.firstName || ''} ${thread.emails[0].sender.lastName || ''}`}
                body={thread.emails[thread.emails.length - 1].body || ''}
                isInbox={false}
              />
              <ThreadActions threadId={thread.id} />
            </div>
        </div>
        
        <div className="mx-auto max-w-4xl p-4 sm:p-8">
          <div className="space-y-6">
            {thread.emails.map((email) => (
              <div key={email.id} className="relative rounded-xl border border-border/40 bg-card p-6 shadow-sm transition-all hover:border-primary/20 hover:shadow-md">
                <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <User size={20} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">
                            {email.sender.firstName} {email.sender.lastName}
                            </span>
                            {email.status && <StatusBadge status={email.status} />}
                        </div>
                        <div className="text-xs text-muted-foreground">
                            to <span className="font-medium text-foreground">{email.recipientId === thread.emails[0].sender.id ? 'Me' : 'All'}</span>
                        </div>
                    </div>
                  </div>
                  <div className="text-xs font-medium text-muted-foreground bg-muted/30 px-2 py-1 rounded-md self-start">
                    {formatISTFull(email.sentDate!)}
                  </div>
                </div>
                
                <div className="prose prose-sm prose-slate dark:prose-invert max-w-none text-foreground/90 pl-[52px]">
                   <div 
                      className="leading-relaxed" 
                      dangerouslySetInnerHTML={{ __html: email.body || '' }} 
                   />
                </div>
                
                <div className="pl-[52px]">
                    <EngagementPanel email={email} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <RightSidebar userId={contactId} />
    </div>
  );
}
