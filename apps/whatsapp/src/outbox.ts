import { config } from "./config";
import { fetchOutboxBatch, reportOutboxResult } from "./crm";
import { type Account, getAccounts } from "./socket";
import { checkSendAllowed, recordSend } from "./throttle";

const BATCH = 5;

// One independent poll loop per account. Each loop only drains rows the CRM
// has tagged for ITS account, so a backlog on one number never blocks another.
type Poller = { timer: NodeJS.Timeout | null; stopped: boolean };
const pollers = new Map<string, Poller>();

export function startOutboxPoller(): void {
  for (const account of getAccounts()) startPollerFor(account);
}

function startPollerFor(account: Account): void {
  if (pollers.has(account.id)) return;
  const ctrl: Poller = { timer: null, stopped: false };
  pollers.set(account.id, ctrl);

  // Adaptive backoff: a tick that finds work resets to the min interval so a
  // backlog drains promptly; an empty (or skipped) tick doubles the delay up
  // to the max so an idle bridge stops hammering the serverless endpoint.
  let intervalMs = config.outboxPollMinMs;

  const scheduleNext = (): void => {
    if (ctrl.stopped) return;
    ctrl.timer = setTimeout(() => void tick(), intervalMs);
  };

  const tick = async (): Promise<void> => {
    let didWork = false;
    try {
      // Not paired yet — nothing to do; the finally backs off like an empty poll.
      if (!account.state.connected) return;
      const items = await fetchOutboxBatch(BATCH, account.id);
      if (items.length > 0) {
        didWork = true;
      }
      for (const item of items) {
        // Throttle: if the min-interval window hasn't elapsed since the
        // last send, SLEEP for the remaining time rather than failing the
        // row. The daily-cap branch is still a hard fail — that one is
        // genuinely "we should not send any more today". Sleeping inside
        // a poll tick is fine; the next tick won't start until this one
        // resolves and the timer re-fires after POLL_INTERVAL_MS.
        for (let attempts = 0; attempts < 2; attempts++) {
          const gate = checkSendAllowed(account.id);
          if (gate.ok) break;
          if (gate.reason.startsWith("daily cap") || attempts > 0) {
            await reportOutboxResult(item.id, {
              status: "failed",
              error: `throttled: ${gate.reason}`,
            });
            break;
          }
          const wait = gate.retryAfterMs ?? 1000;
          await new Promise((r) => setTimeout(r, wait));
        }
        // If still not allowed after the wait, skip to the next item.
        const finalGate = checkSendAllowed(account.id);
        if (!finalGate.ok) continue;
        try {
          const r = await account.sendText(item.to_jid, item.body);
          recordSend(account.id);
          await reportOutboxResult(item.id, {
            status: "sent",
            message_id: r.id,
          });
          console.log(`[outbox:${account.id}] sent ${item.id} -> ${item.to_jid}`);
        } catch (e) {
          await reportOutboxResult(item.id, {
            status: "failed",
            error: (e as Error).message,
          });
          console.warn(
            `[outbox:${account.id}] send failed ${item.id}: ${(e as Error).message}`,
          );
        }
      }
    } catch (e) {
      // Polling failures (network blip, CRM 5xx) shouldn't crash the loop.
      // Treat as idle so transient CRM errors also back off instead of
      // retrying every few seconds.
      console.warn(`[outbox:${account.id}] poll failed: ${(e as Error).message}`);
    } finally {
      intervalMs = didWork
        ? config.outboxPollMinMs
        : Math.min(intervalMs * 2, config.outboxPollMaxMs);
      scheduleNext();
    }
  };

  // Run once immediately so a queued message lands quickly, then settle into
  // the adaptive cadence.
  void tick();
}

export function stopOutboxPoller(): void {
  for (const ctrl of pollers.values()) {
    ctrl.stopped = true;
    if (ctrl.timer) clearTimeout(ctrl.timer);
  }
  pollers.clear();
}
