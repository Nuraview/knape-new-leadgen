"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  deriveWhatsAppAlert,
  type WhatsAppBridgeStatus,
} from "@/lib/whatsapp-bridge-alert";

// Global, un-missable WhatsApp-bridge alarm. Mounts once in the authenticated
// routes layout so EVERY page carries it. When the link is broken it:
//   (a) throws up a blocking red modal with the live pairing QR + a direct
//       button to the WhatsApp settings page,
//   (b) fires a sticky (non-auto-dismiss) toast on the state transition,
//   (c) fires a native browser notification (even if the tab is unfocused).
// Reminders to leads/patients ride this bridge — losing it silently is the
// failure mode this guards against.

const WHATSAPP_SETTINGS_PATH = "/admin/whatsapp";
const SNOOZE_MS = 5 * 60 * 1000; // "Remind me later" window — then it re-pops.

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => r.json());

function askBrowserPermissionOnce() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    try {
      Notification.requestPermission().catch(() => {});
    } catch {
      /* noop */
    }
  }
}

function fireNativeNotification(reason: string, code: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification("NuraView — WhatsApp disconnected", {
      body: reason,
      tag: code, // same code replaces any earlier notif for this issue
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      window.location.assign(WHATSAPP_SETTINGS_PATH);
    };
  } catch {
    /* noop */
  }
}

export function WhatsAppBridgeAlert() {
  const { data } = useSWR<WhatsAppBridgeStatus>(
    "/api/whatsapp/status",
    fetcher,
    { refreshInterval: 15_000, revalidateOnFocus: true },
  );

  const alert = deriveWhatsAppAlert(data);
  const broken = alert.level === "critical";

  // Already on the settings page? The panel there shows the live QR directly,
  // so the modal would just fight it — stay out of the way.
  const pathname = usePathname();
  const onSettingsPage = pathname === WHATSAPP_SETTINGS_PATH;

  // `snooze` holds the issue code currently snoozed (or null). A brand-new
  // failure has a different code, so it is never considered snoozed and pops
  // immediately. The timer below clears the snooze, so we never compare
  // timestamps in render (keeps the render pure). Open state is DERIVED from
  // (broken && not-snoozed) rather than toggled imperatively — every setState
  // lives in an event handler or timer callback, never in render or an effect.
  const [snooze, setSnooze] = useState<string | null>(null);
  const lastCode = useRef<string | null>(null);
  const snoozeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSnoozed = snooze !== null && snooze === alert.code;
  const open = broken && !isSnoozed && !onSettingsPage;

  useEffect(() => {
    askBrowserPermissionOnce();
  }, []);

  // Side-effects ONLY (toast + native notification) on each state transition.
  // No setState here — open is derived, so this stays compliant.
  useEffect(() => {
    if (!broken) {
      if (lastCode.current) {
        toast.dismiss(lastCode.current);
        toast.success("WhatsApp reconnected — reminders are flowing again.", {
          id: "wa-recovered",
          duration: 6_000,
        });
      }
      lastCode.current = null;
      return;
    }
    if (alert.code !== lastCode.current) {
      lastCode.current = alert.code;
      toast.error(alert.reason, {
        id: alert.code,
        duration: Infinity,
        action: {
          label: "Re-link",
          onClick: () => window.location.assign(WHATSAPP_SETTINGS_PATH),
        },
      });
      fireNativeNotification(alert.reason, alert.code);
    }
  }, [broken, alert.code, alert.reason]);

  // Clean up the snooze timer on unmount.
  useEffect(
    () => () => {
      if (snoozeTimer.current) clearTimeout(snoozeTimer.current);
    },
    [],
  );

  function snoozeNow() {
    const code = alert.code;
    setSnooze(code);
    // Clear the snooze when the window lapses so the modal re-pops if the
    // bridge is still down. setState here runs in a timer callback (allowed).
    if (snoozeTimer.current) clearTimeout(snoozeTimer.current);
    snoozeTimer.current = setTimeout(() => {
      snoozeTimer.current = null;
      setSnooze((s) => (s === code ? null : s));
    }, SNOOZE_MS);
  }

  function handleOpenChange(next: boolean) {
    // Closing (X / overlay / Esc) snoozes — it never dismisses forever.
    if (!next) snoozeNow();
  }

  if (!broken) return null;

  const offline = alert.code === "wa-offline";
  const title = offline
    ? "WhatsApp bridge is offline"
    : "WhatsApp needs to be re-linked";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md border-2 border-red-500/60">
        <DialogHeader>
          <div className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-6 w-6 shrink-0" />
            <DialogTitle className="text-red-600">{title}</DialogTitle>
          </div>
          <DialogDescription className="pt-1 text-foreground/80">
            {alert.reason}
          </DialogDescription>
        </DialogHeader>

        {alert.qrDataUrl ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border bg-background p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={alert.qrDataUrl}
              alt="WhatsApp pairing QR code"
              width={240}
              height={240}
              className="rounded border"
            />
            <p className="text-center text-xs text-muted-foreground">
              On the paired phone: WhatsApp → Settings → Linked Devices → Link a
              Device, then scan this code.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-l-4 border-l-red-500 bg-red-500/5 px-3 py-2 text-xs text-muted-foreground">
            The bridge container on the VPS is not responding, so no QR is
            available yet. Open the WhatsApp settings page — the live QR appears
            there the moment the service is back up.
          </div>
        )}

        {data?.last_error ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">Last error:</span> {data.last_error}
          </p>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-2">
          <button
            type="button"
            onClick={snoozeNow}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Remind me in 5 min
          </button>
          <Link
            href={WHATSAPP_SETTINGS_PATH}
            className="rounded-md bg-red-600 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-red-700"
          >
            Open WhatsApp settings →
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
