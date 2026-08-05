/**
 * Get everyone actually subscribed to notifications.
 *
 * WHAT WAS WRONG. usePushNotifications was mounted on ONE page — the Dialer.
 * Anyone who works in Kanban, Leads or Projects never subscribed, so the
 * subscription table only ever filled up with people who happened to open the
 * dialer. Meanwhile the work-clock prompt, the project-update alerts and the
 * lead-flow watchdog all fan out to that table. They were sending to almost
 * nobody, and reporting success while they did it.
 *
 * The owner's message was "Bro not getting notifications". He was right, and no
 * log said so: the sends "succeeded" against an empty or stale audience.
 *
 * WHAT THIS DOES. Mounted once, app-wide:
 *
 *   permission already granted -> subscribe SILENTLY. No prompt, no button.
 *     This is the common case after the stale-key cleanup: the browser already
 *     said yes, it just needs re-registering against the current VAPID key.
 *   permission not yet asked   -> a bar with a button, because the browser
 *     REQUIRES a user gesture before it will show the permission dialog. There
 *     is no way to do this silently and it is not worth pretending otherwise.
 *   permission denied          -> say so, and say where to undo it. A silent
 *     failure here is exactly how we got a week of missed prompts.
 *
 * Deliberately not dismissable-forever. Notifications are how the work clock
 * and the lead alarm reach people; a bar that can be permanently silenced would
 * quietly recreate the outage it exists to end.
 */
import { Bell, BellOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePushNotifications } from "@/hooks/use-push-notifications";

export function EnableNotifications() {
  const push = usePushNotifications();
  const [dismissed, setDismissed] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const autoTried = useRef(false);

  // Already granted but not registered against the current key: fix it without
  // bothering anyone. This is what repairs every browser carrying a legacy
  // subscription.
  useEffect(() => {
    if (autoTried.current) return;
    if (!push.supported || !push.vapidPublicKey) return;
    if (push.permission !== "granted" || push.subscribed) return;

    autoTried.current = true;
    void push.subscribe().then((result) => {
      if (!result.ok) setFailed(result.reason);
    });
  }, [push]);

  if (!push.supported || push.subscribed || dismissed) return null;
  // No VAPID key on the server means push is off by configuration, not by
  // choice. Nagging someone to enable something the server cannot deliver is
  // just noise.
  if (!push.vapidPublicKey) return null;

  if (push.permission === "denied") {
    return (
      <div className="fixed inset-x-0 top-0 z-[200] flex items-center gap-3 border-b border-amber-500/40 bg-amber-500 px-4 py-2 text-sm text-amber-950 shadow-lg">
        <BellOff className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <strong>Notifications are blocked in this browser.</strong> You will
          miss the “are you working?” prompt and lead alerts. Re-enable them via
          the padlock icon in the address bar → Notifications → Allow.
        </span>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded px-2 py-1 hover:bg-black/10"
        >
          Later
        </button>
      </div>
    );
  }

  // permission === "default": the browser will only ask on a real click.
  return (
    <div className="fixed inset-x-0 top-0 z-[200] flex items-center gap-3 border-b border-blue-600/40 bg-blue-600 px-4 py-2 text-sm text-white shadow-lg">
      <Bell className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <strong>Turn on notifications.</strong> This is how the work-clock
        prompt reaches you when this tab is closed — without it, the timer can
        pause and you would not know.
        {failed ? ` (${failed})` : null}
      </span>
      <button
        type="button"
        disabled={push.busy}
        onClick={async () => {
          const result = await push.subscribe();
          if (!result.ok) setFailed(result.reason);
        }}
        className="shrink-0 rounded bg-white px-3 py-1 font-medium text-blue-700 hover:bg-white/90 disabled:opacity-60"
      >
        {push.busy ? "Enabling…" : "Enable"}
      </button>
    </div>
  );
}

export default EnableNotifications;
