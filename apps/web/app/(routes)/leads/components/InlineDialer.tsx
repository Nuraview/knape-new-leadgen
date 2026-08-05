"use client";

// Compact inline dialer embedded directly in the lead drawer. Uses the same
// useTwilioDevice hook as the dedicated /dialer page, but renders as a minimal
// call-control strip instead of a full panel. Auto-starts the Twilio device
// on mount so the user just clicks a phone number to call.

import { useCallback, useEffect, useState } from "react";
import {
  Grid3x3,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneOff,
  Play,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Keypad } from "../../dialer/components/Keypad";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { useDialer } from "../../dialer/components/DialerProvider";

// ---------------------------------------------------------------------------
// Timer display
// ---------------------------------------------------------------------------
function CallTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((now - startedAt) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return <span className="font-mono tabular-nums text-sm">{mm}:{ss}</span>;
}

// ---------------------------------------------------------------------------
// InlineDialer
// ---------------------------------------------------------------------------
export function InlineDialer({
  phones,
  leadName,
}: {
  /** One or two phone numbers (primary, secondary). */
  phones: string[];
  /** Lead / company name for the confirm dialog and connected-to label. */
  leadName?: string;
}) {
  const {
    state,
    statusText,
    start,
    connect,
    hangUp,
    toggleMute,
    toggleHold,
    isMuted,
    isOnHold,
    callStartedAt,
    connectedTo,
    incoming,
    accept,
    reject,
    sendDigit,
  } = useDialer();

  // Device is auto-started by DialerProvider — nothing to start here.

  // Confirm-before-dial state.
  const [confirmNumber, setConfirmNumber] = useState<string | null>(null);
  // DTMF keypad toggle — for navigating IVR menus mid-call ("press 1 for…").
  const [showKeypad, setShowKeypad] = useState(false);

  const handleCall = useCallback(
    (phone: string) => {
      if (state !== "ready") return;
      setConfirmNumber(phone);
    },
    [state],
  );

  const doCall = useCallback(() => {
    if (!confirmNumber) return;
    setConfirmNumber(null);
    connect(confirmNumber, leadName);
  }, [confirmNumber, connect, leadName]);

  const inCall = state === "in-call";
  const dialing = state === "dialing";
  const busy = inCall || dialing;

  // Incoming call UI (compact)
  if (state === "incoming" && incoming) {
    return (
      <div className="rounded-md border border-blue-500/40 bg-blue-500/5 p-3 space-y-2">
        <div className="text-sm font-medium">
          📞 Incoming: {incoming.contactName || incoming.from}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700"
            onClick={accept}
          >
            <Phone className="size-3 mr-1" /> Accept
          </Button>
          <Button size="sm" variant="destructive" onClick={reject}>
            <PhoneOff className="size-3 mr-1" /> Decline
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border p-3 space-y-2">
        {/* Status line */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Dialer</span>
          <span
            className={`text-xs px-1.5 py-0.5 rounded-full border ${
              state === "ready"
                ? "bg-green-100 text-green-800 border-green-300"
                : state === "error"
                  ? "bg-red-100 text-red-800 border-red-300"
                  : state === "initializing"
                    ? "bg-yellow-100 text-yellow-800 border-yellow-300"
                    : busy
                      ? "bg-green-100 text-green-800 border-green-300"
                      : "bg-muted text-muted-foreground border-muted"
            }`}
          >
            {state === "ready"
              ? "Ready"
              : state === "initializing"
                ? "Connecting…"
                : busy
                  ? "On call"
                  : state === "error"
                    ? "Error"
                    : statusText}
          </span>
        </div>

        {/* Call buttons (one per phone number) */}
        {!busy && (
          <div className="flex flex-wrap gap-2">
            {phones.map((p) => (
              <Button
                key={p}
                size="sm"
                variant="outline"
                disabled={state !== "ready"}
                onClick={() => handleCall(p)}
                className="text-xs"
              >
                <Phone className="size-3 mr-1" />
                Call {p}
              </Button>
            ))}
          </div>
        )}

        {/* In-call controls */}
        {busy && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-sm">
              {connectedTo && (
                <span className="text-muted-foreground truncate">
                  {connectedTo}
                </span>
              )}
              {callStartedAt && <CallTimer startedAt={callStartedAt} />}
              {dialing && (
                <span className="text-yellow-600 text-xs animate-pulse">
                  Ringing…
                </span>
              )}
              {isOnHold && (
                <span className="text-yellow-600 text-xs font-medium">
                  On hold
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={isMuted ? "default" : "outline"}
                onClick={toggleMute}
                disabled={isOnHold}
              >
                {isMuted ? (
                  <MicOff className="size-3 mr-1" />
                ) : (
                  <Mic className="size-3 mr-1" />
                )}
                {isMuted ? "Unmute" : "Mute"}
              </Button>
              <Button
                size="sm"
                variant={isOnHold ? "default" : "outline"}
                onClick={toggleHold}
              >
                {isOnHold ? (
                  <Play className="size-3 mr-1" />
                ) : (
                  <Pause className="size-3 mr-1" />
                )}
                {isOnHold ? "Resume" : "Hold"}
              </Button>
              <Button size="sm" variant="destructive" onClick={hangUp}>
                <PhoneOff className="size-3 mr-1" />
                {dialing ? "Cancel" : "Hang up"}
              </Button>
              <Button
                size="sm"
                variant={showKeypad ? "default" : "outline"}
                onClick={() => setShowKeypad((v) => !v)}
              >
                <Grid3x3 className="size-3 mr-1" />
                Keypad
              </Button>
            </div>
            {/* DTMF dialpad — stays in-place during the call so the user can
                punch IVR options ("press 1 for marketing") without leaving the
                lead card. */}
            {showKeypad && (
              <div className="max-w-[15rem]">
                <Keypad onKey={sendDigit} />
              </div>
            )}
          </div>
        )}

        {/* Error: show restart */}
        {state === "error" && (
          <Button size="sm" variant="outline" onClick={() => start()}>
            <Phone className="size-3 mr-1" /> Restart dialer
          </Button>
        )}
      </div>

      {/* Confirm-before-dial dialog */}
      <Dialog
        open={confirmNumber !== null}
        onOpenChange={(o) => !o && setConfirmNumber(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm call</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-1 py-2">
            {leadName && <p className="text-lg font-semibold">{leadName}</p>}
            <p className="font-mono text-xl">{confirmNumber}</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmNumber(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-green-600 hover:bg-green-700"
              onClick={doCall}
            >
              <Phone className="size-4 mr-2" />
              Call now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
