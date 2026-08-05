"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus, Layers } from "lucide-react";
import { tierUnitPrice } from "@/lib/proposals/tiers";

interface Product { id: string; name: string }
interface TaxRate { id: string; name: string; rate: string }

export interface ProposalLineRow {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  taxRateId: string;
  clientAdjustable: boolean;
  minQty: number | null;
  maxQty: number | null;
  tiers: { minQty: number; unitPrice: number }[];
}

export function newLineRow(): ProposalLineRow {
  return {
    productId: "", description: "", quantity: 1, unitPrice: 0, discountPercent: 0,
    taxRateId: "", clientAdjustable: false, minQty: null, maxQty: null, tiers: [],
  };
}

export function ProposalPricing({
  items,
  onChange,
  products,
  taxRates,
}: {
  items: ProposalLineRow[];
  onChange: (items: ProposalLineRow[]) => void;
  products: Product[];
  taxRates: TaxRate[];
}) {
  const [open, setOpen] = useState<number | null>(null);

  const update = (i: number, patch: Partial<ProposalLineRow>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const taxVal = (id: string) => { const t = taxRates.find((x) => x.id === id); return t ? parseFloat(t.rate) : 0; };
  const lineTotal = (it: ProposalLineRow) => {
    const unit = tierUnitPrice(it.unitPrice, it.quantity, it.tiers);
    const gross = it.quantity * unit;
    const sub = gross - (gross * it.discountPercent) / 100;
    return Math.round((sub + (sub * taxVal(it.taxRateId)) / 100) * 100) / 100;
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_2fr_70px_90px_70px_110px_80px_64px] gap-2 text-xs font-medium text-muted-foreground">
        <span>Product</span><span>Description</span><span>Qty</span><span>Unit Price</span>
        <span>Disc %</span><span>Tax Rate</span><span>Total</span><span />
      </div>

      {items.map((item, i) => {
        const panelOpen = open === i || item.clientAdjustable || item.tiers.length > 0;
        return (
          <div key={i} className="rounded-md">
            <div className="grid grid-cols-[1fr_2fr_70px_90px_70px_110px_80px_64px] items-center gap-2">
              <Select value={item.productId || "none"} onValueChange={(v) => {
                const p = products.find((x) => x.id === v);
                update(i, { productId: v === "none" ? "" : v, description: p?.name ?? item.description });
              }}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-</SelectItem>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input className="h-9 text-sm" value={item.description} placeholder="Description"
                onChange={(e) => update(i, { description: e.target.value })} />
              <Input className="h-9 text-sm" type="number" min={0} step="0.01" value={item.quantity}
                onChange={(e) => update(i, { quantity: parseFloat(e.target.value) || 0 })} />
              <Input className="h-9 text-sm" type="number" min={0} step="0.01" value={item.unitPrice}
                onChange={(e) => update(i, { unitPrice: parseFloat(e.target.value) || 0 })} />
              <Input className="h-9 text-sm" type="number" min={0} max={100} step="0.01" value={item.discountPercent}
                onChange={(e) => update(i, { discountPercent: parseFloat(e.target.value) || 0 })} />
              <Select value={item.taxRateId || "none"} onValueChange={(v) => update(i, { taxRateId: v === "none" ? "" : v })}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Tax..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {taxRates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.rate}%)</SelectItem>)}
                </SelectContent>
              </Select>
              <span className="text-sm tabular-nums">{lineTotal(item).toFixed(2)}</span>
              <div className="flex items-center gap-1">
                <button type="button" title="Volume pricing" onClick={() => setOpen(open === i ? null : i)}
                  className={`rounded p-1.5 ${panelOpen ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  <Layers className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => remove(i)} className="rounded p-1.5 text-muted-foreground hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {panelOpen && (
              <div className="mt-2 ml-2 space-y-3 rounded-md border bg-muted/30 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={item.clientAdjustable}
                    onChange={(e) => update(i, { clientAdjustable: e.target.checked })} />
                  Let the client choose the quantity (shows a +/- stepper)
                </label>
                {item.clientAdjustable && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Min</span>
                    <Input className="h-8 w-20 text-sm" type="number" min={0} value={item.minQty ?? ""}
                      onChange={(e) => update(i, { minQty: e.target.value === "" ? null : parseFloat(e.target.value) })} />
                    <span className="text-muted-foreground">Max</span>
                    <Input className="h-8 w-20 text-sm" type="number" min={0} value={item.maxQty ?? ""}
                      onChange={(e) => update(i, { maxQty: e.target.value === "" ? null : parseFloat(e.target.value) })} />
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-foreground">
                    Volume pricing — unit price drops as quantity rises (base = {item.unitPrice || 0})
                  </div>
                  {item.tiers.map((t, ti) => (
                    <div key={ti} className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">From</span>
                      <Input className="h-8 w-20 text-sm" type="number" min={1} value={t.minQty}
                        onChange={(e) => update(i, { tiers: item.tiers.map((x, xi) => xi === ti ? { ...x, minQty: parseFloat(e.target.value) || 0 } : x) })} />
                      <span className="text-muted-foreground">units →</span>
                      <Input className="h-8 w-24 text-sm" type="number" min={0} step="0.01" value={t.unitPrice}
                        onChange={(e) => update(i, { tiers: item.tiers.map((x, xi) => xi === ti ? { ...x, unitPrice: parseFloat(e.target.value) || 0 } : x) })} />
                      <span className="text-muted-foreground">each</span>
                      <button type="button" onClick={() => update(i, { tiers: item.tiers.filter((_, xi) => xi !== ti) })}
                        className="text-muted-foreground hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => update(i, { clientAdjustable: true, tiers: [...item.tiers, { minQty: 0, unitPrice: 0 }] })}>
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add tier
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, newLineRow()])}>
        <Plus className="mr-1 h-4 w-4" /> Add Line
      </Button>
    </div>
  );
}
