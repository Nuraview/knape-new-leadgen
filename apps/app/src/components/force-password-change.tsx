/**
 * Forced password rotation.
 *
 * VK 2026-07-28 asked to be handed the owner account and to "regenerate the
 * password privately on his computer". That is what this screen is: an
 * operator provisions the account with a one-time password, the holder signs
 * in with it once, and cannot reach anything until they have replaced it with
 * one they chose themselves. The person who issued the temporary password
 * never learns the real one.
 *
 * It blocks the whole shell rather than living in a settings page, because a
 * rotation you can dismiss is a rotation that does not happen. The server
 * clears the flag (apps/api/src/auth.ts, the /change-password after-hook), not
 * this component — a client that simply stops rendering the screen gains
 * nothing.
 *
 * `revokeOtherSessions` is on deliberately: the temporary password may have
 * been sent over chat, so any session opened with it dies the moment a real
 * one is set.
 */
import { KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { toast } from "@/lib/toast";

const MIN_LENGTH = 12;

export function ForcePasswordChange({ email }: { email: string | null }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit =
    current.length > 0 && next.length >= MIN_LENGTH && next === confirm && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });
      if (error) {
        toast.error(error.message || "Could not change the password");
        return;
      }
      toast.success("Password updated");
      // Full reload rather than a cache invalidation: the session cookie was
      // just rotated and every query in flight is holding the old one.
      window.location.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6"
      >
        <div className="mb-1 flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Choose your password</h1>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          {email ? <span className="font-medium">{email}</span> : "This account"}{" "}
          is signed in with a temporary password. Pick your own to continue —
          nobody else will know it.
        </p>

        <label className="mb-1 block text-sm font-medium" htmlFor="fp-current">
          Temporary password
        </label>
        <Input
          id="fp-current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="mb-4"
        />

        <label className="mb-1 block text-sm font-medium" htmlFor="fp-new">
          New password
        </label>
        <Input
          id="fp-new"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <p
          className={`mb-4 mt-1 text-xs ${tooShort ? "text-destructive" : "text-muted-foreground"}`}
        >
          At least {MIN_LENGTH} characters.
        </p>

        <label className="mb-1 block text-sm font-medium" htmlFor="fp-confirm">
          Confirm new password
        </label>
        <Input
          id="fp-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch ? (
          <p className="mt-1 text-xs text-destructive">
            These do not match.
          </p>
        ) : null}

        <Button type="submit" className="mt-5 w-full" disabled={!canSubmit}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Set password and continue
        </Button>

        <p className="mt-4 text-xs text-muted-foreground">
          Signing you out of every other device, in case the temporary password
          was sent over chat.
        </p>
      </form>
    </div>
  );
}

export default ForcePasswordChange;
