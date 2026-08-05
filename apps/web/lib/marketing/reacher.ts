import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { mktEmailVerifications as verifs } from "@/lib/db";

export type Reachable = "safe" | "risky" | "invalid" | "unknown";

export interface VerifyResult {
  reachable: Reachable;
  result?: unknown;
}

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Verify an email via the self-hosted Reacher service on the VPS (SMTP RCPT +
 * MX + catch-all/role/disposable). Results cached in mkt_email_verifications so
 * we never re-probe the same address (protects sending-IP reputation + speed).
 * Fail-open: any error/timeout/unconfigured → "unknown" (never blocks on infra).
 */
export async function verifyEmail(email: string): Promise<VerifyResult> {
  const e = email.toLowerCase().trim();

  // 1) cache
  try {
    const [c] = await db.select().from(verifs).where(eq(verifs.email, e)).limit(1);
    if (c?.checkedAt && Date.now() - new Date(c.checkedAt).getTime() < TTL_MS) {
      return { reachable: (c.reachable as Reachable) ?? "unknown", result: c.result };
    }
  } catch {
    /* cache miss / table absent → continue */
  }

  const url = process.env.REACHER_URL;
  const token = process.env.REACHER_SECRET;
  if (!url || !token) return { reachable: "unknown" };

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
    if (!res.ok) return { reachable: "unknown" };
    const data = (await res.json()) as { is_reachable?: string };
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
    return { reachable, result: data };
  } catch {
    return { reachable: "unknown" };
  }
}
