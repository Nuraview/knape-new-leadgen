/**
 * The incoming-call card.
 *
 * This is the whole alert, on every authenticated screen INCLUDING /dialer.
 * Before, a ringing call was a 40px tinted strip wedged under the dialer's
 * header — the same visual weight as a dismissed banner, on the one page where
 * a call matters most — and off /dialer it was a plain box with the raw E.164
 * number and two flat buttons. A phone ringing is the single most time-critical
 * thing the CRM ever shows; it gets the screen.
 *
 * It is presentation only. The device, the ringtone and the call state all live
 * in DialerProvider, so this renders the same whichever route is mounted.
 */
import { Phone, PhoneOff, User, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { useDialer } from "./dialer-provider";

/**
 * Two initials from a contact name, for the avatar. Falls back to a person
 * glyph when the caller is not in the CRM.
 */
function initials(name: string | null): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || null;
}

/** `+919606279622` reads as a phone number with the groups broken up. */
function prettyNumber(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits.startsWith("+") || digits.length < 8) return raw;
  return digits.replace(/^(\+\d{1,3})(\d{2,5})(\d+)$/, "$1 $2 $3");
}

function ringingFor(since: number): string {
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function IncomingCallDialog() {
  const { incomingCaller, accept, reject, ringerSilenced, silenceRinger } =
    useDialer();

  // Ringing since this card first appeared. Not the call's real start — the
  // browser only learns about the call when the SDK hands it over — but it is
  // the number the person looking at the screen cares about.
  const [since, setSince] = useState(() => Date.now());
  const [, setTick] = useState(0);

  const number = incomingCaller?.number ?? null;
  useEffect(() => {
    if (!number) return;
    setSince(Date.now());
  }, [number]);

  useEffect(() => {
    if (!incomingCaller) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [incomingCaller]);

  /*
   * Enter answers, Escape declines. Someone who is already typing is exactly
   * the person who does not want to reach for the mouse — and these are the two
   * keys every softphone binds.
   */
  useEffect(() => {
    if (!incomingCaller) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        accept();
      } else if (event.key === "Escape") {
        event.preventDefault();
        reject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [incomingCaller, accept, reject]);

  if (!incomingCaller) return null;

  const badge = initials(incomingCaller.name);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Incoming call from ${incomingCaller.name ?? incomingCaller.number}`}
      // z-[300]: above the in-call widget (z-200) and every sheet/dialog in the
      // app, so nothing an agent happens to have open can cover a ringing call.
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-border bg-card shadow-2xl">
        <div className="flex flex-col items-center px-8 pb-7 pt-9 text-center">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-600 dark:text-emerald-400">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            Incoming call
          </div>

          {/* Avatar with the ring pulsing out of it — the motion is what catches
              the eye of someone whose attention is on another window. */}
          <div className="relative mt-6 flex size-24 items-center justify-center">
            <span className="absolute size-24 animate-ping rounded-full bg-emerald-500/20 [animation-duration:1.8s]" />
            <span className="absolute size-20 rounded-full bg-emerald-500/10" />
            <span className="relative flex size-20 items-center justify-center rounded-full bg-emerald-600 text-2xl font-semibold text-white shadow-lg">
              {badge ?? <User className="size-9" />}
            </span>
          </div>

          <p className="mt-5 w-full truncate text-2xl font-semibold leading-tight">
            {incomingCaller.name ?? prettyNumber(incomingCaller.number)}
          </p>
          {incomingCaller.name ? (
            <p className="mt-1 text-sm tabular-nums text-muted-foreground">
              {prettyNumber(incomingCaller.number)}
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Unknown caller</p>
          )}

          {incomingCaller.requirement ? (
            <span className="mt-3 max-w-full truncate rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              {incomingCaller.requirement}
            </span>
          ) : null}

          <p className="mt-4 text-xs tabular-nums text-muted-foreground">
            Ringing {ringingFor(since)}
          </p>

          <div className="mt-7 flex w-full items-start justify-center gap-10">
            <button
              type="button"
              onClick={reject}
              className="group flex flex-col items-center gap-2"
            >
              <span className="flex size-16 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg transition group-hover:bg-rose-700 group-active:scale-95">
                <PhoneOff className="size-6" />
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Decline
              </span>
            </button>

            <button
              type="button"
              onClick={accept}
              autoFocus
              className="group flex flex-col items-center gap-2"
            >
              {/* Halo rather than a bouncing button: the eye still catches the
                  motion, and the hit target does not move under the cursor. */}
              <span className="relative flex size-16 items-center justify-center">
                <span className="absolute size-16 animate-ping rounded-full bg-emerald-500/40 [animation-duration:1.6s]" />
                <span className="relative flex size-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg transition group-hover:bg-emerald-700 group-active:scale-95">
                  <Phone className="size-6" />
                </span>
              </span>
              <span className="text-xs font-medium text-muted-foreground">
                Answer
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={silenceRinger}
            disabled={ringerSilenced}
            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          >
            <VolumeX className="size-3.5" />
            {ringerSilenced ? "Ringer silenced" : "Silence ringer"}
          </button>
          <span className="text-[11px] text-muted-foreground">
            Enter to answer · Esc to decline
          </span>
        </div>
      </div>
    </div>
  );
}

export default IncomingCallDialog;
