/**
 * Web Push registration — ported from the legacy usePushNotifications hook.
 *
 * This is what makes an incoming call reach someone whose CRM tab is closed.
 * Without it the dialer only rings while the tab is open and focused, which is
 * the practical reason calls were being missed.
 *
 * Three things here are load-bearing and easy to get wrong:
 *
 *  1. Notification.requestPermission() MUST be called from a user gesture.
 *     Chrome ignores it otherwise, and Safari throws. So this hook never asks
 *     on mount — the caller wires `subscribe` to a button.
 *
 *  2. The VAPID public key comes from /api/config at RUNTIME, not from a
 *     VITE_ variable baked at build time. A build-time variable is exactly what
 *     broke the Projects page when the SPA build moved out of Docker and the
 *     ARG silently vanished.
 *
 *  3. applicationServerKey must be a Uint8Array of the raw bytes. Passing the
 *     base64 string straight through "works" until the push actually fails to
 *     decrypt, which looks like the server being broken.
 */
import { useCallback, useEffect, useState } from "react";
import { getApiUrl } from "@/fetchers/get-api-url";

/** URL-safe base64 → bytes, per the Push API spec. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Is this subscription signed with the key the server is using now?
 *
 * applicationServerKey comes back as an ArrayBuffer of the raw key; the config
 * value is base64url. Compare them in one representation rather than trusting
 * that a subscription exists at all.
 */
function sameKey(
  applicationServerKey: ArrayBuffer | null,
  vapidPublicKey: string,
): boolean {
  if (!applicationServerKey) return false;
  try {
    const mine = urlBase64ToUint8Array(vapidPublicKey);
    const theirs = new Uint8Array(applicationServerKey);
    if (mine.length !== theirs.length) return false;
    return mine.every((byte, i) => byte === theirs[i]);
  } catch {
    return false;
  }
}

export type PushState = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  busy: boolean;
  /** Null until /api/config answers, or when the server has no VAPID keys. */
  vapidPublicKey: string | null;
};

export function usePushNotifications() {
  const supported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  const [state, setState] = useState<PushState>({
    supported,
    permission: supported ? Notification.permission : "unsupported",
    subscribed: false,
    busy: false,
    vapidPublicKey: null,
  });

  // Register the worker and read back any existing subscription, so a browser
  // that already granted permission shows as subscribed instead of prompting
  // again.
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;

    (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const existing = await registration.pushManager.getSubscription();
        const config = await fetch(getApiUrl("config"), {
          credentials: "include",
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);

        const key =
          (config as { vapidPublicKey?: string | null } | null)
            ?.vapidPublicKey ?? null;

        /*
         * A SUBSCRIPTION BOUND TO AN OLD KEY IS WORSE THAN NONE.
         *
         * Push subscriptions are tied to the VAPID key they were created with.
         * The ten subscriptions in production were made by the legacy Next app
         * under a different key, so every send returned 403 while the browser
         * still reported itself perfectly subscribed. Nobody got notifications
         * and nothing looked wrong from either end.
         *
         * So compare the key this subscription was minted with against the one
         * the server is signing with now, and throw it away on a mismatch. The
         * browser has already granted permission, so re-subscribing is silent —
         * no prompt, no click needed.
         */
        const staleKey =
          existing != null &&
          key != null &&
          !sameKey(existing.options?.applicationServerKey ?? null, key);

        if (staleKey && existing) {
          await existing.unsubscribe().catch(() => undefined);
        }

        if (cancelled) return;
        setState((prev) => ({
          ...prev,
          subscribed: Boolean(existing) && !staleKey,
          vapidPublicKey: key,
        }));
      } catch (error) {
        console.warn("[push] service worker registration failed:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supported]);

  /** Call from a click. Asks permission, subscribes, registers server-side. */
  const subscribe = useCallback(async (): Promise<
    { ok: true } | { ok: false; reason: string }
  > => {
    if (!supported) return { ok: false, reason: "This browser cannot do push" };
    if (!state.vapidPublicKey) {
      return {
        ok: false,
        reason: "Push is not configured on the server (no VAPID key)",
      };
    }

    setState((prev) => ({ ...prev, busy: true }));
    try {
      const permission = await Notification.requestPermission();
      setState((prev) => ({ ...prev, permission }));
      if (permission !== "granted") {
        return { ok: false, reason: "Notification permission was denied" };
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // Required by every browser: a push that cannot show UI is not allowed.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(state.vapidPublicKey),
      });

      const response = await fetch(getApiUrl("dialer/push/subscribe"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) {
        return { ok: false, reason: "The server rejected the subscription" };
      }

      setState((prev) => ({ ...prev, subscribed: true }));
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "Subscription failed",
      };
    } finally {
      setState((prev) => ({ ...prev, busy: false }));
    }
  }, [supported, state.vapidPublicKey]);

  const unsubscribe = useCallback(async () => {
    if (!supported) return;
    setState((prev) => ({ ...prev, busy: true }));
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        // Server first: if the local unsubscribe succeeds and the server call
        // fails, the row lingers and keeps receiving pushes nobody can see.
        await fetch(
          `${getApiUrl("dialer/push/subscribe")}?endpoint=${encodeURIComponent(subscription.endpoint)}`,
          { method: "DELETE", credentials: "include" },
        ).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setState((prev) => ({ ...prev, subscribed: false }));
    } finally {
      setState((prev) => ({ ...prev, busy: false }));
    }
  }, [supported]);

  return { ...state, subscribe, unsubscribe };
}
