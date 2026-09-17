/**
 * Service-worker registration for the whole app.
 *
 * WHY THIS EXISTS SEPARATELY FROM PUSH.
 *
 * /sw.js was only ever registered from usePushNotifications, which mounts at
 * the _authenticated route boundary. So the worker — and with it the app
 * shell, offline support and, on Chrome, the install prompt itself, which is
 * withheld until a worker with a fetch handler is controlling the page — did
 * not exist until someone had signed in. Installing the app is something you
 * do from the sign-in screen, and a launch from the home screen starts there
 * too. Registering at bootstrap means the shell is cached before the first
 * authenticated render rather than after it.
 *
 * register() is idempotent for a given script URL and scope, so the push hook
 * can go on calling it; whichever runs first wins and the other gets the same
 * registration back.
 */

/** Registration is a no-op where the API does not exist (older Safari, http). */
function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    // A worker can only be installed from a secure context. localhost counts
    // as one, which is what makes local testing possible at all.
    window.isSecureContext
  );
}

export function registerServiceWorker(): void {
  if (!supported()) return;

  /*
   * DEV: unregister instead.
   *
   * Vite serves modules straight off disk with its own cache headers, and a
   * worker in front of that is at best confusing and at worst serves yesterday's
   * module graph over today's HMR. More to the point, a developer who loaded
   * the production build on localhost:5173 once has a worker registered for
   * that origin forever, and it will keep answering for the dev server. This
   * clears it.
   */
  if (import.meta.env.DEV) {
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const registration of registrations) void registration.unregister();
      })
      .catch(() => {
        // Nothing to clean up, or the browser refused. Either is fine.
      });
    return;
  }

  /*
   * After `load`, not during module evaluation.
   *
   * Registering competes for bandwidth with the bundle and the first API calls
   * of the page you are actually looking at, and the worker cannot help this
   * load in any case — it only controls the NEXT one. Deferring costs nothing
   * and keeps first paint clear.
   */
  const register = () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /*
       * Swallowed deliberately. A failed registration means no offline support
       * and no install prompt; it does not mean the CRM is broken, and there is
       * nothing the person reading the screen could do about it. It must never
       * surface as an error in front of a user or take the app down.
       */
    });
  };

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/** True when the page is running as an installed app rather than in a tab. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    // iOS Safari predates display-mode and reports it here instead.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
