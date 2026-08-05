/**
 * The client-facing proposal page.
 *
 * This was the last surface keeping the legacy Next app alive. The URL shape is
 * FROZEN — /proposal/:number/:slug?t=<token> is already in clients' inboxes and
 * must keep resolving after the old app is switched off.
 *
 * The rendering is PublicProposalView, copied from the legacy app rather than
 * rebuilt. My first attempt at this page reimplemented the layout from the data
 * model and silently dropped the whole design system — the accent colours, the
 * display font, the numbered section heads, the three themes. The proposal is a
 * sales document; how it looks IS the product. Copying the 989-line view keeps
 * what the client approved instead of approximating it.
 *
 * Public by design: the share token is the credential, and the number and slug
 * are cosmetic — the server looks up by token alone.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { PublicProposalView } from "@/components/proposal/public/public-proposal-view";
import { getApiUrl } from "@/fetchers/get-api-url";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-white p-8 text-center text-stone-600">
      <div>{children}</div>
    </div>
  );
}

function RouteComponent() {
  const {
    t: token,
    pay,
    cs,
    amount,
    inv,
    pp,
  } = useSearch({ from: "/proposal/$number/$slug" });

  const q = useQuery({
    queryKey: ["public-proposal", token],
    queryFn: async () => {
      const r = await fetch(getApiUrl(`proposal-public/${token}`));
      if (!r.ok) throw new Error("This proposal link is not valid.");
      return r.json();
    },
    enabled: Boolean(token),
    retry: false,
  });

  if (!token) return <Shell>This link is missing its access token.</Shell>;
  if (q.isLoading) {
    return (
      <Shell>
        <Loader2 className="size-5 animate-spin" />
      </Shell>
    );
  }
  if (q.isError || !q.data) {
    return <Shell>This proposal link is not valid, or it has expired.</Shell>;
  }

  const { proposal, lineItems, assets, settings, payments } = q.data;

  /*
   * Rebuild the payment state the signing host packed into the URL, so the
   * invoice host lands straight on the payment panel.
   *
   * The AMOUNT comes from the proposal, not the query string. The URL's copy is
   * only a hint and it does not always survive the hop — VK's live link arrived
   * without it and the button read "Pay $0.00" over a perfectly good Stripe
   * form. The figure a client reads before paying has to come from the server
   * that set the charge, not from a parameter anyone can edit.
   */
  const initialPayment = pay
    ? {
        method: pay,
        amount:
          Number(proposal.grandTotal) || Number(amount ?? 0) || 0,
        clientSecret: cs ?? null,
        invoiceId: inv ?? null,
        paypalConfigured: pp === "1",
      }
    : null;

  return (
    /*
     * ESCAPES THE APP SHELL.
     *
     * __root.tsx wraps every route in `h-svh … overflow-y-hidden` — right for
     * the dashboard, where the sidebar is fixed and only the main pane
     * scrolls, and fatal for a long public document: the proposal rendered
     * correctly and then could not be scrolled past the first screen.
     *
     * `fixed inset-0` positions against the VIEWPORT rather than that clipped
     * parent, so this page owns its own scrolling and the shell is untouched.
     */
    <div className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-white">
    <PublicProposalView
      // The view owns every visual decision; this route only fetches and
      // decides what "already decided" means.
      proposal={{ ...proposal, lineItems, assets }}
      settings={settings}
      token={token}
      alreadyDecided={Boolean(proposal.decisionAt)}
      initialPayment={initialPayment}
      payments={payments ?? null}
    />
    </div>
  );
}

export const Route = createFileRoute("/proposal/$number/$slug")({
  validateSearch: (raw: Record<string, unknown>) => ({
    t: typeof raw.t === "string" ? raw.t : "",
    // The proposals→invoice host hand-off. Set only by the post-sign redirect;
    // absent on every normal open. See PublicProposalView's onApproved.
    pay: raw.pay === "stripe" || raw.pay === "paypal" ? raw.pay : undefined,
    cs: typeof raw.cs === "string" ? raw.cs : undefined,
    amount: typeof raw.amount === "string" ? raw.amount : undefined,
    inv: typeof raw.inv === "string" ? raw.inv : undefined,
    pp: raw.pp === "1" ? ("1" as const) : undefined,
  }),
  component: RouteComponent,
});
