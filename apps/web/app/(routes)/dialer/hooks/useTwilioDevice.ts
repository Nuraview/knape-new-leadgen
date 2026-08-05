"use client";

// Twilio Voice SDK device lifecycle — React port of the standalone app's
// ModernVoiceDialer class. The SDK is browser-only, so it's loaded via
// dynamic import() on first start (never during SSR).
//
// One state machine replaces the old class's globalCallLock /
// isCallInProgress / disabled-button flags: connect() is only legal in
// "ready", everything else is a no-op.

import { useCallback, useEffect, useRef, useState } from "react";

import type { Call, Device } from "@twilio/voice-sdk";

export type DialerState =
  | "idle"
  | "initializing"
  | "ready"
  | "dialing"
  | "in-call"
  | "incoming"
  | "error";

export type IncomingInfo = {
  from: string;
  contactName: string;
  contactRequirement: string;
  /** Set when the call arrived via push (caller parked in a conference). */
  conference?: string;
};

const RING_TIMEOUT_MS = 25_000;

async function fetchToken(): Promise<{ identity: string; token: string }> {
  const response = await fetch("/api/dialer/token", { method: "POST" });
  if (!response.ok) throw new Error(`Token request failed: ${response.status}`);
  return response.json();
}

export function useTwilioDevice() {
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useState<DialerState>("idle");
  const [statusText, setStatusText] = useState("Connecting…");
  const [identity, setIdentity] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<IncomingInfo | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isOnHold, setIsOnHold] = useState(false);
  // Whether the user had muted before hold, so resume restores it.
  const mutedBeforeHoldRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [connectedTo, setConnectedTo] = useState<string | null>(null);

  const stateRef = useRef(state);
  stateRef.current = state;

  const clearRingTimeout = () => {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  };

  const cleanupCall = useCallback(() => {
    clearRingTimeout();
    const call = callRef.current;
    if (call) {
      try {
        if (call.status() !== "closed") call.disconnect();
        call.removeAllListeners();
      } catch {
        // already torn down
      }
      callRef.current = null;
    }
    setIsMuted(false);
    setIsOnHold(false);
    mutedBeforeHoldRef.current = false;
    setCallStartedAt(null);
    setConnectedTo(null);
    setIncoming(null);
    if (deviceRef.current?.state === "registered") {
      setState("ready");
      setStatusText("Ready to make and receive calls");
    } else {
      setState("idle");
    }
  }, []);

  const attachCallListeners = useCallback(
    (call: Call, label: string) => {
      call.on("accept", () => {
        clearRingTimeout();
        setState("in-call");
        setStatusText("Call connected");
        setCallStartedAt(Date.now());
        setConnectedTo(label);
      });
      call.on("disconnect", () => cleanupCall());
      call.on("cancel", () => cleanupCall());
      call.on("reject", () => {
        setStatusText("Call declined");
        cleanupCall();
      });
      call.on("error", (error: { message?: string }) => {
        console.error("Call error:", error);
        setStatusText("Call ended");
        cleanupCall();
      });
      call.on("ringing", () => {
        setStatusText("Ringing…");
        ringTimeoutRef.current = setTimeout(() => {
          if (callRef.current && callRef.current.status() === "pending") {
            callRef.current.disconnect();
            setStatusText("Call not answered");
          }
        }, RING_TIMEOUT_MS);
      });
    },
    [cleanupCall],
  );

  /** User-gesture entry point: loads SDK, fetches token, registers device. */
  const start = useCallback(async () => {
    if (deviceRef.current) return;
    setState("initializing");
    setStatusText("Connecting…");
    try {
      const [{ Device }, { token, identity: id }] = await Promise.all([
        import("@twilio/voice-sdk"),
        fetchToken(),
      ]);
      setIdentity(id);

      const device = new Device(token, {
        edge: "ashburn",
        sounds: {},
        allowIncomingWhileBusy: false,
        // opus first, pcmu fallback — matches the standalone app
        codecPreferences: ["opus", "pcmu"] as never,
        disableAudioContextSounds: true,
      });
      deviceRef.current = device;

      device.on("registered", () => {
        setState("ready");
        setStatusText("Ready to make and receive calls");
      });
      device.on("registering", () => setStatusText("Registering…"));
      const scheduleReconnect = () => {
        if (reconnectTimerRef.current) return;
        // 2.5–4.5s jittered retry, same as the standalone app.
        const delay = 2500 + Math.random() * 2000;
        reconnectTimerRef.current = setTimeout(async () => {
          reconnectTimerRef.current = null;
          if (!deviceRef.current || deviceRef.current.state === "registered") {
            return;
          }
          try {
            setStatusText("Reconnecting…");
            const { token: fresh } = await fetchToken();
            deviceRef.current.updateToken(fresh);
            await deviceRef.current.register();
          } catch (error) {
            console.error("Reconnect failed:", error);
            scheduleReconnect();
          }
        }, delay);
      };

      device.on("unregistered", () => {
        if (stateRef.current !== "idle") {
          setState("error");
          setStatusText("Device offline — reconnecting…");
          scheduleReconnect();
        }
      });
      device.on("error", (error: { code?: number; message?: string }) => {
        console.error("Device error:", error);
        if (callRef.current) {
          cleanupCall();
        } else {
          setState("error");
          setStatusText(`Device error: ${error.message ?? "unknown"}`);
          scheduleReconnect();
        }
      });
      device.on("tokenWillExpire", async () => {
        try {
          const { token: fresh } = await fetchToken();
          device.updateToken(fresh);
        } catch (error) {
          console.error("Token refresh failed:", error);
        }
      });
      device.on("incoming", (call: Call) => {
        callRef.current = call;
        const from = call.parameters.From ?? "";
        const contactName = call.customParameters?.get("contactName") ?? "";
        const contactRequirement =
          call.customParameters?.get("contactRequirement") ?? "";
        attachCallListeners(call, contactName || from);
        setIncoming({ from, contactName, contactRequirement });
        setState("incoming");
        setStatusText(`Incoming call from ${contactName || from}`);
      });

      await device.register();
    } catch (error) {
      console.error("Dialer init failed:", error);
      deviceRef.current?.destroy();
      deviceRef.current = null;
      setState("error");
      setStatusText(
        `Initialization failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }, [attachCallListeners, cleanupCall]);

  const connect = useCallback(
    async (to: string, label?: string) => {
      const device = deviceRef.current;
      if (!device || stateRef.current !== "ready" || !to.trim()) return;
      setState("dialing");
      setStatusText("Initiating call…");
      try {
        const call = await device.connect({ params: { To: to.trim() } });
        callRef.current = call;
        attachCallListeners(call, label || to.trim());
      } catch (error) {
        console.error("Call failed:", error);
        setStatusText(
          `Call failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
        cleanupCall();
      }
    },
    [attachCallListeners, cleanupCall],
  );

  /** Join a conference room (push-delivered call answer path). */
  const connectConference = useCallback(
    async (room: string) => {
      // Push answer can land before the device exists — start it first.
      if (!deviceRef.current) await start();
      // Wait briefly for registration.
      for (let i = 0; i < 20 && deviceRef.current?.state !== "registered"; i++) {
        await new Promise((r) => setTimeout(r, 250));
      }
      const device = deviceRef.current;
      if (!device || device.state !== "registered") {
        setStatusText("Device not ready — cannot join call");
        return;
      }
      setState("dialing");
      setStatusText("Joining call…");
      try {
        const call = await device.connect({
          params: { To: `conference:${room}` },
        });
        callRef.current = call;
        attachCallListeners(call, "Conference call");
      } catch (error) {
        console.error("Conference join failed:", error);
        cleanupCall();
      }
    },
    [attachCallListeners, cleanupCall, start],
  );

  const acceptIncoming = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    // Acquire the mic *inside the accept gesture*. call.accept() grabs the
    // audio stream synchronously; if the browser hasn't granted mic access at
    // that instant the call connects with no audio and silently dies — which is
    // exactly the "popup shows but I can't take the call" symptom. Requesting it
    // here (then releasing the temp stream) guarantees permission is satisfied
    // before we answer, regardless of whether the earlier pre-grant ran.
    try {
      const stream = await navigator.mediaDevices?.getUserMedia({ audio: true });
      stream?.getTracks().forEach((t) => t.stop());
    } catch (error) {
      console.error("Microphone permission denied — cannot answer:", error);
      setStatusText("Microphone blocked — allow mic access to answer calls");
      // Still attempt the accept; some setups attach audio lazily.
    }
    try {
      call.accept();
    } catch (error) {
      console.error("Accept failed:", error);
      cleanupCall();
      return;
    }
    setIncoming(null);
  }, [cleanupCall]);

  const rejectIncoming = useCallback(() => {
    callRef.current?.reject();
    setIncoming(null);
    cleanupCall();
  }, [cleanupCall]);

  const hangUp = useCallback(() => {
    callRef.current?.disconnect();
    cleanupCall();
  }, [cleanupCall]);

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const next = !call.isMuted();
    call.mute(next);
    setIsMuted(next);
  }, []);

  // Simulated hold (the Voice SDK has no native hold): mutes the mic and
  // restores the previous mute state on resume — same as the standalone app.
  const toggleHold = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    setIsOnHold((onHold) => {
      if (!onHold) {
        mutedBeforeHoldRef.current = call.isMuted();
        call.mute(true);
        setIsMuted(true);
        return true;
      }
      call.mute(mutedBeforeHoldRef.current);
      setIsMuted(mutedBeforeHoldRef.current);
      return false;
    });
  }, []);

  const sendDigit = useCallback((digit: string) => {
    callRef.current?.sendDigits(digit);
  }, []);

  // Teardown on unmount.
  useEffect(() => {
    return () => {
      clearRingTimeout();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      try {
        callRef.current?.disconnect();
        deviceRef.current?.destroy();
      } catch {
        // best-effort teardown
      }
      callRef.current = null;
      deviceRef.current = null;
    };
  }, []);

  return {
    state,
    statusText,
    identity,
    incoming,
    isMuted,
    isOnHold,
    callStartedAt,
    connectedTo,
    start,
    connect,
    connectConference,
    acceptIncoming,
    rejectIncoming,
    hangUp,
    toggleMute,
    toggleHold,
    sendDigit,
    setIncoming,
  };
}
