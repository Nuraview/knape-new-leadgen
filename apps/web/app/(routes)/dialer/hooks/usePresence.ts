"use client";

// Presence keeps this agent in dialer_client_sessions so the /api/twilio/voice
// webhook routes inbound calls to online agents. Register once the device is
// ready, heartbeat every 15s, best-effort unregister on tab close.

import { useEffect } from "react";

const HEARTBEAT_INTERVAL_MS = 15_000;

export function usePresence(active: boolean) {
  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    const register = () =>
      fetch("/api/dialer/presence/register", { method: "POST" }).catch(() => {});
    const heartbeat = () =>
      fetch("/api/dialer/presence/heartbeat", { method: "POST" }).catch(() => {});

    register();
    const timer = setInterval(() => {
      if (!cancelled) heartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    const onPageHide = () => {
      // sendBeacon survives tab close; the route ignores the body.
      navigator.sendBeacon?.("/api/dialer/presence/unregister", "");
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("pagehide", onPageHide);
      fetch("/api/dialer/presence/unregister", { method: "POST" }).catch(
        () => {},
      );
    };
  }, [active]);
}
