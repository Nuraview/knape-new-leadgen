'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/marketing/ui/alert';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/marketing/ui/tooltip';
import { sendEmailAction } from '@/lib/marketing/actions';
import { ExclamationTriangleIcon } from '@radix-ui/react-icons';
import { Paperclip, Trash2, Send, Clock, Bell, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense, useActionState } from 'react';
import { Button } from '@/components/marketing/ui/button';

function DiscardDraftLink() {
  let { name } = useParams();

  return (
    <Link href={`/marketing/f/${name}`} className="text-muted-foreground hover:text-destructive transition-colors">
      <Trash2 size={20} />
    </Link>
  );
}

function EmailBody({ defaultValue = '' }: { defaultValue?: string }) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === 'Enter' || e.key === 'NumpadEnter')
    ) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div>
      <textarea
        name="body"
        placeholder="Write your email... (Ctrl+Enter to send)"
        className="h-[calc(100vh-320px)] w-full resize-none rounded-lg border border-input bg-background/50 p-4 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none placeholder:text-muted-foreground"
        required
        onKeyDown={handleKeyDown}
        defaultValue={defaultValue}
      />
    </div>
  );
}

export default function ComposePage() {
  let { name } = useParams();
  let [state, formAction] = useActionState(sendEmailAction, {
    error: '',
    previous: {
      recipientEmail: '',
      subject: '',
      body: '',
    },
  });

  return (
    <div className="flex h-full grow bg-background">
      <div className="grow">
         <div className="sticky top-0 z-20 flex h-[72px] items-center border-b border-border/40 bg-background/80 px-4 backdrop-blur-md sm:px-8">
            <Link href={`/marketing/f/${name}`} className="mr-4 flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-95">
                <ArrowLeft size={20} />
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-foreground">New Message</h1>
         </div>
         
        <div className="mx-auto max-w-4xl p-6 sm:p-8">
            {state.error && (
            <div className="mb-6">
                <Alert variant="destructive" className="relative border-destructive/20 bg-destructive/10 text-destructive">
                <ExclamationTriangleIcon className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{state.error}</AlertDescription>
                </Alert>
            </div>
            )}
            <form action={formAction} className="space-y-6">
            <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
                <div className="space-y-4">
                    <div className="relative group">
                        <span className="absolute top-1/2 left-3 -translate-y-1/2 transform text-xs font-medium text-muted-foreground uppercase tracking-wider group-focus-within:text-primary transition-colors">
                        To
                        </span>
                        <input
                        type="email"
                        name="recipientEmail"
                        defaultValue={state.previous.recipientEmail?.toString()}
                        className="w-full rounded-lg border border-input bg-background px-4 py-2.5 pl-12 text-sm transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                        placeholder="recipient@example.com"
                        />
                    </div>
                    <div className="relative group">
                        <span className="absolute top-1/2 left-3 -translate-y-1/2 transform text-xs font-medium text-muted-foreground uppercase tracking-wider group-focus-within:text-primary transition-colors">
                        Subject
                        </span>
                        <input
                        type="text"
                        name="subject"
                        defaultValue={state.previous.subject?.toString()}
                        className="w-full rounded-lg border border-input bg-background px-4 py-2.5 pl-20 text-sm transition-all focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                        placeholder="What is this about?"
                        />
                    </div>
                    
                    <EmailBody defaultValue={state.previous.body?.toString()} />
                </div>

                <div className="mt-6 flex flex-col items-center justify-between sm:flex-row gap-4">
                    <TooltipProvider>
                    <div className="flex items-center gap-2">
                        <Button
                        type="submit"
                        className="gap-2 shadow-blue-500/20"
                        >
                        <Send size={16} />
                        Send via Resend
                        </Button>
                        <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled
                            className="gap-2 text-muted-foreground"
                            >
                            <Clock size={16} />
                            Send later
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Scheduling is coming soon</p>
                        </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled
                            className="gap-2 text-muted-foreground"
                            >
                            <Bell size={16} />
                            Remind me
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Reminders are coming soon</p>
                        </TooltipContent>
                        </Tooltip>
                    </div>
                    <div className="flex items-center gap-3">
                        <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                            disabled
                            type="button"
                            className="cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                            >
                            <Paperclip size={20} />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p>Attachments coming soon</p>
                        </TooltipContent>
                        </Tooltip>
                        <div className="h-6 w-px bg-border/60" />
                        <Suspense fallback={<Trash2 size={20} className="text-muted-foreground/50" />}>
                        <DiscardDraftLink />
                        </Suspense>
                    </div>
                    </TooltipProvider>
                </div>
            </div>
            </form>
        </div>
      </div>
    </div>
  );
}
