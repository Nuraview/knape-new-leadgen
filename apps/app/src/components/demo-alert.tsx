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
    /*
     * A CHIP, not a banner.
     *
     * This was a full-width tinted strip with a two-sentence paragraph in it,
     * which cost real vertical space on a phone and dominated the first
     * screenful of a walkthrough — the thing the demo build exists to show.
     *
     * The disclosure itself is not negotiable: a build serving invented send
     * figures has to say so where the figures are, and this component is what
     * makes that dataset defensible (see lib/demo/enabled.ts). But "visible"
     * and "shouting" are different requirements, and the short label carries
     * the load — the detail moves into the tooltip, one hover away, and into
     * aria-label for anyone not hovering.
     *
     * Still sticky and still inside the content panel, so it cannot be
     * scrolled away from and cannot be mistaken for chrome belonging to the
     * host page.
     */
    <div
      role="status"
      aria-label="Sample data: send counts, open and bounce rates and the sent log on this build are illustrative. No email here was sent to anyone."
      className="sticky top-0 z-30 flex shrink-0 items-center justify-center gap-2 border-warning/25 border-b bg-warning/8 px-3 py-1"
    >
      <span
        title="Send counts, open and bounce rates and the sent log on this build are illustrative. No email here was sent to anyone."
        className="inline-flex cursor-default items-center gap-1.5 font-medium text-[11px] text-warning-foreground/90 uppercase tracking-[0.08em]"
      >
        <FlaskConical className="size-3.5 shrink-0" aria-hidden />
        Sample data
      </span>

      {isVendorDemoHost && (
        <Button
          onClick={() =>
            window.open("https://github.com/usenuraview/nuraview", "_blank")
          }
          className="h-5 whitespace-nowrap bg-warning/15 px-2 text-[11px] text-warning-foreground hover:bg-warning/25"
        >
          Deploy your own
        </Button>
      )}
    </div>
  );
}
