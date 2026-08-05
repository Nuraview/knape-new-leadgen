/**
 * The call UI on every authenticated screen.
 *
 * Pure consumer of DialerProvider — it does NOT own the device. An active call
 * gets a floating widget so you can keep working the board while you talk.
 *
 * Ported from apps/web/app/(routes)/dialer/components/GlobalDialerRuntime.tsx,
 * including the "hidden on /dialer" rule — that page renders the full dialer
 * itself and would otherwise show two sets of controls for one call.
 *
 * That rule stops at the INCOMING card, which now renders everywhere. It was
 * suppressed on /dialer on the theory that the page shows the call itself, but
 * what the page showed was a thin tinted strip under the header — so the one
 * screen an agent sits on all day had the weakest ring alert in the app. The
 * card is the alert now; the page's strip is gone.
 */
import { useLocation } from "@tanstack/react-router";
import { Grid3x3, Mic, MicOff, Pause, PhoneOff, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useDialer } from "./dialer-provider";
import { IncomingCallDialog } from "./incoming-call-dialog";
import { Keypad } from "./keypad";
import { useRingtone } from "@/hooks/use-ringtone";

function elapsed(since: number | null) {
  if (!since) return "0:00";
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function GlobalDialerRuntime() {
  const { pathname } = useLocation();
  const {
    state,
    ringerSilenced,
    muted,
    held,
    connectedTo,
    callStartedAt,
    hangUp,
    toggleMute,
    toggleHold,
    sendDigit,
  } = useDialer();
  const [keypadOpen, setKeypadOpen] = useState(false);

  // Re-render once a second so the call timer moves.
  const { start: startRing, stop: stopRing } = useRingtone();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (state !== "in-call") return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  /*
   * Ring + VIBRATE while a call is incoming. The Twilio SDK already plays its
   * own ringtone (we never disabled it), so the value here is the vibration and
   * the louder cadence — the part that reaches a phone in a pocket.
   */
  useEffect(() => {
    if (state !== "incoming" || ringerSilenced) {
      stopRing();
      return;
    }
    startRing();
    return stopRing;
  }, [state, ringerSilenced, startRing, stopRing]);

  // The ringing card comes FIRST and is not route-scoped: it has to appear on
  // /dialer too, which the early return below deliberately excludes.
  if (state === "incoming") return <IncomingCallDialog />;

  // The /dialer page renders its own controls for a call already in progress.
  if (pathname.startsWith("/dialer")) return null;
  if (state === "idle") return null;

  /*
   * TOP-CENTER, not a corner (meeting 2026-07-30). VK: "the dialer would be so
   * small here on the right … I just want it on the top, just like how it was
   * before." A live call is the most important thing on the screen — it hangs
   * from the top edge where nothing else lives, wider, and with the full
   * control set (hold and the IVR keypad included, not just mute/hang-up).
   */
  return (
    <div className="fixed left-1/2 top-3 z-[200] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2">
      <div
        className={`rounded-xl border-2 bg-card p-4 shadow-2xl ${
          state === "dialing"
            ? "animate-pulse border-amber-500"
            : "border-emerald-600"
        }`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide">
            {state === "dialing" ? "Calling…" : held ? "On hold" : "On call"}
          </p>
          {state === "in-call" ? (
            <span className="text-sm font-semibold tabular-nums">
              {elapsed(callStartedAt)}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">
          {connectedTo ?? "—"}
        </p>
        <div className="mt-3 flex gap-2">
          <Button
            variant={muted ? "default" : "outline"}
            size="sm"
            className="flex-1"
            onClick={toggleMute}
            disabled={state !== "in-call" || held}
          >
            {muted ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
            {muted ? "Unmute" : "Mute"}
          </Button>
          <Button
            variant={held ? "default" : "outline"}
            size="sm"
            className="flex-1"
            onClick={toggleHold}
            disabled={state !== "in-call"}
          >
            {held ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {held ? "Resume" : "Hold"}
          </Button>
          <Button
            variant={keypadOpen ? "default" : "outline"}
            size="sm"
            onClick={() => setKeypadOpen((v) => !v)}
            disabled={state !== "in-call"}
            title="Keypad (IVR)"
          >
            <Grid3x3 className="size-3.5" />
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="flex-1"
            onClick={hangUp}
          >
            <PhoneOff className="size-3.5" />
            Hang up
          </Button>
        </div>
        {keypadOpen && state === "in-call" ? (
          <div className="mx-auto mt-3 max-w-[15rem]">
            <Keypad onKey={sendDigit} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default GlobalDialerRuntime;
