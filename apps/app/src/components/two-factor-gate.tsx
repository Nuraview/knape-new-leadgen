/**
 * Set up 2FA immediately after sign-in, not buried in a settings menu.
 *
 * VK asked for 2FA on the owner account. Putting it behind
 * Settings → Account → Two-factor is how it never gets turned on: the moment to
 * enrol is the one time you are already thinking about your password, right
 * after choosing it — not a menu you have no reason to open.
 *
 * So this fires straight after ForcePasswordChange, for owners and admins who
 * have not enrolled. The QR is on screen; there is nothing to navigate to.
 *
 * SKIPPABLE, deliberately. A hard block would mean an admin whose phone is
 * broken — which is exactly the situation that killed the WhatsApp bridge here —
 * cannot get into their own CRM. Skipping is remembered per browser, so it asks
 * again on the next device rather than nagging on every page load.
 */
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { TwoFactorSetup } from "@/components/two-factor-setup";

const SKIP_KEY = "nuraview.2fa.skipped";

export function shouldPromptTwoFactor(access: {
  role: string | null;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
}) {
  if (access.mustChangePassword) return false; // password screen comes first
  if (access.twoFactorEnabled) return false;
  if (access.role !== "owner" && access.role !== "admin") return false;
  return localStorage.getItem(SKIP_KEY) !== "1";
}

export function TwoFactorGate({ email }: { email: string | null }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-start justify-center overflow-y-auto bg-background p-4">
      <div className="my-auto w-full max-w-md">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="size-5 text-emerald-500" />
          <h1 className="text-lg font-semibold">Secure this account</h1>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          {email ? <span className="font-medium">{email}</span> : "This account"}{" "}
          is an admin. Add a code from an authenticator app on top of your
          password — it takes about a minute.
        </p>

        <TwoFactorSetup enabled={false} />

        <button
          type="button"
          onClick={() => {
            localStorage.setItem(SKIP_KEY, "1");
            setDismissed(true);
          }}
          className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
        >
          Skip for now — I'll do this from Settings later
        </button>
      </div>
    </div>
  );
}

export default TwoFactorGate;
