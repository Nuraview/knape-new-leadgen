/**
 * Audible alert. Ported verbatim from knape-dashboard at VK's request —
 * same sound file, same hook. "A simple beep won't suffice."
 *
 * Plays /sounds/notification.mp3 on project updates and on the work-clock
 * prompt. The prompt case matters most: people were being docked 15 minutes
 * for missing a prompt they could not hear.
 *
 * Three problems this hook has to solve, all of which "naive `new Audio()`
 * + .play()" would get wrong:
 *
 *  1. Browser autoplay policy. Chrome/Safari/Firefox reject .play() until
 *     the document has received at least one user gesture. The first call
 *     after a cold tab load WILL throw. We swallow it silently — sounds
 *     work from the user's next interaction onward.
 *
 *  2. Burst suppression. A sales person mass-creating proformas would
 *     otherwise produce a 5-shot machine-gun alert. We throttle to one
 *     play per `DEBOUNCE_MS`.
 *
 *  3. User preference + persistence. A mute toggle lives in the bell
 *     popover header; the choice persists across sessions via
 *     localStorage so refresh doesn't surprise the user.
 *
 * The audio element is created once on mount, preloaded eagerly, and
 * reused on every play — recreating per call would re-download the file
 * and miss the first ~100ms of the buffer on slow networks.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const SOUND_URL = "/sounds/notification.mp3";
const STORAGE_KEY = "nuraview-notification-sound-enabled";
const DEBOUNCE_MS = 800;

function readStoredPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true; // Default ON for booking teams.
    return raw === "1";
  } catch {
    return true;
  }
}

function persistPreference(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Quota-exceeded / safari-private — just lose the preference on refresh.
  }
}

export interface NotificationSoundApi {
  /**
   * Play the alert. No-op if disabled, still within the debounce window,
   * or autoplay was blocked by the browser (the rejection is swallowed
   * — sound will work after the user's first page gesture).
   */
  play: () => void;
  enabled: boolean;
  setEnabled: (value: boolean) => void;
}

export function useNotificationSound(): NotificationSoundApi {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastPlayedAtRef = useRef<number>(0);
  const [enabled, setEnabledState] = useState<boolean>(() =>
    readStoredPreference()
  );

  // One Audio per mount. We DO NOT recreate this per play — would re-fetch
  // the file and add latency. preload="auto" buffers it during idle time
  // after first render so the first real .play() is instant.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const a = new Audio(SOUND_URL);
    a.preload = "auto";
    a.volume = 1.0; // Browser maximum. System volume governs from here.
    audioRef.current = a;

    /*
     * PRIME THE AUDIO ON THE FIRST GESTURE.
     *
     * Browsers block programmatic playback until the user has interacted with
     * the page. A notification arriving on a freshly loaded tab would therefore
     * be SILENT — the exact case that matters, since the whole point is to
     * catch someone who is not looking.
     *
     * Playing muted once on the first click/keypress satisfies the gesture
     * requirement and unblocks every later play(). It is inaudible, so nobody
     * notices it happening.
     */
    const unlock = () => {
      const el = audioRef.current;
      if (!el) return;
      const restore = el.muted;
      el.muted = true;
      el.play()
        .then(() => {
          el.pause();
          el.currentTime = 0;
          el.muted = restore;
        })
        .catch(() => {
          el.muted = restore;
        });
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      // Detach so the buffer can be GC'd. Pausing first avoids a stuck
      // playback on hot-reload during dev.
      try {
        a.pause();
      } catch {
        // Ignore — element might already be in an unrecoverable state.
      }
      audioRef.current = null;
    };
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    persistPreference(value);
  }, []);

  const play = useCallback(() => {
    if (!enabled) return;
    const a = audioRef.current;
    if (!a) return;

    const now = Date.now();
    if (now - lastPlayedAtRef.current < DEBOUNCE_MS) return;
    lastPlayedAtRef.current = now;

    // Rewind so successive plays (after the debounce window) start from
    // the beginning even if the prior play was interrupted.
    try {
      a.currentTime = 0;
    } catch {
      // Some browsers throw if the element isn't ready yet — fine,
      // .play() below will handle it.
    }

    // .play() returns a Promise that REJECTS when autoplay is blocked
    // (NotAllowedError) or when the resource hasn't loaded
    // (NotSupportedError). Both are non-fatal — we don't want a console
    // error every time the user opens the app in a fresh tab.
    let result: Promise<void> | undefined;
    try {
      result = a.play();
    } catch {
      // Synchronous throw on very old engines. Same response: ignore.
      return;
    }
    if (result && typeof result.catch === "function") {
      result.catch(() => {
        // Expected on cold tab loads before the user has interacted.
      });
    }
  }, [enabled]);

  return { play, enabled, setEnabled };
}
