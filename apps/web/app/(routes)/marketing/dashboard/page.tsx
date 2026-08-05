import { getActiveFollowups, getDashboardStats, getSenderDeliverabilityStats } from '@/lib/marketing/queries';
import { ActiveFollowups } from '@/components/marketing/active-followups';
import { EngagementStatCard } from '@/components/marketing/engagement-cards';
import { formatISTDateTime } from '@/lib/marketing/utils';
import {
  BarChart3,
  CheckCircle,
  Send,
  TrendingUp,
  Users,
  XCircle,
  MoreHorizontal,
  ArrowUpRight,
} from 'lucide-react';
import Link from 'next/link';
import { connection } from 'next/server';
import { Button } from '@/components/marketing/ui/button';

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  trend,
}: {
  label: string;
  value: number | string;
  icon: any;
  color: string;
  trend?: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/50 bg-card p-6 shadow-sm transition-all hover:shadow-md hover:border-border">
      <div className="absolute top-0 right-0 p-4 opacity-50 transition-opacity group-hover:opacity-100">
        <div className={`rounded-xl p-2.5 ${color} bg-opacity-10`}>
          <Icon size={20} className={color.replace('bg-', 'text-')} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className="flex items-baseline gap-2">
          <h3 className="text-3xl font-bold tracking-tight text-foreground">{value}</h3>
          {trend && (
            <span className="flex items-center text-xs font-medium text-green-600">
              +{trend}% <ArrowUpRight size={12} className="ml-0.5" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default async function DashboardPage() {
  // Opt into dynamic rendering — dashboard stats must always be fresh
  await connection();
  const stats = await getDashboardStats();
  const senderStats = await getSenderDeliverabilityStats();
  const activeFollowups = await getActiveFollowups();

  const abTotalSent = senderStats.reduce((n, p) => n + p.sent, 0);

  const serializedFollowups = activeFollowups.map((f) => ({
    ...f,
    createdAt: f.createdAt?.toISOString() ?? null,
    nextScheduledAt: f.nextScheduledAt?.toISOString() ?? null,
  }));

  const openRate = stats.sent > 0 ? ((stats.opened / stats.sent) * 100).toFixed(1) : '0';
  const clickRate = stats.opened > 0 ? ((stats.clicked / stats.opened) * 100).toFixed(1) : '0';
  const bounceRate = stats.sent > 0 ? ((stats.bounced / stats.sent) * 100).toFixed(1) : '0';

  return (
    <div className="flex h-full flex-col overflow-auto bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 flex h-[72px] shrink-0 items-center justify-between border-b border-border/40 bg-background/80 px-8 backdrop-blur-md">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-xs text-muted-foreground">Overview of your email campaigns</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/marketing/compose">
            <Button className="font-semibold shadow-blue-500/20">
              <Send size={16} className="mr-2" /> Compose Email
            </Button>
          </Link>
        </div>
      </div>

      <div className="p-8">
        {/* Helper Alert */}
        {stats.bounced > 0 && (
          <div className="mb-8 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 shadow-sm dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-300">
            <XCircle size={20} className="shrink-0 text-red-600 dark:text-red-400" />
            <div className="grow">
              <span className="font-semibold">Attention:</span> {stats.bounced} email{stats.bounced > 1 ? 's' : ''} have bounced. 
              Please review your contacts list to maintain a healthy sender reputation.
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="mb-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Emails Sent" value={stats.sent} icon={Send} color="text-blue-600" />
          <StatCard label="Delivered" value={stats.delivered} icon={CheckCircle} color="text-green-600" />
          <EngagementStatCard kind="opened" value={stats.opened} />
          <EngagementStatCard kind="clicked" value={stats.clicked} />
          <EngagementStatCard kind="unsubscribed" value={stats.unsubscribed} />
        </div>

        {/* A/B Provider Deliverability */}
        <div className="mb-8 rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-foreground">
                Deliverability by sender
              </h2>
              <p className="text-xs text-muted-foreground">
                Open / click / bounce broken out per sending domain
              </p>
            </div>
          </div>
          {abTotalSent === 0 ? (
            <p className="text-sm text-muted-foreground">
              No send data yet. Configure a sending domain (Mailu / nuraview.us SMTP
              env vars) and send emails — each domain is tracked separately here.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {senderStats.map((p) => (
                <div
                  key={p.accountId}
                  className="rounded-lg border border-border/50 p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">
                      {p.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{p.sent} sent</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-lg font-bold text-purple-600">{p.openRate.toFixed(1)}%</p>
                      <p className="text-[10px] uppercase text-muted-foreground">Open</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-orange-600">{p.clickRate.toFixed(1)}%</p>
                      <p className="text-[10px] uppercase text-muted-foreground">Click</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-red-600">{p.bounceRate.toFixed(1)}%</p>
                      <p className="text-[10px] uppercase text-muted-foreground">Bounce</p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {p.opened} opened · {p.clicked} clicked · {p.bounced} bounced
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Secondary Stats */}
        <div className="mb-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">Open Rate</p>
            <div className="mt-2 flex items-end justify-between">
              <p className="text-3xl font-bold tracking-tight text-purple-600 dark:text-purple-400">{openRate}%</p>
              <div className="mb-1 h-1.5 w-full max-w-[80px] rounded-full bg-purple-100 dark:bg-purple-900/30">
                <div className="h-full rounded-full bg-purple-500" style={{ width: `${Math.min(parseFloat(openRate), 100)}%` }} />
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
            <p className="text-sm font-medium text-muted-foreground">Click Rate</p>
            <div className="mt-2 flex items-end justify-between">
              <p className="text-3xl font-bold tracking-tight text-orange-600 dark:text-orange-400">{clickRate}%</p>
              <div className="mb-1 h-1.5 w-full max-w-[80px] rounded-full bg-orange-100 dark:bg-orange-900/30">
                <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(parseFloat(clickRate), 100)}%` }} />
              </div>
            </div>
          </div>
          <Link href="/marketing/contacts" className="group relative overflow-hidden rounded-xl border border-border/50 bg-card p-6 shadow-sm transition-all hover:border-primary/50 hover:shadow-md">
            <div className="absolute top-0 right-0 p-4 opacity-50 group-hover:opacity-100">
              <Users size={20} className="text-blue-500" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">Total Contacts</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">{stats.contacts}</p>
            <p className="mt-1 text-xs text-muted-foreground group-hover:text-primary">Manage contacts →</p>
          </Link>
          <Link href="/marketing/templates" className="group relative overflow-hidden rounded-xl border border-border/50 bg-card p-6 shadow-sm transition-all hover:border-primary/50 hover:shadow-md">
            <div className="absolute top-0 right-0 p-4 opacity-50 group-hover:opacity-100">
              <BarChart3 size={20} className="text-indigo-500" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">Templates</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">{stats.templates}</p>
            <p className="mt-1 text-xs text-muted-foreground group-hover:text-primary">Manage templates →</p>
          </Link>
        </div>

        {/* Active Follow-ups */}
        <ActiveFollowups sequences={serializedFollowups} />

        {/* Recent Emails */}
        <div className="rounded-xl border border-border/40 bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border/40 px-6 py-4">
            <h2 className="text-base font-semibold text-foreground">Recent Sent Emails</h2>
            <Link href="/marketing/f/sent" className="text-sm font-medium text-primary hover:text-primary/80">View all</Link>
          </div>
          
          {stats.recentEmails.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <div className="mb-4 rounded-full bg-muted p-4">
                <Send size={24} className="text-muted-foreground" />
              </div>
              <h3 className="text-sm font-medium text-foreground">No emails sent yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">Start your first campaign today.</p>
              <Link href="/marketing/compose" className="mt-4">
                <Button variant="outline" size="sm">Compose Email</Button>
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/30 text-left text-xs font-semibold text-muted-foreground">
                    <th className="px-6 py-3 font-medium">To</th>
                    <th className="px-6 py-3 font-medium">Subject</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-6 py-3 font-medium text-center">Opens</th>
                    <th className="px-6 py-3 font-medium text-center">Clicks</th>
                    <th className="px-6 py-3 font-medium text-right">Sent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {stats.recentEmails.map((email) => (
                    <tr key={email.id} className="group transition-colors hover:bg-muted/50">
                      <td className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{email.recipientName || 'Unknown'}</span>
                          <span className="text-xs text-muted-foreground">{email.recipientEmail}</span>
                        </div>
                      </td>
                      <td className="max-w-[300px] px-6 py-4">
                        <div className="truncate font-medium text-foreground">{email.subject}</div>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={email.status} />
                      </td>
                      <td className="px-6 py-4 text-center">
                        {(email.openedCount ?? 0) > 0 ? (
                           <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                             {email.openedCount}
                           </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {(email.clickedCount ?? 0) > 0 ? (
                           <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
                             {email.clickedCount}
                           </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                       <td className="px-6 py-4 text-right text-xs text-muted-foreground">
                         {formatISTDateTime(email.sentDate)}
                       </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const styles: Record<string, string> = {
    sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    delivered: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    opened: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    clicked: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    bounced: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    complained: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    draft: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    queued: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles[status || 'draft'] || 'bg-gray-100 text-gray-600'}`}>
      {status || 'draft'}
    </span>
  );
}
