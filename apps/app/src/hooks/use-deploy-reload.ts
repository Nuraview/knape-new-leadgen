/**
 * Notice a deploy and get the browser onto the new build.
 *
 * THE PROBLEM: the SPA is a bundle. Once it is running, a `git push` changes
 * nothing for anyone who already has the tab open — they keep executing the old
 * JavaScript until they happen to hard-reload. So a fix ships, the owner is told
 * it shipped, and the team says nothing changed. Worse, once old chunks are
 * pruned from the server a lazy route can 404 mid-navigation and the app dies
 * in a way that looks random.
 *
 * HOW WE DETECT IT, without a new build-time variable:
 * Vite content-hashes the entry bundle, so index.html names a different script
 * after every deploy (`/assets/index-pgahHgTO.js` -> `/assets/index-XXXX.js`).
 * Fetching index.html and comparing that filename to the one THIS page is
 * running is a reliable "is there a newer build" signal that needs no version
 * endpoint, no env var and no cooperation from the API.
 *
 * That matters: baking a version in at build time is exactly the mechanism that
 * silently broke the Projects page when a build ARG disappeared. This reads
 * something the build cannot forget to emit.
 *
 * WHEN WE RELOAD — and this is the important half:
 *
 *   tab hidden        -> reload immediately. Nobody is looking, nothing is lost,
 *                        and they return to the new version having noticed
 *                        nothing. This is where almost every reload happens.
 *   tab visible, idle -> reload after a quiet period with no typing.
 *   tab visible, busy -> DO NOT reload. Show a banner and let them choose.
 *
 * Reloading a focused tab mid-sentence would destroy a half-written lead or a
 * proposal, which is a far worse bug than the stale bundle it fixes. An
 * auto-updater that eats work gets switched off, and then nobody gets updates
 * at all.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** How often to look. Cheap: one conditional GET of a small HTML file. */
const CHECK_INTERVAL_MS = 60_000;

/** Quiet period before reloading a visible tab. */
const IDLE_BEFORE_RELOAD_MS = 30_000;

/** Pull the hashed entry-script filename out of an index.html document. */
function entryScriptFrom(html: string): string | null {
  // Deliberately a regex rather than DOMParser: parsing the document would let
  // the browser start prefetching the new build's assets as a side effect.
  const match = html.match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/);
  return match?.[1] ?? null;
}

/** The entry script THIS page is running. */
function currentEntryScript(): string | null {
  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'),
  );
  const entry = scripts.find((s) => /\/assets\/index-.*\.js$/.test(s.src));
  if (!entry) return null;
  try {
    return new URL(entry.src).pathname;
  } catch {
    return entry.src;
  }
}

export function useDeployReload() {
  const [updateReady, setUpdateReady] = useState(false);
  const lastActivity = useRef(Date.now());
  const reloading = useRef(false);

  const reload = useCallback(() => {
    if (reloading.current) return;
    reloading.current = true;
    // replace(), not reload(): the current URL is re-requested without adding a
    // history entry, so Back still goes where the user expects.
    window.location.replace(window.location.href);
  }, []);

  // Any interaction counts as "busy". Passive listeners so this cannot affect
  // scroll performance.
  useEffect(() => {
    const touch = () => {
      lastActivity.current = Date.now();
    };
    const events = ["keydown", "pointerdown", "input", "scroll"] as const;
    for (const e of events) {
      window.addEventListener(e, touch, { passive: true });
    }
    return () => {
      for (const e of events) window.removeEventListener(e, touch);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const mine = currentEntryScript();
    // No hashed entry (dev server) — nothing meaningful to compare.
    if (!mine) return;

    async function check() {
      try {
        const response = await fetch(`/?_v=${Date.now()}`, {
          cache: "no-store",
          headers: { Accept: "text/html" },
        });
        if (!response.ok) return;
        const theirs = entryScriptFrom(await response.text());
        if (cancelled || !theirs || theirs === mine) return;

        setUpdateReady(true);

        // Hidden tab: take it now, silently.
        if (document.visibilityState === "hidden") {
          reload();
          return;
        }
        // Visible but untouched for a while: safe to take.
        if (Date.now() - lastActivity.current > IDLE_BEFORE_RELOAD_MS) {
          reload();
        }
      } catch {
        // Offline or a blip. Try again next tick; never surface this.
      }
    }

    const timer = setInterval(check, CHECK_INTERVAL_MS);
    // Check on return to the tab too — the common case is "came back after a
    // deploy", and waiting up to a minute for the interval wastes it.
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
      else if (updateReady) reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    void check();

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload, updateReady]);

  return { updateReady, reload };
}

export default useDeployReload;
