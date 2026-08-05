import { getUserProfile } from '@/lib/marketing/queries';
import Image from 'next/image';
import { Mail, MapPin, Building2, User } from 'lucide-react';

export async function RightSidebar({ userId }: { userId: number }) {
  let user = await getUserProfile(userId);

  if (!user) {
    return null;
  }

  return (
    <div className="hidden w-[350px] shrink-0 overflow-auto border-l border-border bg-card/50 p-6 sm:flex backdrop-blur-sm">
      <div className="w-full">
        <div className="flex items-center gap-4 mb-6">
            <div className="relative h-14 w-14 overflow-hidden rounded-full ring-2 ring-border">
                <img
                    src={user.avatarUrl || '/placeholder.svg?height=56&width=56'}
                    alt={`${user.firstName} ${user.lastName}`}
                    className="h-full w-full object-cover"
                />
            </div>
            <div>
                 <h2 className="text-lg font-bold text-foreground leading-tight">{`${user.firstName} ${user.lastName}`}</h2>
                 <p className="text-sm text-muted-foreground">{user.jobTitle || 'No Title'}</p>
            </div>
        </div>

        <div className="space-y-4 mb-8">
            <div className="flex items-center gap-3 text-sm">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Building2 size={16} />
                </div>
                <div>
                     <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Company</p>
                     <p className="text-foreground">{user.company || '—'}</p>
                </div>
            </div>
             <div className="flex items-center gap-3 text-sm">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Mail size={16} />
                </div>
                <div className="overflow-hidden">
                     <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Email</p>
                     <p className="text-foreground truncate" title={user.email}>{user.email}</p>
                </div>
            </div>
             <div className="flex items-center gap-3 text-sm">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <MapPin size={16} />
                </div>
                <div>
                     <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Location</p>
                     <p className="text-foreground">{user.location || '—'}</p>
                </div>
            </div>
        </div>

        <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Mail size={14} /> Recent Threads
            </h3>
            <ul className="space-y-2">
            {user.latestThreads.length > 0 ? (
                user.latestThreads.map((thread, index) => (
                    <li key={index} className="rounded-lg border border-border/50 bg-background/50 p-3 text-sm text-foreground shadow-sm transition-colors hover:bg-muted/50">
                        <span className="font-medium line-clamp-1" title={thread.subject || ''}>{thread.subject || '(No Subject)'}</span>
                    </li>
                ))
            ) : (
                <li className="text-sm text-muted-foreground italic">No recent threads</li>
            )}
            </ul>
        </div>

        <div className="mt-8 pt-6 border-t border-border/50">
           <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Social Profiles</h3>
           <div className="flex flex-wrap gap-2">
                {user.linkedin && (
                    <a
                    href={user.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted hover:text-primary"
                    >
                    <Image
                        src="/linkedin.svg"
                        alt="LinkedIn"
                        width={14}
                        height={14}
                        className="opacity-80"
                    />
                    LinkedIn
                    </a>
                )}
                {user.twitter && (
                    <a
                    href={user.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                   className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted hover:text-primary"
                    >
                    <Image
                        src="/x.svg"
                        alt="X/Twitter"
                        width={14}
                        height={14}
                         className="opacity-80"
                    />
                    Twitter/X
                    </a>
                )}
                {user.github && (
                    <a
                    href={user.github}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted hover:text-primary"
                    >
                    <Image
                        src="/github.svg"
                        alt="GitHub"
                        width={14}
                        height={14}
                         className="opacity-80"
                    />
                    GitHub
                    </a>
                )}
                 {!user.linkedin && !user.twitter && !user.github && (
                    <span className="text-xs text-muted-foreground italic">No social profiles linked</span>
                )}
            </div>
        </div>
      </div>
    </div>
  );
}
