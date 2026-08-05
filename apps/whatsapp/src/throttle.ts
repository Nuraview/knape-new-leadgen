import { config } from "./config";

// Per-account throttle. Each paired number has its own send budget — the
// min-interval and daily cap that defend a WhatsApp account from bulk-send
// bans apply independently to each number, so one busy account never starves
// (or implicates) another.
type Bucket = {
  lastSendAt: number;
  dailyCount: number;
  dailyResetAt: number;
};

const buckets = new Map<string, Bucket>();

function startOfNextUtcDay(): number {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

function bucketFor(accountId: string): Bucket {
  let b = buckets.get(accountId);
  if (!b) {
    b = { lastSendAt: 0, dailyCount: 0, dailyResetAt: startOfNextUtcDay() };
    buckets.set(accountId, b);
  }
  return b;
}

export type ThrottleResult =
  | { ok: true }
  | { ok: false; reason: string; retryAfterMs?: number };

export function checkSendAllowed(accountId: string): ThrottleResult {
  const now = Date.now();
  const b = bucketFor(accountId);

  if (now >= b.dailyResetAt) {
    b.dailyCount = 0;
    b.dailyResetAt = startOfNextUtcDay();
  }

  if (b.dailyCount >= config.sendDailyCap) {
    return {
      ok: false,
      reason: `daily cap reached (${config.sendDailyCap})`,
      retryAfterMs: b.dailyResetAt - now,
    };
  }

  const sinceLast = now - b.lastSendAt;
  if (sinceLast < config.sendMinIntervalMs) {
    return {
      ok: false,
      reason: `min interval not elapsed`,
      retryAfterMs: config.sendMinIntervalMs - sinceLast,
    };
  }

  return { ok: true };
}

export function recordSend(accountId: string): void {
  const b = bucketFor(accountId);
  b.lastSendAt = Date.now();
  b.dailyCount += 1;
}

export function throttleStatus(accountId: string): {
  daily_count: number;
  daily_cap: number;
  daily_reset_at: string;
  min_interval_ms: number;
} {
  const b = bucketFor(accountId);
  return {
    daily_count: b.dailyCount,
    daily_cap: config.sendDailyCap,
    daily_reset_at: new Date(b.dailyResetAt).toISOString(),
    min_interval_ms: config.sendMinIntervalMs,
  };
}
