/**
 * App-wide Twilio Device.
 *
 * The device is registered ONCE, here, and mounted in the authenticated shell —
 * so an incoming call rings on whatever screen you happen to be on. This
 * mirrors the legacy architecture exactly: DialerProvider owns the device,
 * GlobalDialerRuntime is a pure consumer, and the /dialer page is another
 * consumer rather than the owner.
 *
 * It has to work this way. The new stack created the Device inside dialer.tsx,
 * so it only existed while that route was mounted — navigate to Leads and
 * Twilio has nobody registered to ring. The person who lives on the Leads board
 * all day is exactly the person who must not miss calls.
 *
 * Presence heartbeat lives here for the same reason: the voice webhook decides
 * whether an agent is available from it, and a heartbeat that only beats on one
 * route reports the whole team as offline the moment they navigate away.
 */
import { type Call, Device } from "@twilio/voice-sdk";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { getApiUrl } from "@/fetchers/get-api-url";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { toast } from "@/lib/toast";

export type DialerState = "idle" | "incoming" | "dialing" | "in-call";

/** Who is calling, as the voice webhook labelled the leg. */
export type IncomingCaller = {
  number: string;
  name: string | null;
  requirement: string | null;
};

type DialerContextValue = {
  ready: boolean;
  state: DialerState;
  incoming: Call | null;
  /** `incoming` decoded — name and requirement come from the TwiML parameters. */
  incomingCaller: IncomingCaller | null;
  /** True once the ringer has been silenced for THIS incoming call. */
  ringerSilenced: boolean;
  silenceRinger: () => void;
  activeCall: Call | null;
  muted: boolean;
  /** Number or client id the active call is connected to, for the widget. */
  connectedTo: string | null;
  callStartedAt: number | null;
  dial: (to: string) => Promise<void>;
  accept: () => void;
  reject: () => void;
  hangUp: () => void;
  toggleMute: () => void;
  /** Simulated hold — the Voice SDK has no native hold. See toggleHold. */
  held: boolean;
  toggleHold: () => void;
  sendDigit: (digit: string) => void;
};

const DialerContext = createContext<DialerContextValue | null>(null);

/** Presence beat interval. Matches the legacy dialer. */
const HEARTBEAT_MS = 25_000;

/**
 * When to re-read the call log after a call ends.
 *
 * The log is served from Twilio's REST API, not our table, and Twilio does not
 * finalise a call record the instant the media stops — status goes
 * `in-progress` to `completed` a beat later, and `duration` lands with it. One
 * refetch at t=0 therefore re-renders the SAME "Ringing" row it was trying to
 * replace, which is exactly what it looked like from the outside: the log never
 * updating. Refetching again a few seconds later costs two cheap requests and
 * makes the row settle on its own.
 */
const LOG_REFRESH_DELAYS_MS = [0, 1_500, 5_000, 12_000];

export function DialerProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const deviceRef = useRef<Device | null>(null);
  const [ready, setReady] = useState(false);
  const [incoming, setIncoming] = useState<Call | null>(null);
  const [ringerSilenced, setRingerSilenced] = useState(false);
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const mutedBeforeHold = useRef(false);
  const [connectedTo, setConnectedTo] = useState<string | null>(null);
  const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
  const [dialing, setDialing] = useState(false);
  const refreshTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Undefined until GET /api/config answers. Treated as "not yet", so the
  // device registers one round trip later rather than firing a request that is
  // known to fail on an instance without Twilio.
  const { data: config } = useGetConfig();
  const hasDialer = config?.hasDialer === true;

  /*
   * Refresh the call log after a call ends — from HERE, not from the dialer
   * page.
   *
   * The page owned this and invalidated ["dialer", "calls"], while the query it
   * meant to refresh is keyed ["dialer", "twilio-calls"]. TanStack matches key
   * prefixes element-by-element, so "calls" never matched "twilio-calls" and
   * the invalidation was a no-op: the log only moved when the 30s poll came
   * round, and a call that ended just after a poll sat on "Ringing" for most of
   * half a minute.
   *
   * It also belongs in the provider rather than the page because calls are
   * answered from any screen — the log has to be correct by the time you walk
   * back to it.
   */
  const refreshCallLog = useCallback(() => {
    for (const timer of refreshTimers.current) clearTimeout(timer);
    refreshTimers.current = LOG_REFRESH_DELAYS_MS.map((delay) =>
      setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: ["dialer", "twilio-calls"],
        });
      }, delay),
    );
  }, [queryClient]);

  useEffect(
    () => () => {
      for (const timer of refreshTimers.current) clearTimeout(timer);
    },
    [],
  );

  // Read through a ref so the device effect below stays mount-once — putting
  // the callback in its dependency array would tear down and re-register the
  // Twilio Device on any identity change, and a device that re-registers is a
  // device that misses calls.
  const refreshCallLogRef = useRef(refreshCallLog);
  refreshCallLogRef.current = refreshCallLog;

  useEffect(() => {
    // Nothing to register against when the instance has no Twilio credentials.
    // Asking anyway put a failed POST /api/dialer/token in the console on every
    // page load; the server already advertises this, so just do not ask.
    if (!hasDialer) return;

    let cancelled = false;
    let device: Device | null = null;

    (async () => {
      try {
        const response = await fetch(getApiUrl("dialer/token"), {
          method: "POST",
          credentials: "include",
        });
        // A member without dialer access gets a 403 here. That is not an error
        // worth a toast on every page load — they simply have no dialer.
        //
        // 503 is the same story from the other side: the instance has no Twilio
        // credentials yet, so there is nothing to register against. It was
        // painting a red POST /api/dialer/token on every single page load of
        // Dan's CRM, which reads as a broken app rather than an unconfigured
        // feature.
        if ([401, 403, 503].includes(response.status)) return;
        if (!response.ok) throw new Error(await response.text());
        const { token } = (await response.json()) as { token: string };
        if (cancelled) return;

        device = new Device(token, { logLevel: "error" });
        device.on("registered", () => setReady(true));
        device.on("error", (e: Error) => toast.error(e.message));
        device.on("incoming", (call: Call) => {
          // A previous call may have silenced the SDK ringer; every new call
          // starts audible again.
          try {
            device?.audio?.incoming(true);
          } catch {
            // no audio device — the on-screen card is still the alert
          }
          setRingerSilenced(false);
          setIncoming(call);
          // An unanswered call is a log row too ("Missed call"), so both endings
          // refresh it.
          call.on("cancel", () => {
            setIncoming(null);
            refreshCallLogRef.current();
          });
          call.on("disconnect", () => {
            setIncoming(null);
            refreshCallLogRef.current();
          });
        });

        await device.register();
        deviceRef.current = device;
      } catch (e) {
        if (!cancelled) {
          toast.error(
            e instanceof Error ? e.message : "Could not start the dialer",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      device?.destroy();
      deviceRef.current = null;
    };
    // hasDialer only: the effect must re-run once when config arrives, and
    // nothing else may re-register the device — a device that re-registers is a
    // device that misses calls.
  }, [hasDialer]);

  // Presence heartbeat — the voice webhook reads this to know an agent is here.
  useEffect(() => {
    if (!ready) return;
    const beat = () =>
      fetch(getApiUrl("dialer/presence/heartbeat"), {
        method: "POST",
        credentials: "include",
      }).catch(() => {});
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [ready]);

  const attachCall = useCallback(
    (call: Call, to: string | null) => {
      setActiveCall(call);
      setConnectedTo(to);
      setCallStartedAt(Date.now());
      setMuted(false);
      setHeld(false);
      call.on("disconnect", () => {
        setActiveCall(null);
        setConnectedTo(null);
        setCallStartedAt(null);
        setDialing(false);
        setHeld(false);
        refreshCallLog();
      });
    },
    [refreshCallLog],
  );

  const dial = useCallback(
    async (to: string) => {
      const device = deviceRef.current;
      if (!device) {
        toast.error("The dialer is not ready yet");
        return;
      }
      setDialing(true);
      try {
        const call = await device.connect({ params: { To: to } });
        attachCall(call, to);
      } catch (e) {
        setDialing(false);
        toast.error(e instanceof Error ? e.message : "Could not place the call");
      }
    },
    [attachCall],
  );

  const accept = useCallback(() => {
    if (!incoming) return;
    incoming.accept();
    attachCall(incoming, incoming.parameters.From ?? null);
    setIncoming(null);
  }, [incoming, attachCall]);

  const reject = useCallback(() => {
    incoming?.reject();
    setIncoming(null);
    refreshCallLog();
  }, [incoming, refreshCallLog]);

  /*
   * Stop the ring without touching the call — the caller keeps ringing on their
   * end and Accept still works.
   *
   * Both ringers have to go or the button lies: ours (Web Audio, in
   * GlobalDialerRuntime) and the SDK's, which plays independently. `incoming`
   * is re-enabled when the next call arrives, so this is per-call, not a
   * setting someone can leave off by accident.
   */
  const silenceRinger = useCallback(() => {
    setRingerSilenced(true);
    try {
      deviceRef.current?.audio?.incoming(false);
    } catch {
      // the Web Audio ring is silenced regardless
    }
  }, []);

  const hangUp = useCallback(() => {
    activeCall?.disconnect();
    deviceRef.current?.disconnectAll();
  }, [activeCall]);

  const toggleMute = useCallback(() => {
    if (!activeCall) return;
    const next = !muted;
    activeCall.mute(next);
    setMuted(next);
  }, [activeCall, muted]);

  // Simulated hold, same trick the legacy dialer used (the Voice SDK has no
  // native hold): mute for the duration and restore the PREVIOUS mute state on
  // resume, so holding while muted does not silently unmute you afterwards.
  const toggleHold = useCallback(() => {
    if (!activeCall) return;
    setHeld((onHold) => {
      if (!onHold) {
        mutedBeforeHold.current = activeCall.isMuted();
        activeCall.mute(true);
        setMuted(true);
        return true;
      }
      activeCall.mute(mutedBeforeHold.current);
      setMuted(mutedBeforeHold.current);
      return false;
    });
  }, [activeCall]);

  const sendDigit = useCallback(
    (digit: string) => activeCall?.sendDigits(digit),
    [activeCall],
  );

  const state: DialerState = incoming
    ? "incoming"
    : activeCall
      ? "in-call"
      : dialing
        ? "dialing"
        : "idle";

  /*
   * The voice webhook already looked this caller up and attached the result as
   * <Client> parameters (contactName / contactRequirement). Nothing read them,
   * so every incoming call announced itself as a bare E.164 number even when
   * the CRM knew exactly who it was.
   */
  const incomingCaller: IncomingCaller | null = incoming
    ? {
        number: incoming.parameters.From ?? "Unknown",
        name: incoming.customParameters.get("contactName") ?? null,
        requirement: incoming.customParameters.get("contactRequirement") ?? null,
      }
    : null;

  return (
    <DialerContext.Provider
      value={{
        ready,
        state,
        incoming,
        incomingCaller,
        ringerSilenced,
        silenceRinger,
        activeCall,
        muted,
        connectedTo,
        callStartedAt,
        dial,
        accept,
        reject,
        hangUp,
        toggleMute,
        held,
        toggleHold,
        sendDigit,
      }}
    >
      {children}
    </DialerContext.Provider>
  );
}

export function useDialer() {
  const ctx = useContext(DialerContext);
  if (!ctx) {
    throw new Error("useDialer must be used inside a DialerProvider");
  }
  return ctx;
}

export default DialerProvider;
