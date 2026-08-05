/**
 * Invoices — the owner's list, and the "create one by hand" door.
 *
 * Meeting 2026-07-30, VK: a signed proposal already turns itself into an
 * invoice, but "if we deal with non-signers, because some people don't want to
 * commit but they're ready to pay… I should be able to go to the invoicing and
 * create manually." Both doors write the same Invoices table, so this list
 * shows every invoice regardless of where it came from.
 *
 * The client never sees this page. They get a link to /invoice/:id?t=… which
 * renders the branded pay page on invoices.nuraview.com.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Copy, Link2, Plus, Send, Trash2, Wallet } from "lucide-react";
import { useState } from "react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getApiUrl } from "@/fetchers/get-api-url";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

type Invoice = {
  id: string;
  status: string;
  currency: string;
  grandTotal: string;
  paidTotal: string;
  balanceDue: string;
  issueDate: string | null;
  createdAt: string | null;
  clientName: string | null;
  payUrl: string;
  /** Stripe test-mode invoice — payable with a test card, no real money. */
  test?: boolean;
};

type Line = { description: string; quantity: string; unitPrice: string };

function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/**
 * Just the symbol, for prefixing a price input.
 *
 * Typing a bare number into a box with no currency on it is a good way to invoice
 * someone 5,000 of the wrong unit.
 */
function currencySymbol(currency: string) {
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
    }).formatToParts(0);
    return parts.find((part) => part.type === "currency")?.value ?? currency;
  } catch {
    return currency;
  }
}

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "AED"] as const;

function statusClass(status: string) {
  switch (status) {
    case "PAID":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "ISSUED":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    // Part-paid — a deposit cleared and a balance is still outstanding.
    case "PARTIAL":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "CANCELLED":
      return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

function CreateInvoiceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [notes, setNotes] = useState("");
  /*
   * A dry run of the whole flow (VK: "how can we do a complete test run
   * without deducting any money?"). Test invoices resolve to Stripe's TEST
   * keys server-side, so card 4242 4242 4242 4242 pays them and nothing is
   * charged. Never emailed to the client, and badged TEST in the list.
   */
  const [test, setTest] = useState(false);
  const [lines, setLines] = useState<Line[]>([
    { description: "", quantity: "1", unitPrice: "" },
  ]);

  // The client sees this total, so it is computed the same way the server
  // computes it — the server recomputes anyway and its number is the one that
  // gets charged.
  const total = lines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
    0,
  );

  const create = useMutation({
    mutationFn: async () => {
      const r = await fetch(getApiUrl("invoice"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName,
          clientEmail: clientEmail || null,
          currency,
          notes: notes || null,
          test,
          lineItems: lines.map((l) => ({
            description: l.description,
            quantity: Number(l.quantity) || 1,
            unitPrice: Number(l.unitPrice) || 0,
          })),
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ payUrl: string }>;
    },
    onSuccess: (res) => {
      void navigator.clipboard.writeText(res.payUrl).catch(() => {});
      toast.success(
        test
          ? "TEST invoice created — link copied. Pay it with card 4242 4242 4242 4242."
          : clientEmail
            ? "Invoice created — emailed to the client, link copied"
            : "Invoice created — pay link copied",
      );
      setClientName("");
      setClientEmail("");
      setNotes("");
      setTest(false);
      setLines([{ description: "", quantity: "1", unitPrice: "" }]);
      onCreated();
      onClose();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not create"),
  });

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
        </DialogHeader>

        {/*
          DialogPanel, not a bare div.
          ---------------------------
          This design system puts the body padding on DialogPanel (p-6, plus a
          scroll area and slot-aware top/bottom trims). DialogHeader and
          DialogFooter carry their own; DialogContent carries NONE. So a body
          wrapped in a plain <div> sits flush against both edges of the dialog —
          which is exactly what this looked like: inputs and the total slab
          touching the left and right walls while the title above them was inset.

          Every other dialog in the app either uses DialogPanel or pads itself
          explicitly. This one did neither.
        */}
        <DialogPanel className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Client name
              </span>
              <Input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="e.g. Acme Ltd"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Client email
              </span>
              <Input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                placeholder="e.g. name@acme.com"
              />
              {/* The consequence belongs under the field, not crammed into its
                  label as a parenthetical nobody finishes reading. */}
              <span className="text-[11px] text-muted-foreground">
                Optional — if set, we email them the pay link.
              </span>
            </label>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                Line items
              </span>
              <Select value={currency} onValueChange={(v) => setCurrency(String(v))}>
                {/* Currency belongs WITH the money, not paired off against the
                    notes field where it got half the dialog width for a
                    three-letter value. */}
                <SelectTrigger className="h-7 w-[5.5rem] text-xs">
                  <SelectValue>{currency}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/*
              Column headings. Three unlabelled boxes in a row is a guessing
              game — the middle one held a bare "1" and the next said "Price",
              so which was quantity was anyone's guess until you got it wrong.
            */}
            <div className="mb-1 grid grid-cols-[1fr_4.5rem_7rem_6rem_2rem] gap-2 px-1 text-[11px] font-medium text-muted-foreground">
              <span>Description</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit price</span>
              <span className="text-right">Amount</span>
              <span />
            </div>

            <div className="space-y-1.5">
              {lines.map((l, i) => {
                const amount =
                  (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
                return (
                  <div
                    key={i}
                    className="grid grid-cols-[1fr_4.5rem_7rem_6rem_2rem] items-center gap-2"
                  >
                    <Input
                      value={l.description}
                      onChange={(e) =>
                        setLine(i, { description: e.target.value })
                      }
                      placeholder="e.g. Brand identity design"
                    />
                    <Input
                      className="text-right"
                      value={l.quantity}
                      onChange={(e) => setLine(i, { quantity: e.target.value })}
                      inputMode="decimal"
                    />
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-xs text-muted-foreground">
                        {currencySymbol(currency)}
                      </span>
                      <Input
                        className="pl-6 text-right"
                        value={l.unitPrice}
                        onChange={(e) =>
                          setLine(i, { unitPrice: e.target.value })
                        }
                        inputMode="decimal"
                        placeholder="0.00"
                      />
                    </div>
                    {/* Per-line amount, so a wrong figure is visible on the row
                        that caused it rather than only in the total. */}
                    <span className="text-right text-sm tabular-nums text-muted-foreground">
                      {amount > 0 ? money(amount, currency) : "—"}
                    </span>
                    {/* Always rendered, disabled at one line: a control that
                        appears and disappears shifts every other column with it. */}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={lines.length === 1}
                      onClick={() =>
                        setLines((prev) => prev.filter((_, n) => n !== i))
                      }
                      title="Remove line"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-8 gap-1.5"
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  { description: "", quantity: "1", unitPrice: "" },
                ])
              }
            >
              <Plus className="size-3.5" />
              Add line
            </Button>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">
              Note on the invoice
            </span>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. 50% upfront, balance on delivery"
            />
          </label>

          <div className="flex items-baseline justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
            <span className="text-sm text-muted-foreground">
              Total
              <span className="ms-1.5 text-xs">
                ({lines.length} {lines.length === 1 ? "line" : "lines"})
              </span>
            </span>
            <span className="text-lg font-semibold tabular-nums">
              {money(total, currency)}
            </span>
          </div>
        </DialogPanel>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !clientName.trim() || total <= 0}
          >
            Create &amp; copy pay link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoicesPage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["invoices"],
    queryFn: async (): Promise<{ items: Invoice[] }> => {
      const r = await fetch(getApiUrl("invoice"), { credentials: "include" });
      if (!r.ok) throw new Error("Could not load invoices");
      return r.json();
    },
    /*
     * An invoice goes PAID because a client paid it, not because anyone here
     * clicked anything — the Stripe webhook writes that row while this screen
     * sits open. Poll it so the status and the outstanding total follow along.
     * TanStack pauses this interval while the tab is unfocused, and the focus
     * refetch covers the return, so a minute is plenty.
     */
    refetchInterval: 60_000,
  });

  const markPaid = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(getApiUrl(`invoice/${id}/mark-paid`), {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Marked paid");
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not update"),
  });

  const items = data?.items ?? [];
  const outstanding = items
    // Test invoices are not money owed; counting them would misstate the number
    // the owner reads at a glance.
    .filter((i) => i.status !== "PAID" && !i.test)
    .reduce((s, i) => s + (Number(i.balanceDue) || 0), 0);

  return (
    <Layout>
      <PageTitle title="Invoices" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Invoices</h1>
        {items.length > 0 ? (
          <span className="text-sm text-muted-foreground">
            {money(outstanding, items[0]?.currency ?? "USD")} outstanding
          </span>
        ) : null}
        <Button
          size="sm"
          className="ms-auto gap-1.5"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-3.5" />
          New invoice
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="p-5 text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <div className="p-10 text-center">
            <Wallet className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="font-medium">No invoices yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              A signed proposal creates one automatically. For a client who pays
              without signing, create one here.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 text-left font-medium">Client</th>
                <th className="px-3 py-2.5 text-left font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Total</th>
                <th className="px-3 py-2.5 text-right font-medium">Due</th>
                <th className="px-3 py-2.5 text-left font-medium">Issued</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((inv) => (
                <tr
                  key={inv.id}
                  className="border-b border-border last:border-0 hover:bg-muted/40"
                >
                  <td className="px-5 py-3 font-medium">
                    {inv.clientName ?? "—"}
                    {inv.test ? (
                      <span className="ms-2 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                        test
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-xs font-medium",
                        statusClass(inv.status),
                      )}
                    >
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {money(Number(inv.grandTotal) || 0, inv.currency)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">
                    {inv.status === "PAID"
                      ? "—"
                      : money(Number(inv.balanceDue) || 0, inv.currency)}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {inv.issueDate
                      ? new Date(inv.issueDate).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(inv.payUrl)
                            .catch(() => {});
                          toast.success("Pay link copied");
                        }}
                      >
                        <Copy className="size-3.5" />
                        Link
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5"
                        render={
                          <a
                            href={inv.payUrl}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        <Link2 className="size-3.5" />
                        Open
                      </Button>
                      {inv.status !== "PAID" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5"
                          disabled={markPaid.isPending}
                          onClick={() => markPaid.mutate(inv.id)}
                          title="Bank transfer, cash, or a card taken by phone"
                        >
                          <Send className="size-3.5" />
                          Mark paid
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CreateInvoiceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() =>
          queryClient.invalidateQueries({ queryKey: ["invoices"] })
        }
      />
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/invoices")({
  component: InvoicesPage,
});
