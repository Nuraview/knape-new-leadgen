/**
 * Compact dialer embedded in the lead drawer — call the lead without leaving
 * the card. Ported 1:1 from crmx1's InlineDialer.tsx (meeting 2026-07-30:
 * "the calling dialer in lead card detail page should exactly be like old
 * crm"): the Ready/Connecting status pill, one Call button per number, the
 * confirm-before-dial dialog, and in-call Mute / Hold / Hang up / Keypad with
 * the DTMF pad inline so IVR menus can be navigated from the card.
 *
 * Consumes the app-wide DialerProvider rather than owning a device — the
 * device is registered once in the authenticated shell, so a call started
 * here keeps ringing/talking when the drawer closes (the floating widget
 * takes over).
 */
import {
  Grid3x3,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneOff,
  Play,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useDialer } from "@/components/dialer/dialer-provider";
import { Keypad } from "@/components/dialer/keypad";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function CallTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((now - startedAt) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return (
    <span className="font-mono text-sm tabular-nums">
      {mm}:{ss}
    </span>
  );
}

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
    ready,
    state,
    incoming,
    muted,
    held,
    connectedTo,
    callStartedAt,
    dial,
    accept,
    reject,
    hangUp,
    toggleMute,
    toggleHold,
    sendDigit,
  } = useDialer();

  // Confirm-before-dial state.
  const [confirmNumber, setConfirmNumber] = useState<string | null>(null);
  // DTMF keypad toggle — for navigating IVR menus mid-call ("press 1 for…").
  const [showKeypad, setShowKeypad] = useState(false);

  const doCall = useCallback(() => {
    if (!confirmNumber) return;
    const number = confirmNumber;
    setConfirmNumber(null);
    void dial(number);
  }, [confirmNumber, dial]);

  const inCall = state === "in-call";
  const dialing = state === "dialing";
  const busy = inCall || dialing;

  // Incoming call UI (compact)
  if (state === "incoming" && incoming) {
    return (
      <div className="space-y-2 rounded-md border border-blue-500/40 bg-blue-500/5 p-3">
        <div className="text-sm font-medium">
          📞 Incoming: {incoming.parameters.From ?? "Unknown"}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            className="bg-green-600 text-white hover:bg-green-700"
            onClick={accept}
          >
            <Phone className="mr-1 size-3" /> Accept
          </Button>
          <Button size="sm" variant="destructive" onClick={reject}>
            <PhoneOff className="mr-1 size-3" /> Decline
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2 rounded-md border border-border p-3">
        {/* Status line */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Dialer</span>
          <span
            className={`rounded-full border px-1.5 py-0.5 text-xs ${
              busy || ready
                ? "border-green-300 bg-green-100 text-green-800 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-300"
                : "border-yellow-300 bg-yellow-100 text-yellow-800 dark:border-yellow-900/40 dark:bg-yellow-900/20 dark:text-yellow-300"
            }`}
          >
            {busy ? "On call" : ready ? "Ready" : "Connecting…"}
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
                disabled={!ready}
                onClick={() => setConfirmNumber(p)}
                className="text-xs"
              >
                <Phone className="mr-1 size-3" />
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
                <span className="truncate text-muted-foreground">
                  {connectedTo}
                </span>
              )}
              {callStartedAt && <CallTimer startedAt={callStartedAt} />}
              {dialing && (
                <span className="animate-pulse text-xs text-yellow-600">
                  Ringing…
                </span>
              )}
              {held && (
                <span className="text-xs font-medium text-yellow-600">
                  On hold
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={muted ? "default" : "outline"}
                onClick={toggleMute}
                disabled={held}
              >
                {muted ? (
                  <MicOff className="mr-1 size-3" />
                ) : (
                  <Mic className="mr-1 size-3" />
                )}
                {muted ? "Unmute" : "Mute"}
              </Button>
              <Button
                size="sm"
                variant={held ? "default" : "outline"}
                onClick={toggleHold}
              >
                {held ? (
                  <Play className="mr-1 size-3" />
                ) : (
                  <Pause className="mr-1 size-3" />
                )}
                {held ? "Resume" : "Hold"}
              </Button>
              <Button size="sm" variant="destructive" onClick={hangUp}>
                <PhoneOff className="mr-1 size-3" />
                {dialing ? "Cancel" : "Hang up"}
              </Button>
              <Button
                size="sm"
                variant={showKeypad ? "default" : "outline"}
                onClick={() => setShowKeypad((v) => !v)}
              >
                <Grid3x3 className="mr-1 size-3" />
                Keypad
              </Button>
            </div>
            {/* DTMF dialpad — stays in place during the call so IVR options
                can be punched without leaving the lead card. */}
            {showKeypad && (
              <div className="max-w-[15rem]">
                <Keypad onKey={sendDigit} />
              </div>
            )}
          </div>
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
              className="bg-green-600 text-white hover:bg-green-700"
              onClick={doCall}
            >
              <Phone className="mr-2 size-4" />
              Call now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default InlineDialer;
