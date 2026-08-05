/**
 * TOTP enrolment, for an authenticator app.
 *
 * VK 2026-07-28: "let me use authenticator app", and "for my own — only for
 * me, not for everyone." So this is opt-in per account and lives in settings
 * rather than being forced on sign-in.
 *
 * better-auth's enableTwoFactor returns an otpauth:// URI. The QR is rendered
 * from it locally with `qrcode`; the secret must never travel to an external
 * chart service, which is what most "just use a QR image API" snippets do.
 *
 * Enabling requires the current password AND a code from the app before it
 * takes effect (skipVerificationOnEnable is false server-side). That ordering
 * matters: turning on 2FA without proving the authenticator actually works is
 * how people lock themselves out of their own account.
 */
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

type Stage = "idle" | "confirming" | "verifying";

export function TwoFactorSetup({ enabled }: { enabled: boolean }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!totpUri) {
      setQr(null);
      return;
    }
    // Rendered in-page. The URI contains the shared secret, so it must not be
    // handed to a remote QR generator.
    QRCode.toDataURL(totpUri, { margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [totpUri]);

  async function begin() {
    setBusy(true);
    try {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error) {
        toast.error(error.message || "Could not start 2FA setup");
        return;
      }
      setTotpUri(data?.totpURI ?? null);
      setBackupCodes(data?.backupCodes ?? []);
      setStage("verifying");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code });
      if (error) {
        toast.error(error.message || "That code was not accepted");
        return;
      }
      toast.success("Two-factor authentication is on");
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) {
        toast.error(error.message || "Could not turn 2FA off");
        return;
      }
      toast.success("Two-factor authentication is off");
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  if (enabled) {
    return (
      <section className="rounded-xl border border-border p-5">
        <div className="mb-1 flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-500" />
          <h2 className="text-sm font-semibold">Two-factor authentication</h2>
        </div>
        <p className="mb-4 text-sm text-muted-foreground">
          On. Sign-in asks for a code from your authenticator app.
        </p>

        {stage === "confirming" ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="password"
              placeholder="Current password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button variant="destructive" disabled={busy} onClick={disable}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Turn off
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStage("confirming")}
          >
            <ShieldOff className="size-3.5" />
            Turn off
          </Button>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border p-5">
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Two-factor authentication</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Off. Add a code from an authenticator app (Google Authenticator, Authy,
        1Password) on top of your password.
      </p>

      {stage === "idle" ? (
        <Button size="sm" onClick={() => setStage("confirming")}>
          Set up
        </Button>
      ) : null}

      {stage === "confirming" ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="password"
            placeholder="Current password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button disabled={busy || !password} onClick={begin}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Continue
          </Button>
        </div>
      ) : null}

      {stage === "verifying" ? (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">
              1. Scan this with your authenticator app
            </p>
            {qr ? (
              <img
                src={qr}
                alt="Two-factor setup QR code"
                className="rounded-lg border border-border bg-white p-2"
                width={220}
                height={220}
              />
            ) : (
              <Loader2 className="size-4 animate-spin" />
            )}
            {totpUri ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Can't scan? Enter the key by hand
                </summary>
                <code className="mt-1 block break-all rounded bg-muted p-2 text-xs">
                  {new URL(totpUri).searchParams.get("secret")}
                </code>
              </details>
            ) : null}
          </div>

          {backupCodes.length > 0 ? (
            <div>
              <p className="mb-1 text-sm font-medium">2. Save these backup codes</p>
              <p className="mb-2 text-xs text-muted-foreground">
                Each works once, and this is the only time they are shown. They
                are how you get in if you lose the phone.
              </p>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-border p-2 font-mono text-xs">
                {backupCodes.map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <p className="mb-2 text-sm font-medium">
              3. Enter the 6-digit code to confirm
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                maxLength={6}
              />
              <Button disabled={busy || code.length !== 6} onClick={verify}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Turn on
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default TwoFactorSetup;
