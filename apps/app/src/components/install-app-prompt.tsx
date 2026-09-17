/**
 * "Install this app" — app-wide, not dialer-only.
 *
 * WHAT THIS REPLACES. The nudge used to live in components/dialer/install-banner
 * and was rendered by exactly one page, so the only people ever offered the
 * install were the ones who had already navigated to the dialer. Everybody
 * working the leads list on a phone — which is most of the mobile use of this
 * CRM — was never asked, and an app nobody installs gets none of the things
 * installing is for:
 *
 *   - push that survives the OS killing a background browser tab, which is the
 *     difference between hearing an incoming call and finding it in the missed
 *     list, and between answering the work-clock prompt and losing 15 minutes;
 *   - a launch with no URL bar, on a screen where 60px of browser chrome is a
 *     real fraction of the page;
 *   - the cached shell, so opening it on a bad connection paints instead of
 *     hanging.
 *
 * WHERE IT SITS. Mounted once on the authenticated shell, fixed to the bottom
 * above the safe-area inset. Bottom, because on a phone that is where the thumb
 * is and where a dismissible strip does not cover the content someone came for;
 * and it is the one piece of UI here that is FOR mobile, so it is sized for a
 * thumb rather than squeezed into the header.
 *
 * WHEN IT DOES NOT APPEAR: already installed, already dismissed, or the browser
 * has not offered `beforeinstallprompt` and this is not iOS (i.e. the platform
 * cannot install it, so offering would be a lie).
 */
import { Download, Share, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import useBrand from "@/hooks/use-brand";
import { isStandalone } from "@/lib/pwa";

/*
 * Kept distinct from the old `dialer_install_dismissed` key on purpose. Someone
 * who waved away the dialer's banner months ago has not declined THIS prompt,
 * which is offered on different screens for broader reasons — and silently
 * inheriting that dismissal would mean the new prompt never showed for exactly
 * the users most likely to want it.
 */
const DISMISS_KEY = "install_prompt_dismissed_v1";

/** Only ask again after a good while, if they closed it without installing. */
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function dismissedRecently(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    // "1" is the old shape: treat a legacy dismissal as permanent rather than
    // re-prompting everyone who ever closed this.
    if (raw === "1") return true;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < SNOOZE_MS;
  } catch {
    // Private mode, or storage blocked. Show it; a prompt shown twice is a far
    // smaller problem than one that can never be dismissed.
    return false;
  }
}

export function InstallAppPrompt() {
  const brand = useBrand();
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [hidden, setHidden] = useState(true);

  /*
   * The dialer earns a different sentence.
   *
   * On every other screen the honest reason is "it opens faster and works
   * offline". On the dialer the reason is that an uninstalled browser tab
   * drops calls, which is a concrete consequence rather than a nicety — and
   * that was the original banner's whole point, so it is kept.
   */
  const onDialer = useRouterState({
    select: (s) => s.location.pathname.startsWith("/dialer"),
  });

  useEffect(() => {
    if (isStandalone() || dismissedRecently()) return;

    const isIos =
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      // iPadOS 13+ reports itself as a Mac; the touch points give it away.
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    if (isIos) {
      /*
       * iOS has no install API at all — no beforeinstallprompt, no way to ask.
       * The only route is Share → Add to Home Screen, so the prompt becomes an
       * instruction. It also cannot be verified: if they do install it,
       * isStandalone() is what stops us asking again next launch.
       */
      setShowIosHint(true);
      setHidden(false);
      return;
    }

    const onBeforeInstall = (event: Event) => {
      // Suppress Chrome's own mini-infobar so there is one prompt, ours, in a
      // place that does not cover the app's own toolbar.
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      setHidden(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // Installed from somewhere else (the browser menu, another tab): take the
    // prompt down rather than offering to install an installed app.
    const onInstalled = () => setHidden(true);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (hidden || (!installEvent && !showIosHint)) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Dismissed for this session only.
    }
  };

  const install = async () => {
    if (!installEvent) return;
    // Hide immediately: the native sheet is now the UI, and leaving our strip
    // behind it looks like the tap did nothing.
    setHidden(true);
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      // Declined at the OS sheet — do not ask again for a fortnight either.
      if (choice?.outcome !== "accepted") dismiss();
    } catch {
      dismiss();
    }
  };

  return (
    <div
      // Above the dialer's call card but below dialogs, so it can never sit on
      // top of something the user has to act on.
      // The bottom padding is a floor, not two competing declarations: 0.75rem
      // in a browser tab, the home-indicator inset once installed, whichever
      // is larger. See the note on .pb-safe in index.css.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-end sm:px-4"
      role="region"
      aria-label="Install this app"
    >
      <div className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-lg sm:items-center">
        <span
          aria-hidden
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground sm:mt-0"
        >
          {showIosHint ? (
            <Share className="size-4" />
          ) : (
            <Download className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">Install {brand.name}</p>
          <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
            {showIosHint ? (
              <>
                Tap <span className="font-medium text-foreground">Share</span>,
                then{" "}
                <span className="font-medium text-foreground">
                  Add to Home Screen
                </span>
                {onDialer
                  ? " — calls ring reliably only once it is installed."
                  : " for faster launches and offline access."}
              </>
            ) : onDialer ? (
              "Installed, incoming calls ring reliably even when the app is in the background."
            ) : (
              "Opens straight from your home screen, launches faster, and keeps working on a bad connection."
            )}
          </p>

          {installEvent ? (
            <div className="mt-2.5 flex items-center gap-2">
              <Button type="button" size="sm" onClick={install}>
                Install
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={dismiss}>
                Not now
              </Button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          data-touch-target
          className="-me-1 -mt-1 flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

export default InstallAppPrompt;
