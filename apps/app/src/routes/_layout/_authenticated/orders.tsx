/**
 * Orders & Purchases — the staff view.
 *
 * VK, 2026-08-03: "instead of business orders and purchases, under orders and
 * purchases, just add orders… the order name would be iSchool, it would be
 * some number, and status, dispatched, waiting for dispatched, payment paid".
 *
 * Orders come in from landing-page form submissions, from paid invoices, or by
 * hand for Zelle / Cash App / cheque. Marking one PAID mints the customer's
 * portal invitation — that is the automation from the call, and the link is
 * surfaced here so Dan can send or re-send it himself.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Plus } from "lucide-react";
import { useState } from "react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiUrl } from "@/fetchers/get-api-url";

const STATUSES = [
  "pending_payment",
  "paid",
  "awaiting_dispatch",
  "dispatched",
  "delivered",
  "refunded",
  "cancelled",
] as const;

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Payment pending",
  paid: "Payment paid",
  awaiting_dispatch: "Waiting for dispatch",
  dispatched: "Dispatched",
  delivered: "Delivered",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<string, string> = {
  pending_payment: "bg-amber-500/15 text-amber-500",
  paid: "bg-emerald-500/15 text-emerald-500",
  awaiting_dispatch: "bg-blue-500/15 text-blue-500",
  dispatched: "bg-blue-500/15 text-blue-500",
  delivered: "bg-emerald-500/15 text-emerald-500",
  refunded: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

type Order = {
  id: string;
  orderNumber: string;
  status: string;
  amountCents: number;
  currency: string;
  placedAt: string | null;
  trackingNumber: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerOrg: string | null;
  customerSource: string | null;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(getApiUrl(path), {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const b = await res.json();
      message = b?.message ?? message;
    } catch {}
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
  }).format((cents ?? 0) / 100);
}

function RouteComponent() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const [form, setForm] = useState({
    email: "",
    name: "",
    organization: "",
    productName: "",
    quantity: 1,
    amount: "",
  });

  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<{ items: Order[] }>("order"),
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ id: string }>("order", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          name: form.name || undefined,
          organization: form.organization || undefined,
          productName: form.productName,
          quantity: form.quantity,
          amountCents: Math.round(Number(form.amount || 0) * 100),
        }),
      }),
    onSuccess: () => {
      setCreating(false);
      setForm({ ...form, email: "", name: "", organization: "", amount: "" });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api<{ portalInvite: { url: string } | null }>(`order/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: (data) => {
      // Surfaced rather than only emailed: the operator usually wants to check
      // the link works, and re-sending should not mint a second invitation.
      if (data?.portalInvite?.url) setInvite(data.portalInvite.url);
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  const rows = orders.data?.items ?? [];

  return (
    <Layout>
      <PageTitle title="Orders" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Orders &amp; Purchases</h1>
        <span className="text-sm text-muted-foreground">
          {rows.length ? `${rows.length} orders` : ""}
        </span>
        <Button className="ms-auto" onClick={() => setCreating((v) => !v)}>
          <Plus className="size-4" />
          New order
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-5">
        {invite ? (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
            <span className="text-emerald-500">
              Portal invitation created — the customer signs up with their own
              email and sees only this order.
            </span>
            <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs">
              {invite}
            </code>
            <Button
              variant="outline"
              onClick={() => navigator.clipboard.writeText(invite)}
            >
              <Copy className="size-4" />
              Copy
            </Button>
            <Button variant="outline" onClick={() => setInvite(null)}>
              Dismiss
            </Button>
          </div>
        ) : null}

        {creating ? (
          <div className="mb-4 rounded-lg border border-border bg-card p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ["email", "Customer email", "text"],
                  ["name", "Name", "text"],
                  ["organization", "Organisation", "text"],
                  ["productName", "Product", "text"],
                  ["amount", "Amount (e.g. 29.00)", "text"],
                ] as const
              ).map(([key, label, type]) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-xs text-muted-foreground">
                    {label}
                  </span>
                  <input
                    type={type}
                    value={String(form[key as keyof typeof form] ?? "")}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.value })
                    }
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  />
                </label>
              ))}
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">
                  Quantity
                </span>
                <input
                  type="number"
                  min={1}
                  value={form.quantity}
                  onChange={(e) =>
                    setForm({ ...form, quantity: Number(e.target.value) })
                  }
                  className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm tabular-nums"
                />
              </label>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button
                onClick={() => create.mutate()}
                disabled={create.isPending || !form.email.trim()}
              >
                {create.isPending ? "Creating…" : "Create order"}
              </Button>
              <Button variant="outline" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              {create.error ? (
                <span className="text-xs text-red-500">
                  {String(create.error as Error)}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {orders.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : orders.error ? (
          <p className="text-sm text-red-500">{String(orders.error as Error)}</p>
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">
            No orders yet. They arrive from the landing-page forms, from a paid
            invoice, or you can add one by hand.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left">
                <tr>
                  {[
                    "Order",
                    "Customer",
                    "Amount",
                    "Status",
                    "Placed",
                    "Source",
                  ].map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      {o.orderNumber}
                    </td>
                    <td className="px-3 py-2">
                      <div>{o.customerName || o.customerEmail}</div>
                      {o.customerOrg ? (
                        <div className="text-xs text-muted-foreground">
                          {o.customerOrg}
                        </div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                      {money(o.amountCents, o.currency)}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={o.status}
                        onChange={(e) =>
                          setStatus.mutate({ id: o.id, status: e.target.value })
                        }
                        className={`rounded px-1.5 py-0.5 text-xs ${STATUS_TONE[o.status] ?? ""}`}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {o.placedAt
                        ? new Date(o.placedAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {o.customerSource ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/orders")({
  component: RouteComponent,
});
