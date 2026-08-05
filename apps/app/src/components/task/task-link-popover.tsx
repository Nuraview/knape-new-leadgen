/**
 * Card link control.
 *
 * What this used to be: a "Share publicly" switch that minted an anonymous
 * token — "anyone with the link can view this card". That was the wrong shape
 * entirely. Card links exist so a standalone card can be handed to the people
 * ASSIGNED TO THAT PROJECT, and a card carries the client's name, the scope
 * and the team's comments. A URL that worked for the whole internet leaked
 * more than the board it was cut from.
 *
 * So there is no toggle any more, and nothing to revoke: the link is just the
 * card's address. Every open is authorised server-side against project
 * membership (GET /task/:id/card), the same rule as opening the board. Sending
 * it to the wrong person grants them nothing.
 */
import { Check, Copy, ExternalLink, Link2, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "@/lib/toast";

export default function TaskLinkPopover({
  taskId,
  className,
}: {
  taskId: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const cardUrl = `${window.location.origin}/s/t/${taskId}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(cardUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy the link");
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className={className}
            title="Copy link to this card"
            aria-label="Copy link to this card"
          />
        }
      >
        <Link2 className="size-4" />
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-4">
        <div className="text-sm font-medium">Link to this card</div>
        <p className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Users className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Opens for people assigned to this project (and admins) once they
            sign in. Nobody else can view it, link or not.
          </span>
        </p>

        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-1.5">
            <input
              readOnly
              value={cardUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 text-xs"
            />
            <Button
              size="icon-sm"
              variant="outline"
              onClick={copy}
              title="Copy link"
            >
              {copied ? (
                <Check className="size-3.5 text-emerald-600" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>

          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
            render={<a href={cardUrl} target="_blank" rel="noreferrer" />}
          >
            <ExternalLink className="size-3.5" />
            Open
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
