/**
 * The loud half of notifications: sound, and a popup you cannot miss.
 *
 * A service worker can show an OS notification but CANNOT play audio — only a
 * page can. sw.js used to message the page only for incoming calls, so the
 * work-clock prompt, the lead alarm and project updates arrived as a silent
 * system toast that is trivial to miss on a busy desktop. That is how people
 * ended up losing minutes to a prompt they never saw.
 *
 * So when any push lands and a tab is open, this does three things:
 *
 *   1. plays the alert sound at full volume
 *   2. REPEATS it a few times for alerts that cost someone money if missed
 *   3. puts a large card on screen that stays until it is acknowledged
 *
 * WHY REPEATING IS FAIR, NOT NAGGING. The work clock deducts time when a prompt
 * goes unanswered. A single quiet chime plus a 15-minute penalty is a bad trade
 * for the person on the other end. Making the prompt impossible to miss is what
 * makes the penalty defensible — accountability that depends on the alert
 * actually arriving. It stops the moment you acknowledge it, and it is capped,
 * so it can never become a siren nobody can silence.
 *
 * The repeat is deliberately NOT applied to routine project updates; those play
 * once. An alert that always screams is one people mute, and a muted channel is
 * how this whole class of problem started.
 */
import { AlertTriangle, Bell, Clock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNotificationSound } from "@/hooks/use-notification-sound";

type PushPayload = {
  type?: string;
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
};

/**
 * Alerts that cost someone time or money if missed. These repeat; everything
 * else chimes once.
 */
const URGENT_TAGS = new Set(["work-clock", "lead-flow"]);

/** How many extra times to sound an urgent alert, and how far apart. */
const REPEATS = 3;
const REPEAT_GAP_MS = 4000;

function isUrgent(payload: PushPayload): boolean {
  if (payload.tag && URGENT_TAGS.has(payload.tag)) return true;
  // The work-clock prompt is the one that costs money when missed.
  return /are you (still )?working/i.test(payload.title ?? payload.body ?? "");
}

export function PushAlerts() {
  const { play } = useNotificationSound();
  const [alert, setAlert] = useState<PushPayload | null>(null);
  const repeatTimer = useRef<number | null>(null);

  const stopRepeating = useCallback(() => {
    if (repeatTimer.current != null) {
      window.clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; payload?: PushPayload };
      if (data?.type !== "PUSH_RECEIVED") return;

      const payload = data.payload ?? {};
      // The dialer owns its own full-screen incoming-call UI and ringtone.
      // Stacking a second card over it would fight for the same click.
      if (payload.type === "incoming_call") return;

      play();
      setAlert(payload);

      if (isUrgent(payload)) {
        stopRepeating();
        let fired = 0;
        repeatTimer.current = window.setInterval(() => {
          fired += 1;
          if (fired > REPEATS) {
            stopRepeating();
            return;
          }
          play();
        }, REPEAT_GAP_MS);
      }
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      stopRepeating();
    };
  }, [play, stopRepeating]);

  if (!alert) return null;

  const urgent = isUrgent(alert);
  const Icon = urgent
    ? alert.tag === "lead-flow"
      ? AlertTriangle
      : Clock
    : Bell;

  const dismiss = () => {
    stopRepeating();
    setAlert(null);
  };

  return (
    // z-300: above the warning banners (z-200), which this must never hide behind.
    <div className="fixed inset-x-0 top-0 z-[300] flex justify-center p-4">
      <div
        role="alert"
        className={`flex w-full max-w-xl items-start gap-3 rounded-lg border p-4 shadow-2xl ${
          urgent
            ? "animate-pulse border-red-700 bg-red-600 text-white"
            : "border-border bg-card text-card-foreground"
        }`}
      >
        <Icon className="mt-0.5 size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{alert.title ?? "Notification"}</p>
          {alert.body ? (
            <p className="mt-0.5 text-sm opacity-90">{alert.body}</p>
          ) : null}
          {alert.url ? (
            <a
              href={alert.url}
              onClick={dismiss}
              className="mt-2 inline-block text-sm underline underline-offset-2"
            >
              Open
            </a>
          ) : null}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className={`shrink-0 rounded px-3 py-1 text-sm font-medium ${
            urgent
              ? "bg-white text-red-700 hover:bg-white/90"
              : "border border-border hover:bg-muted"
          }`}
        >
          Got it
        </button>
      </div>
    </div>
  );
}

export default PushAlerts;
