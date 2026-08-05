/**
 * The customer portal.
 *
 * Deliberately OUTSIDE the _authenticated/_layout tree, so it renders without
 * the CRM shell — no sidebar, no Leads, no Outreach. A customer must not see
 * the machinery that found them.
 *
 * VK, 2026-08-03: "once he signs up, he would be able to see where is my
 * order… whoever purchases the planner also gets access to worksheets, zoom
 * meeting links, webinars, PowerPoints, infographics."
 *
 * The server enforces the boundary independently: /api/portal/orders resolves
 * the customer from the SESSION's email and returns only their rows, and the
 * account has no `user_access` entry so every CRM route refuses it. This page
 * showing less is a courtesy; the API refusing is the control.
 */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FileText, Package, Video } from "lucide-react";
import { BrandWordmark } from "@/components/brand-wordmark";
import { getApiUrl } from "@/fetchers/get-api-url";

type Asset = { id: string; kind: string; title: string; url: string | null };
type Order = {
  id: string;
  orderNumber: string;
  status: string;
  amountCents: number;
  currency: string;
  placedAt: string | null;
  dispatchedAt: string | null;
  trackingNumber: string | null;
};
type Payload = {
  customer: { name: string | null; email: string; organization: string | null } | null;
  orders: { order: Order; items: { productName: string; quantity: number }[]; assets: Asset[] }[];
  library: Asset[];
};

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  paid: "Payment received",
  awaiting_dispatch: "Preparing your order",
  dispatched: "On its way",
  delivered: "Delivered",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

/** The customer's view of progress. Refunded/cancelled are terminal, not steps. */
const STEPS = ["paid", "awaiting_dispatch", "dispatched", "delivered"];

function KindIcon({ kind }: { kind: string }) {
  if (kind === "webinar" || kind === "zoom") return <Video className="size-4" />;
  return <FileText className="size-4" />;
}

function RouteComponent() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["portal", "orders"],
    queryFn: async () => {
      const r = await fetch(getApiUrl("portal/orders"), {
        credentials: "include",
      });
      if (!r.ok) throw new Error((await r.text()) || r.statusText);
      return (await r.json()) as Payload;
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-4">
<BrandWordmark className="h-8 w-auto" />
          <span className="ms-auto text-sm text-muted-foreground">
            {data?.customer?.name ?? data?.customer?.email ?? ""}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-2xl font-semibold">Your orders</h1>

        {isLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="mt-6 text-sm text-red-500">{String(error as Error)}</p>
        ) : !data?.orders?.length ? (
          <p className="mt-6 text-sm text-muted-foreground">
            No orders are linked to this email address yet. If you have just
            ordered, use the link from your confirmation email.
          </p>
        ) : (
          <div className="mt-6 space-y-6">
            {data.orders.map(({ order, items, assets }) => {
              const stepIndex = STEPS.indexOf(order.status);
              return (
                <section
                  key={order.id}
                  className="rounded-lg border border-border bg-card p-5"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <Package className="size-5 text-muted-foreground" />
                    <span className="font-medium">{order.orderNumber}</span>
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">
                      {STATUS_LABEL[order.status] ?? order.status}
                    </span>
                    {order.placedAt ? (
                      <span className="ms-auto text-xs text-muted-foreground">
                        Placed {new Date(order.placedAt).toLocaleDateString()}
                      </span>
                    ) : null}
                  </div>

                  {items.length ? (
                    <ul className="mt-3 text-sm text-muted-foreground">
                      {items.map((it) => (
                        <li key={it.productName}>
                          {it.quantity} × {it.productName}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {/* Where is my order — the question this page exists to answer. */}
                  {stepIndex >= 0 ? (
                    <ol className="mt-4 flex gap-1">
                      {STEPS.map((s, i) => (
                        <li key={s} className="flex-1">
                          <div
                            className={`h-1 rounded-full ${i <= stepIndex ? "bg-primary" : "bg-muted"}`}
                          />
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {STATUS_LABEL[s]}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : null}

                  {order.trackingNumber ? (
                    <p className="mt-3 text-sm">
                      Tracking:{" "}
                      <span className="font-mono">{order.trackingNumber}</span>
                    </p>
                  ) : null}

                  {assets.length ? (
                    <div className="mt-4">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Included with this order
                      </div>
                      <ul className="mt-2 space-y-1">
                        {assets.map((a) => (
                          <li key={a.id}>
                            <a
                              href={a.url ?? "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm underline underline-offset-2"
                            >
                              <KindIcon kind={a.kind} />
                              {a.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              );
            })}

            {data.library?.length ? (
              <section className="rounded-lg border border-border bg-card p-5">
                <h2 className="font-medium">Your library</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Worksheets, webinars and resources your purchases unlock.
                </p>
                <ul className="mt-3 space-y-1">
                  {data.library.map((a) => (
                    <li key={a.id}>
                      <a
                        href={a.url ?? "#"}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm underline underline-offset-2"
                      >
                        <KindIcon kind={a.kind} />
                        {a.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}

export const Route = createFileRoute("/portal")({ component: RouteComponent });
