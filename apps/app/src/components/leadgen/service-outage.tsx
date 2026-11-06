/**
 * Service outage notice: a banner at the top of Home and a
 * popup that keeps coming back.
 *
 * These are account and billing problems, not something the app can detect,
 * so the copy is static. Remove this component from Home once the Instantly.ai
 * payment and the tool renewals are sorted out.
 *
 * The popup is meant to be annoying. It opens every time Home loads and comes
 * back REOPEN_AFTER_MS after it is dismissed, so nobody can click it away once
 * and forget about it. The banner can't be dismissed at all.
 */
import { AlertOctagon, MailX, ServerCrash, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useBrand } from "@/hooks/use-brand";

const REOPEN_AFTER_MS = 60_000;

const ISSUES = [
  {
    key: "instantly",
    icon: MailX,
    title: "Instantly.ai payment failed. The mail pool is down.",
    detail:
      "The Instantly.ai subscription payment didn't go through, so the sending mailboxes are offline. No outreach emails or follow-ups are going out until the payment is fixed.",
  },
  {
    key: "infrastructure",
    icon: ServerCrash,
    title: "Infrastructure will be down: tool renewals are due.",
    detail:
      "The tool subscriptions that run the servers and databases are up for renewal. If they aren't renewed, the infrastructure behind this dashboard will go offline.",
  },
  {
    key: "automations",
    icon: Workflow,
    title: "Automations will be down: tool renewals are due.",
    detail:
      "Lead finding, enrichment and the scheduled email runs depend on the same tools. They will stop when the subscriptions lapse.",
  },
] as const;

function IssueList({ compact = false }: { compact?: boolean }) {
  return (
    <ul className={compact ? "space-y-3" : "grid gap-3 md:grid-cols-3"}>
      {ISSUES.map(({ key, icon: Icon, title, detail }) => (
        <li
          key={key}
          className="flex gap-3 rounded-md border border-red-500/40 bg-red-500/10 p-3"
        >
          <Icon className="mt-0.5 size-5 shrink-0 text-red-500" />
          <div className="min-w-0">
            <p className="font-semibold text-red-600 text-sm dark:text-red-400">
              {title}
            </p>
            <p className="mt-1 text-muted-foreground text-xs">{detail}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ServiceOutage() {
  const brand = useBrand();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => setOpen(true), REOPEN_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <>
      <section
        role="alert"
        className="rounded-lg border-2 border-red-600 bg-red-600/10 p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <AlertOctagon className="size-8 shrink-0 animate-pulse text-red-600" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-red-600 text-xs uppercase tracking-wider dark:text-red-400">
              {brand.shortName} · Service outage
            </p>
            <h2 className="mt-1 font-bold text-red-600 text-xl leading-tight sm:text-2xl dark:text-red-400">
              Instantly.ai payment is down and the mail pool is offline
            </h2>
            <p className="mt-1 text-muted-foreground text-sm">
              Outreach has stopped, and infrastructure and automations will go
              down too unless the tools are renewed.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <IssueList />
        </div>
      </section>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="border-2 border-red-600">
          <AlertDialogHeader>
            <div className="flex items-center gap-2 max-sm:justify-center">
              <AlertOctagon className="size-6 shrink-0 animate-pulse text-red-600" />
              <AlertDialogTitle className="text-red-600 dark:text-red-400">
                {brand.shortName}: services are down
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              Billing and renewal problems need to be fixed before outreach can
              start again.
            </AlertDialogDescription>
            <div className="mt-2 text-left">
              <IssueList compact />
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="destructive" />}>
              I understand
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default ServiceOutage;
