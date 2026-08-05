"use client";

// Service-worker registration + web-push subscription + push-action handling.
//
// Two ways a push-delivered incoming call reaches the page:
// 1. Tab already open → SW posts {type: 'PUSH_INCOMING_CALL', payload} and we
//    surface the incoming-call card (conference answer).
// 2. Notification click reopens /dialer?push_action=answer&room=… — we parse
//    the query once on mount.

import { useCallback, useEffect, useRef, useState } from "react";

export type PushIncomingPayload = {
  type: "incoming_call";
  callSid: string;
  conference: string;
  from: string;
  contactName?: string;
  contactRequirement?: string;
};

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications(
  onIncomingPush: (payload: PushIncomingPayload) => void,
  onAnswerClick?: (conference: string) => void,
) {
  const [pushEnabled, setPushEnabled] = useState(false);
  const onIncomingRef = useRef(onIncomingPush);
  onIncomingRef.current = onIncomingPush;
  const onAnswerRef = useRef(onAnswerClick);
  onAnswerRef.current = onAnswerClick;

  // SW message channel (tab open while push arrives / notification clicked).
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (
        event.data?.type === "PUSH_INCOMING_CALL" &&
        event.data?.payload?.type === "incoming_call"
      ) {
        onIncomingRef.current(event.data.payload as PushIncomingPayload);
      }
      // Notification action click while a tab was already open: the SW
      // focuses us and forwards the action instead of navigating.
      if (event.data?.type === "PUSH_NOTIFICATION_CLICK") {
        const { action, payload } = event.data;
        if (action === "answer" && payload?.conference) {
          onAnswerRef.current?.(payload.conference as string);
        }
        // decline: nothing to do server-side; just let the card disappear.
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  /** Call from a user gesture (Start dialer): registers SW + subscribes. */
  const enablePush = useCallback(async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        return false;
      }
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        console.warn("NEXT_PUBLIC_VAPID_PUBLIC_KEY not set — push disabled");
        return false;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const permission = await Notification.requestPermission();
      if (permission !== "granted") return false;

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
        });
      }

      const response = await fetch("/api/dialer/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      const ok = response.ok;
      setPushEnabled(ok);
      return ok;
    } catch (error) {
      console.error("Push setup failed:", error);
      return false;
    }
  }, []);

  /** Parses ?push_action=answer&room=… set by a notification click. */
  const consumePushAction = useCallback((): {
    action: string;
    room: string | null;
    callSid: string | null;
  } | null => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get("push_action");
    if (!action) return null;
    const result = {
      action,
      room: params.get("room"),
      callSid: params.get("call_sid"),
    };
    // Strip the params so a refresh doesn't re-trigger.
    params.delete("push_action");
    params.delete("room");
    params.delete("call_sid");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (query ? `?${query}` : ""),
    );
    return result;
  }, []);

  return { pushEnabled, enablePush, consumePushAction };
}
