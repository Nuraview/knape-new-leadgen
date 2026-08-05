"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";

import {
  deriveScraperAlert,
  type Alert,
  type HealthLite,
} from "@/lib/scraper-alert";

// Global pipeline-health alerter. Mounts in the authenticated routes layout
// so every page carries:
//   (a) a persistent red banner when a critical condition is active,
//   (b) a toast the MOMENT a critical condition first appears (state
//       transition, so we don't spam every 20s poll),
//   (c) a native browser notification if the user granted permission
//       (fires even when the tab isn't focused).
//
// The dot on the "System Health" tab inside /leads is driven from the same
// `deriveScraperAlert` helper so the three surfaces always agree.

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => r.json());

function askBrowserPermissionOnce() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    // Request lazily; most browsers ignore the call if the user has never
    // interacted, but when they click any button this resolves normally.
    try {
      Notification.requestPermission().catch(() => {});
    } catch {
      /* noop */
    }
  }
}

function fireNativeNotification(alert: Alert) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification("NuraView — critical", {
      body: alert.reason,
      tag: alert.code, // same code replaces any earlier notif for this issue
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      window.location.assign("/leads");
    };
  } catch {
    /* noop */
  }
}

export function HealthAlertBanner() {
  const { data } = useSWR<HealthLite>(
    "/api/scraper/health",
    fetcher,
    { refreshInterval: 20_000, revalidateOnFocus: true },
  );

  const alert = deriveScraperAlert(data);

  // Remember the most recent alert CODE. Toasts/notifications fire only on
  // the transition into a new critical code — not every poll.
  const lastCode = useRef<string | null>(null);

  useEffect(() => {
    askBrowserPermissionOnce();
  }, []);

  useEffect(() => {
    if (alert.code === lastCode.current) return;
    lastCode.current = alert.code;
    if (alert.level === "critical") {
      // Non-auto-dismissing toast: reviewer must acknowledge.
      toast.error(alert.reason, {
        id: alert.code,
        duration: Infinity,
        action: {
          label: "View",
          onClick: () => {
            window.location.assign("/leads");
          },
        },
      });
      fireNativeNotification(alert);
    } else if (alert.level === "warn") {
      toast.warning(alert.reason, { id: alert.code, duration: 10_000 });
    } else if (alert.level === "none") {
      // Clear any sticky critical toast when everything recovers.
      toast.dismiss();
    }
  }, [alert.code, alert.level, alert.reason]);

  if (alert.level !== "critical") return null;

  return (
    <div
      role="alert"
      className="px-4 py-2 bg-red-600 text-white text-sm flex items-center gap-3 border-b-2 border-red-700"
    >
      <span className="text-lg leading-none" aria-hidden>
        ⚠
      </span>
      <div className="flex-1 min-w-0 truncate">
        <span className="font-semibold mr-2">Lead pipeline alert:</span>
        <span>{alert.reason}</span>
      </div>
      <Link
        href="/leads"
        className="shrink-0 underline font-medium hover:text-white/80"
      >
        Fix in System Health →
      </Link>
    </div>
  );
}
