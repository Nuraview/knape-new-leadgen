/**
 * Portal invitation claim.
 *
 * The page the link in a customer's confirmation email opens. It is reached by
 * someone with no account, so it renders bare — no CRM shell, no sidebar.
 *
 * The flow, and why it is shaped this way:
 *
 *   1. Resolve the token against the PUBLIC endpoint, which returns only the
 *      invited email and the customer's name. Never orders: this link can be
 *      forwarded, and what was bought must not leak before anyone proves who
 *      they are.
 *   2. The email field is fixed, not editable. The server requires the
 *      signed-in address to match the invited one, so letting someone type a
 *      different address here would only produce a confusing 403.
 *   3. Sign up (or sign in, if they already have an account) with that address,
 *      then POST the token to bind the account to the customer.
 *
 * Public registration is off on this instance — a grant is the only way in.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { getApiUrl } from "@/fetchers/get-api-url";
import { BrandWordmark } from "@/components/brand-wordmark";
import { authClient } from "@/lib/auth-client";

type Invitation = {
  email: string;
  name: string | null;
  organization: string | null;
  claimed: boolean;
};

function RouteComponent() {
  const { token } = useParams({ strict: false }) as { token: string };
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [error, setError] = useState<string | null>(null);

  const invitation = useQuery({
    queryKey: ["portal-invitation", token],
    queryFn: async () => {
      const r = await fetch(getApiUrl(`portal-public/claim/${token}`));
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(
          body?.message ?? "This invitation link is invalid or has expired.",
        );
      }
      return (await r.json()) as Invitation;
    },
    retry: false,
  });

  const claim = useMutation({
    mutationFn: async () => {
      setError(null);
      const email = invitation.data?.email;
      if (!email) throw new Error("Invitation could not be read.");

      // Sign up, or sign in when they already have an account from an earlier
      // order. Both end with a session for the invited address.
      const auth =
        mode === "signup"
          ? await authClient.signUp.email({
              email,
              password,
              name: invitation.data?.name ?? email,
            })
          : await authClient.signIn.email({ email, password });

      if (auth.error) throw new Error(auth.error.message ?? "Sign-in failed");

      const r = await fetch(getApiUrl(`portal/claim/${token}`), {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body?.message ?? "Could not claim this invitation.");
      }
    },
    onSuccess: () => navigate({ to: "/portal" }),
    onError: (e) => setError(String((e as Error).message ?? e)),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="w-full max-w-sm">
<BrandWordmark className="mx-auto h-9 w-auto" />

        {invitation.isLoading ? (
          <p className="mt-8 text-center text-sm text-muted-foreground">
            Checking your invitation…
          </p>
        ) : invitation.error ? (
          <div className="mt-8 rounded-lg border border-border bg-card p-5 text-center">
            <p className="text-sm text-red-500">
              {String((invitation.error as Error).message)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Invitations expire after 30 days. Reply to your order
              confirmation and we will send a fresh one.
            </p>
          </div>
        ) : (
          <div className="mt-8 rounded-lg border border-border bg-card p-5">
            <h1 className="text-lg font-semibold">
              {invitation.data?.claimed ? "Welcome back" : "Set up your access"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {invitation.data?.claimed
                ? "Sign in to see your order."
                : "Choose a password to track your order and open the resources included with it."}
            </p>

            <label className="mt-4 block">
              <span className="mb-1 block text-xs text-muted-foreground">
                Email
              </span>
              {/*
                Fixed, not editable. The server requires the signed-in address to
                match the invited one, so an editable field could only produce a
                403 the customer cannot act on.
              */}
              <input
                value={invitation.data?.email ?? ""}
                readOnly
                className="h-9 w-full cursor-not-allowed rounded-md border border-border bg-muted px-2 text-sm"
              />
            </label>

            <label className="mt-3 block">
              <span className="mb-1 block text-xs text-muted-foreground">
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>

            {error ? <p className="mt-3 text-xs text-red-500">{error}</p> : null}

            <Button
              className="mt-4 w-full"
              onClick={() => claim.mutate()}
              disabled={claim.isPending || password.length < 8}
            >
              {claim.isPending
                ? "Setting up…"
                : mode === "signup"
                  ? "Create access"
                  : "Sign in"}
            </Button>

            {password.length > 0 && password.length < 8 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Use at least 8 characters.
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setMode(mode === "signup" ? "signin" : "signup");
                setError(null);
              }}
              className="mt-3 w-full text-xs text-muted-foreground underline underline-offset-2"
            >
              {mode === "signup"
                ? "I already have an account"
                : "I need to create a password"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/portal/claim/$token")({
  component: RouteComponent,
});
