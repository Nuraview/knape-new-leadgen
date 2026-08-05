import moment from "moment";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircledIcon,
  CrossCircledIcon,
  CursorArrowIcon,
  EnvelopeOpenIcon,
  PaperPlaneIcon,
} from "@radix-ui/react-icons";

import { getLeadEngagementTimeline } from "@/actions/crm/get-lead-engagement";

interface Props {
  email: string | null | undefined;
}

const statusMeta: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; className: string }
> = {
  clicked: {
    label: "Clicked",
    icon: CursorArrowIcon,
    className: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  opened: {
    label: "Opened",
    icon: EnvelopeOpenIcon,
    className: "bg-sky-100 text-sky-800 border-sky-200",
  },
  bounced: {
    label: "Bounced",
    icon: CrossCircledIcon,
    className: "bg-red-100 text-red-800 border-red-200",
  },
  delivered: {
    label: "Delivered",
    icon: CheckCircledIcon,
    className: "bg-slate-100 text-slate-700 border-slate-200",
  },
  sent: {
    label: "Sent",
    icon: PaperPlaneIcon,
    className: "bg-slate-50 text-slate-600 border-slate-200",
  },
};

// Pick the "best" signal for the row badge. Mirrors getLeadEngagementSummary's
// ranking so the row badge agrees with the list-page badge.
function rowSignal(send: {
  status: string;
  openedAt: string | null;
  clickedAt: string | null;
}): string {
  if (send.clickedAt) return "clicked";
  if (send.openedAt) return "opened";
  if (send.status === "bounced") return "bounced";
  if (send.status === "delivered") return "delivered";
  if (send.status === "sent") return "sent";
  return send.status || "queued";
}

export async function EmailEngagementSection({ email }: Props) {
  const events = await getLeadEngagementTimeline(email);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PaperPlaneIcon className="h-4 w-4" />
          Email engagement
        </CardTitle>
        <CardDescription>
          {email
            ? `Resend activity for ${email}`
            : "No email on file for this lead."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!email ? null : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No campaign emails have been sent to this address yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {events.map((e) => {
              const signal = rowSignal(e);
              const meta = statusMeta[signal];
              const Icon = meta?.icon ?? PaperPlaneIcon;
              return (
                <li
                  key={e.id}
                  className="flex flex-col gap-1 rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">
                      {e.subject || "(no subject)"}
                    </div>
                    <Badge
                      variant="outline"
                      className={`${meta?.className ?? ""} gap-1 shrink-0`}
                    >
                      <Icon className="h-3 w-3" />
                      {meta?.label ?? signal}
                    </Badge>
                  </div>
                  {e.campaignName ? (
                    <div className="text-xs text-muted-foreground">
                      Campaign: {e.campaignName}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {e.sentAt ? (
                      <span>
                        Sent {moment(e.sentAt).format("YYYY-MM-DD HH:mm")}
                      </span>
                    ) : null}
                    {e.openedAt ? (
                      <span>
                        Opened {moment(e.openedAt).format("YYYY-MM-DD HH:mm")}
                      </span>
                    ) : null}
                    {e.clickedAt ? (
                      <span>
                        Clicked{" "}
                        {moment(e.clickedAt).format("YYYY-MM-DD HH:mm")}
                      </span>
                    ) : null}
                  </div>
                  {e.errorMessage ? (
                    <div className="text-xs text-red-700">
                      {e.errorMessage}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
