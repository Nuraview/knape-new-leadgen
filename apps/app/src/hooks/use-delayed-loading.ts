import { useEffect, useState } from "react";

/**
 * True only once `loading` has been continuously true for `delayMs`.
 *
 * Ported from the lead-gen cockpit's own frontend (knape-leadgen
 * frontend/src/hooks/useDelayedLoading.ts), which drives the same list against
 * the same data, so the two surfaces behave identically.
 *
 * The delay is the whole point. A proxied /api/accounts served from cache comes
 * back in tens of milliseconds, and an overlay shown for one frame reads as a
 * flicker rather than as progress — worse than showing nothing. Past ~280ms a
 * request is slow enough that silence starts to read as a broken page instead,
 * which is exactly what a 5,889-row fetch through the Vercel proxy feels like
 * while contact enrichment is running upstream.
 *
 * The timer is cleared on the way out, so a fetch that finishes inside the
 * window never shows the overlay at all.
 */
export function useDelayedLoading(loading: boolean, delayMs = 280): boolean {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!loading) {
      setShow(false);
      return;
    }
    const id = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(id);
  }, [loading, delayMs]);

  return show;
}
