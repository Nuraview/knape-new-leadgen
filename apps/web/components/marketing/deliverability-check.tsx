"use client";

import { Loader2, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Live SMTP/deliverability check for a single recipient address. Debounced;
 * calls /api/marketing/validate-email (format + MX + disposable + the
 * self-hosted Reacher SMTP probe) and renders the verdict badge plus a
 * collapsible breakdown of every sub-check. Shared by the marketing compose
 * page and the lead "Review Email" dialog so both surfaces show the same data.
 */

type Verification = {
  reachable: "safe" | "risky" | "invalid" | "unknown";
  acceptsMail?: boolean;
  canConnectSmtp?: boolean;
  isDeliverable?: boolean;
  isDisabled?: boolean;
  hasFullInbox?: boolean;
  isCatchAll?: boolean;
  isRoleAccount?: boolean;
  isDisposable?: boolean;
  gravatarUrl?: string | null;
  breached?: boolean | null;
};

type Result = {
  email: string;
  isValid: boolean;
  isValidFormat: boolean;
  hasMxRecords: boolean;
  issues: { type: string; severity: string; message: string }[];
  score: "high" | "medium" | "low" | "dangerous";
  smtpReachable?: "safe" | "risky" | "invalid" | "unknown";
  verification?: Verification;
};

function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function DeliverabilityCheck({ email }: { email: string }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (addr: string) => {
    if (!addr || !looksLikeEmail(addr)) {
      setResult(null);
      return;
    }
    setChecking(true);
    try {
      const res = await fetch("/api/marketing/validate-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addr }),
      });
      if (res.ok) setResult((await res.json()) as Result);
    } catch {
      /* advisory — silent fail */
    } finally {
      setChecking(false);
    }
  }, []);

  // Debounce 800ms on the address.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!email || !looksLikeEmail(email)) {
      setResult(null);
      return;
    }
    timer.current = setTimeout(() => run(email), 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [email, run]);

  if (!checking && !result) return null;

  return (
    <div
      className={`mt-2 rounded-lg border p-3 ${
        !result
          ? "border-border bg-muted/30"
          : result.score === "high"
            ? "border-green-200 bg-green-50 dark:border-green-900/30 dark:bg-green-900/10"
            : result.score === "medium"
              ? "border-yellow-200 bg-yellow-50 dark:border-yellow-900/30 dark:bg-yellow-900/10"
              : result.score === "low"
                ? "border-orange-200 bg-orange-50 dark:border-orange-900/30 dark:bg-orange-900/10"
                : "border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-900/10"
      }`}
    >
      {checking ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" />
          Checking deliverability…
        </div>
      ) : (
        result && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {result.score === "high" && <ShieldCheck size={18} className="text-green-600 dark:text-green-400" />}
                {result.score === "medium" && <ShieldAlert size={18} className="text-yellow-600 dark:text-yellow-400" />}
                {result.score === "low" && <ShieldAlert size={18} className="text-orange-600 dark:text-orange-400" />}
                {result.score === "dangerous" && <ShieldX size={18} className="text-red-600 dark:text-red-400" />}
                <span
                  className={`text-sm font-medium ${
                    result.score === "high"
                      ? "text-green-800 dark:text-green-300"
                      : result.score === "medium"
                        ? "text-yellow-800 dark:text-yellow-300"
                        : result.score === "low"
                          ? "text-orange-800 dark:text-orange-300"
                          : "text-red-800 dark:text-red-300"
                  }`}
                >
                  {result.score === "high" && "High Deliverability"}
                  {result.score === "medium" && "Medium Deliverability"}
                  {result.score === "low" && "Low Deliverability — proceed with caution"}
                  {result.score === "dangerous" && "Dangerous — sending blocked"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => run(email)}
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Recheck
              </button>
            </div>

            {result.issues.length > 0 && (
              <ul className="space-y-1 pl-6">
                {result.issues.map((issue, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span
                      className={`mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                        issue.severity === "error"
                          ? "bg-red-500"
                          : issue.severity === "warning"
                            ? "bg-yellow-500"
                            : "bg-blue-500"
                      }`}
                    />
                    <span
                      className={
                        result.score === "high"
                          ? "text-green-700 dark:text-green-300"
                          : result.score === "medium"
                            ? "text-yellow-700 dark:text-yellow-300"
                            : result.score === "low"
                              ? "text-orange-700 dark:text-orange-300"
                              : "text-red-700 dark:text-red-300"
                      }
                    >
                      {issue.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {result.verification && <VerificationBreakdown result={result} />}
          </div>
        )
      )}
    </div>
  );
}

/** Collapsible per-check breakdown of the full Reacher result. */
function VerificationBreakdown({ result }: { result: Result }) {
  const v = result.verification!;
  const hasData =
    v.canConnectSmtp !== undefined || v.isDeliverable !== undefined || v.reachable !== "unknown";

  if (!hasData) {
    return (
      <p className="pl-6 text-xs italic text-muted-foreground">
        SMTP mailbox probe not available for this provider (Gmail/Outlook/Yahoo block it) — syntax
        + MX verified; bounces auto-caught after send.
      </p>
    );
  }

  const yes = (b?: boolean): "good" | "bad" | "unknown" =>
    b === undefined ? "unknown" : b ? "good" : "bad";
  const no = (b?: boolean): "good" | "bad" | "unknown" =>
    b === undefined ? "unknown" : b ? "bad" : "good";

  const rows: { label: string; state: "good" | "bad" | "unknown"; note?: string }[] = [
    { label: "Reachability", state: v.reachable === "safe" ? "good" : v.reachable === "unknown" ? "unknown" : "bad", note: v.reachable },
    { label: "Syntax valid", state: yes(result.isValidFormat) },
    { label: "Domain accepts mail (MX)", state: yes(v.acceptsMail ?? result.hasMxRecords) },
    { label: "SMTP server reachable", state: yes(v.canConnectSmtp) },
    { label: "Mailbox deliverable", state: yes(v.isDeliverable) },
    { label: "Mailbox enabled", state: no(v.isDisabled) },
    { label: "Inbox has space", state: no(v.hasFullInbox) },
    { label: "Not a catch-all", state: no(v.isCatchAll) },
    { label: "Not a role account", state: no(v.isRoleAccount), note: v.isRoleAccount ? "info@, support@…" : undefined },
    { label: "Not disposable", state: no(v.isDisposable) },
    { label: "Gravatar profile", state: v.gravatarUrl ? "good" : "unknown", note: v.gravatarUrl ? "real person" : undefined },
    { label: "Not in known breach (HIBP)", state: v.breached == null ? "unknown" : no(v.breached) },
  ];
  const passed = rows.filter((r) => r.state === "good").length;

  return (
    <details className="pl-6">
      <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
        Verification details — {passed}/{rows.length} checks passed
      </summary>
      <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              {r.label}
              {r.note ? <span className="opacity-60"> ({r.note})</span> : ""}
            </span>
            <span
              className={
                r.state === "good"
                  ? "font-semibold text-green-600 dark:text-green-400"
                  : r.state === "bad"
                    ? "font-semibold text-red-600 dark:text-red-400"
                    : "text-muted-foreground/50"
              }
            >
              {r.state === "good" ? "✓" : r.state === "bad" ? "✗" : "—"}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}
