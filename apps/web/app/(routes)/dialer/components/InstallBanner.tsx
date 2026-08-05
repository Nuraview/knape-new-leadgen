"use client";

// PWA install nudge — installing matters for push reliability on mobile
// (offline incoming-call notifications). Android/desktop Chrome: native
// prompt via beforeinstallprompt. iOS: manual Share → Add to Home Screen.

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";

const DISMISS_KEY = "dialer_install_dismissed";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
};

export function InstallBanner() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY)) return;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) return;
    setDismissed(false);

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      setShowIos(true);
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (dismissed || (!installEvent && !showIos)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // session-only dismiss
    }
  };

  return (
    <div className="mb-3 flex items-center gap-3 rounded-md border bg-muted/50 px-3 py-2 text-sm">
      <Download className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1">
        {showIos
          ? "Install for reliable incoming-call alerts: Share → Add to Home Screen."
          : "Install this app to receive incoming calls faster."}
      </span>
      {installEvent && (
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void installEvent.prompt();
            dismiss();
          }}
        >
          Install
        </Button>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={dismiss}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
