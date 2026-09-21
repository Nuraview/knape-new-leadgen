import { eq } from "drizzle-orm";
import db from "../../database/crm";
import { mktEmailVerifications as verifs } from "../../database/crm-schema";

export type Reachable = "safe" | "risky" | "invalid" | "unknown";

export interface VerifyResult {
  reachable: Reachable;
  /**
   * Whether a verifier actually answered.
   *
   * "unknown" arrives two ways and they are not the same fact. Gmail, Outlook
   * and Yahoo refuse SMTP probes, so Reacher checks the address, learns nothing
   * conclusive and says "unknown" — that is a real verdict about a real mailbox,
   * and most consumer addresses land there. A Reacher that is unconfigured,
   * erroring or timed out ALSO produced "unknown", and that is a verdict about
   * our own infrastructure.
   *
   * Collapsing them is how an outage turns automated sending into unverified
   * bulk mail: every address suddenly looks equally sendable. `probed` keeps
   * them apart. Interactive sends may ignore it — a person is watching — but
   * anything automatic must hold when it is false.
   */
  probed: boolean;
  /**
   * The domain accepts every address offered to it, so nothing was learned
   * about this mailbox in particular.
   *
   * Reacher reports a catch-all by ALSO setting `is_deliverable: true` — the
   * way it detects one is to offer a random address and watch it be accepted,
   * and that same accept sets the flag. `is_reachable` then reads "risky",
   * which is indistinguishable from an ordinary role account. So neither of
   * the two fields this client used to read can tell a confirmed mailbox from
   * a domain that says yes to everything, and on 9 September ten guessed
   * addresses went out on the strength of that and bounced.
   */
  catchAll: boolean;
  /** The SMTP server confirmed THIS mailbox — not merely the domain. */
  confirmedMailbox: boolean;
  result?: unknown;
}

/** Read the two mailbox facts out of a raw Reacher payload, cached or fresh. */
function mailboxFacts(raw: unknown): { catchAll: boolean; confirmedMailbox: boolean } {
  const smtp = (raw as { smtp?: Record<string, unknown> } | null)?.smtp;
  if (!smtp || typeof smtp !== "object") {
    return { catchAll: false, confirmedMailbox: false };
  }
  const catchAll = smtp.is_catch_all === true;
  return { catchAll, confirmedMailbox: !catchAll && smtp.is_deliverable === true };
}

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Verify an email via the self-hosted Reacher service on the VPS (SMTP RCPT +
 * MX + catch-all/role/disposable). Results cached in mkt_email_verifications so
 * we never re-probe the same address (protects sending-IP reputation + speed).
 * Any error/timeout/unconfigured still returns "unknown" so interactive sends
 * are never blocked by our own infrastructure — but it comes back with
 * `probed: false` so an automated caller can tell the difference and wait.
 */
export async function verifyEmail(email: string): Promise<VerifyResult> {
  const e = email.toLowerCase().trim();

  // 1) cache
  try {
    const [c] = await db.select().from(verifs).where(eq(verifs.email, e)).limit(1);
    if (c?.checkedAt && Date.now() - new Date(c.checkedAt).getTime() < TTL_MS) {
      return {
        reachable: (c.reachable as Reachable) ?? "unknown",
        probed: true,
        ...mailboxFacts(c.result),
        result: c.result,
      };
    }
  } catch {
    /* cache miss / table absent → continue */
  }

  const url = process.env.REACHER_URL;
  const token = process.env.REACHER_SECRET;
  if (!url || !token) {
    return { reachable: "unknown", probed: false, catchAll: false, confirmedMailbox: false };
  }

  // 2) probe
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    const res = await fetch(`${url.replace(/\/$/, "")}/v1/check_email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Reacher-Token": token },
      body: JSON.stringify({ to_email: e }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { reachable: "unknown", probed: false, catchAll: false, confirmedMailbox: false };
    }
    const data = (await res.json()) as { is_reachable?: string; smtp?: Record<string, unknown> };
    const reachable: Reachable = ["safe", "risky", "invalid", "unknown"].includes(
      data.is_reachable ?? "",
    )
      ? (data.is_reachable as Reachable)
      : "unknown";

    // 3) cache upsert
    try {
      await db
        .insert(verifs)
        .values({ email: e, reachable, result: data, checkedAt: new Date() })
        .onConflictDoUpdate({
          target: verifs.email,
          set: { reachable, result: data, checkedAt: new Date() },
        });
    } catch {
      /* best-effort cache write */
    }
    return { reachable, probed: true, ...mailboxFacts(data), result: data };
  } catch {
    return { reachable: "unknown", probed: false, catchAll: false, confirmedMailbox: false };
  }
}
