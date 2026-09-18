import { FlaskConical } from "lucide-react";

import { Button } from "./ui/button";
import { isVendorDemoHost } from "@/lib/demo/enabled";

/**
 * The notice that makes a demo build safe to show someone.
 *
 * IT SAYS WHAT THE OLD ONE DID NOT. The previous wording was "This is a demo
 * environment. All data will be automatically purged every hour." That
 * describes the environment's retention policy, which is not what a reader
 * standing in front of the outreach dashboard needs to know. On a build
 * carrying the seeded dataset the load-bearing fact is that the send counts,
 * the open rate and the Sent log are invented and that no message was
 * delivered to anybody — and the old sentence does not say so. Somebody shown
 * this screen could read those figures as their own campaign results and be
 * entirely reasonable in doing so.
 *
 * It is rendered by the app shell whenever the demo flag is on (see
 * common/layout.tsx), so there is no build that serves invented send figures
 * without it. That pairing is the whole basis on which the dataset exists.
 *
 * THE "DEPLOY YOUR OWN" BUTTON IS THE VENDOR'S, and now only appears on the
 * vendor's own demo host. It was unconditional, so a white-labelled client
 * demo put a link to NuraView's GitHub in the client's own CRM — the same
 * brand leak the favicon, the manifest and the email signature each had to be
 * fixed for.
 */
export function DemoAlert() {
  return (
    <div
      role="status"
      className="sticky top-0 left-0 right-0 z-30 flex flex-col border-warning/30 border-b bg-warning/10 px-4 py-2.5 text-center"
    >
      <div className="flex flex-col items-center justify-center gap-2 text-sm text-warning-foreground sm:flex-row">
        <p className="flex flex-col items-center gap-x-2 gap-y-1 sm:flex-row">
          <span className="flex items-center gap-2 font-medium">
            <FlaskConical className="size-4 shrink-0" aria-hidden />
            Sample data
          </span>
          <span className="text-warning-foreground/90">
            Send counts, open and bounce rates and the sent log on this build
            are illustrative. No email here was sent to anyone.
          </span>
          {isVendorDemoHost && (
            <Button
              onClick={() =>
                window.open("https://github.com/usenuraview/nuraview", "_blank")
              }
              className="h-7 whitespace-nowrap bg-warning/15 px-3 text-warning-foreground text-xs hover:bg-warning/25 sm:h-6 sm:px-2"
            >
              Deploy your own
            </Button>
          )}
        </p>
      </div>
    </div>
  );
}
