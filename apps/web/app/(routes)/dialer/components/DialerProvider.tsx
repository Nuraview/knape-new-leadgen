"use client";

// Single source of truth for the Twilio device across the whole app.
//
// Previously DialerShell (/dialer), GlobalDialerRuntime (floating widget) and
// InlineDialer (lead drawer) each called useTwilioDevice() independently —
// every mount registered its OWN Twilio Device under the same identity, which
// collides (a second registration kicks the first; incoming rings the wrong
// one). This provider owns exactly one device + all the orchestration
// (presence, ringtone, push, auto-start, gesture unlock, conference answer)
// and every consumer reads it via useDialer().

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";

import { usePresence } from "../hooks/usePresence";
import {
  usePushNotifications,
  type PushIncomingPayload,
} from "../hooks/usePushNotifications";
import { useRingtone } from "../hooks/useRingtone";
import { useTwilioDevice } from "../hooks/useTwilioDevice";

type DeviceApi = ReturnType<typeof useTwilioDevice>;

type DialerContextValue = DeviceApi & {
  /** Conference-aware accept (handles push-delivered offline calls). */
  accept: () => void;
  /** Conference-aware reject. */
  reject: () => void;
};

const DialerContext = createContext<DialerContextValue | null>(null);

export function useDialer(): DialerContextValue {
  const ctx = useContext(DialerContext);
  if (!ctx) {
    throw new Error("useDialer must be used within <DialerProvider>");
  }
  return ctx;
}

export function DialerProvider({ children }: { children: ReactNode }) {
  const device = useTwilioDevice();
  const {
    state,
    start,
    connectConference,
    acceptIncoming,
    rejectIncoming,
    setIncoming,
  } = device;
  const ringtone = useRingtone();

  const autoStartedRef = useRef(false);
  const gestureHandledRef = useRef(false);
  // Conference room of a push-delivered call awaiting accept/decline.
  const pendingConferenceRef = useRef<string | null>(null);

  usePresence(
    state === "ready" ||
      state === "dialing" ||
      state === "in-call" ||
      state === "incoming",
  );

  const onIncomingPush = useCallback(
    (payload: PushIncomingPayload) => {
      pendingConferenceRef.current = payload.conference;
      setIncoming({
        from: payload.from,
        contactName: payload.contactName ?? "",
        contactRequirement: payload.contactRequirement ?? "",
        conference: payload.conference,
      });
    },
    [setIncoming],
  );

  const { enablePush, consumePushAction } = usePushNotifications(
    onIncomingPush,
    connectConference,
  );

  // Auto-start the device once.
  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    start();
  }, [start]);

  // Unlock ringtone audio + request push permission on first user gesture.
  useEffect(() => {
    if (gestureHandledRef.current) return;
    const onGesture = () => {
      if (gestureHandledRef.current) return;
      gestureHandledRef.current = true;
      ringtone.unlock();
      enablePush();
      // Pre-grant microphone permission while we still have a user gesture.
      // Twilio's call.accept() acquires the mic synchronously; if the browser
      // permission prompt hasn't been satisfied yet, the first inbound accept
      // fails to get an audio stream and the call connects with no audio / drops
      // — which looked like "the incoming popup shows but I can't take the
      // call". Requesting it up-front (then releasing the temp stream) means the
      // mic is ready the instant a call is answered.
      void navigator.mediaDevices
        ?.getUserMedia({ audio: true })
        .then((stream) => stream.getTracks().forEach((t) => t.stop()))
        .catch(() => {});
      window.removeEventListener("click", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
    };
    window.addEventListener("click", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    return () => {
      window.removeEventListener("click", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
    };
  }, [enablePush, ringtone]);

  // Notification-click deep link (?push_action=answer&room=…).
  useEffect(() => {
    const pushAction = consumePushAction();
    if (pushAction?.action === "answer" && pushAction.room) {
      connectConference(pushAction.room);
    }
  }, [connectConference, consumePushAction]);

  // Ring while a call is pending.
  useEffect(() => {
    if (state === "incoming") {
      ringtone.start();
    } else {
      ringtone.stop();
    }
  }, [state, ringtone]);

  const accept = useCallback(() => {
    const conference = pendingConferenceRef.current;
    if (conference) {
      pendingConferenceRef.current = null;
      setIncoming(null);
      connectConference(conference);
      return;
    }
    acceptIncoming();
  }, [acceptIncoming, connectConference, setIncoming]);

  const reject = useCallback(() => {
    if (pendingConferenceRef.current) {
      pendingConferenceRef.current = null;
      setIncoming(null);
      return;
    }
    rejectIncoming();
  }, [rejectIncoming, setIncoming]);

  // Keyboard shortcut: press "R" to answer an incoming call (Esc to decline).
  // Only active while ringing, and ignored while typing in a field so it never
  // hijacks normal input.
  useEffect(() => {
    if (state !== "incoming") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        accept();
      } else if (e.key === "Escape") {
        e.preventDefault();
        reject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, accept, reject]);

  return (
    <DialerContext.Provider value={{ ...device, accept, reject }}>
      {children}
    </DialerContext.Provider>
  );
}
