"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ProposalPricing,
  newLineRow,
  type ProposalLineRow,
} from "./proposal-pricing";
import { TotalsPanel } from "@/app/(routes)/invoices/components/totals-panel";
import { AccountSearchCombobox } from "@/components/ui/account-search-combobox";
import { createProposal } from "@/actions/proposals/create-proposal";
import { updateProposal } from "@/actions/proposals/update-proposal";
import type { DesignTokens, ProposalSection } from "@/types/proposal";
import { SectionsEditor, buildDefaultSections } from "./sections-editor";

export interface PresetSeed {
  id: string;
  theme: "creative" | "formal";
  brandColor: string;
  designTokens: DesignTokens;
  sections: ProposalSection[];
  lineItems: { description: string; quantity: number; unitPrice: number; discountPercent: number }[];
}

interface Product {
  id: string;
  name: string;
}
interface TaxRate {
  id: string;
  name: string;
  rate: string;
}
interface Currency {
  code: string;
  name: string;
}

interface InitialData {
  id: string;
  title: string;
  accountId: string | null;
  currency: string;
  clientName: string | null;
  clientCompany: string | null;
  clientEmail: string | null;
  clientAddress: string | null;
  projectName: string | null;
  expiresAt: string | null;
  theme: string | null;
  videoUrl: string | null;
  scheduleCallUrl: string | null;
  transactionFee: string | null;
  publicNotes: string | null;
  internalNotes: string | null;
  sections: ProposalSection[] | null;
  lineItems: Array<{
    productId: string | null;
    description: string;
    quantity: string;
    unitPrice: string;
    discountPercent: string;
    taxRateId: string | null;
    clientAdjustable?: boolean;
    minQty?: string | null;
    maxQty?: string | null;
    tiers?: { minQty: number; unitPrice: number }[] | null;
  }>;
}

// Pre-fill for the client fields when starting a fresh proposal from a contact
// (e.g. the "Generate proposal" action on the Contacts tab). Only used when
// there's no `initialData` (i.e. a brand-new proposal).
export interface ClientSeed {
  clientName?: string;
  clientCompany?: string;
  clientEmail?: string;
}

interface ProposalFormProps {
  products: Product[];
  taxRates: TaxRate[];
  currencies: Currency[];
  defaultCurrency?: string;
  initialData?: InitialData;
  preset?: PresetSeed;
  clientSeed?: ClientSeed;
}

export function ProposalForm({
  products,
  taxRates,
  currencies,
  defaultCurrency,
  initialData,
  preset,
  clientSeed,
}: ProposalFormProps) {
  const router = useRouter();
  const locale = useLocale();
  const [saving, setSaving] = useState(false);
  const isEdit = !!initialData;

  const [title, setTitle] = useState(initialData?.title ?? "");
  const [accountId, setAccountId] = useState(initialData?.accountId ?? "");
  const [currency, setCurrency] = useState(
    initialData?.currency ?? defaultCurrency ?? "USD",
  );
  const [clientName, setClientName] = useState(
    initialData?.clientName ?? clientSeed?.clientName ?? "",
  );
  const [clientCompany, setClientCompany] = useState(
    initialData?.clientCompany ?? clientSeed?.clientCompany ?? "",
  );
  const [clientEmail, setClientEmail] = useState(
    initialData?.clientEmail ?? clientSeed?.clientEmail ?? "",
  );
  const [clientAddress, setClientAddress] = useState(initialData?.clientAddress ?? "");
  const [projectName, setProjectName] = useState(initialData?.projectName ?? "");
  const [theme, setTheme] = useState(initialData?.theme ?? preset?.theme ?? "creative");
  const [designPresetId] = useState<string | null>(preset?.id ?? null);
  const [designTokens] = useState<DesignTokens | null>(preset?.designTokens ?? null);
  const [brandColor] = useState<string | null>(preset?.brandColor ?? null);
  const [videoUrl, setVideoUrl] = useState(initialData?.videoUrl ?? "");
  const [scheduleCallUrl, setScheduleCallUrl] = useState(initialData?.scheduleCallUrl ?? "");
  const [expiresAt, setExpiresAt] = useState(() =>
    initialData?.expiresAt
      ? new Date(initialData.expiresAt).toISOString().split("T")[0]
      : "",
  );
  const [publicNotes, setPublicNotes] = useState(initialData?.publicNotes ?? "");
  const [internalNotes, setInternalNotes] = useState(
    initialData?.internalNotes ?? "",
  );

  const [sections, setSections] = useState<ProposalSection[]>(() =>
    buildDefaultSections(initialData?.sections ?? preset?.sections),
  );

  const [lineItems, setLineItems] = useState<ProposalLineRow[]>(() => {
    if (initialData?.lineItems?.length) {
      return initialData.lineItems.map((li) => ({
        productId: li.productId ?? "",
        description: li.description,
        quantity: parseFloat(li.quantity) || 1,
        unitPrice: parseFloat(li.unitPrice) || 0,
        discountPercent: parseFloat(li.discountPercent) || 0,
        taxRateId: li.taxRateId ?? "",
        clientAdjustable: li.clientAdjustable ?? false,
        minQty: li.minQty != null ? parseFloat(li.minQty) : null,
        maxQty: li.maxQty != null ? parseFloat(li.maxQty) : null,
        tiers: Array.isArray(li.tiers)
          ? li.tiers.map((t) => ({ minQty: Number(t.minQty), unitPrice: Number(t.unitPrice) }))
          : [],
      }));
    }
    if (preset?.lineItems?.length) {
      return preset.lineItems.map((li) => ({
        ...newLineRow(),
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        discountPercent: li.discountPercent,
      }));
    }
    return [newLineRow()];
  });

  const getTaxRateValue = (taxRateId: string) => {
    const tr = taxRates.find((t) => t.id === taxRateId);
    return tr ? parseFloat(tr.rate) : 0;
  };

  const totalsInput = lineItems.map((li) => ({
    quantity: li.quantity,
    unitPrice: li.unitPrice,
    discountPercent: li.discountPercent,
    taxRate: getTaxRateValue(li.taxRateId),
  }));

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Please enter a title");
      return;
    }

    setSaving(true);
    try {
      const body = {
        title,
        accountId: accountId || null,
        currency,
        clientName: clientName || null,
        clientCompany: clientCompany || null,
        clientEmail: clientEmail || null,
        clientAddress: clientAddress || null,
        projectName: projectName || null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        theme,
        designPresetId: designPresetId,
        designTokens: designTokens,
        brandColor: brandColor,
        videoUrl: videoUrl || null,
        scheduleCallUrl: scheduleCallUrl || null,
        sections,
        pricingMode: "LINE_ITEMS" as const,
        transactionFee: 0,
        publicNotes: publicNotes || null,
        internalNotes: internalNotes || null,
        lineItems: lineItems
          .filter((l) => l.description)
          .map((l, i) => ({
            position: i,
            productId: l.productId || null,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent,
            taxRateId: l.taxRateId || null,
            clientAdjustable: l.clientAdjustable,
            minQty: l.minQty,
            maxQty: l.maxQty,
            tiers: l.tiers && l.tiers.length ? l.tiers : null,
          })),
      };

      const result = isEdit
        ? await updateProposal({ id: initialData.id, ...body })
        : await createProposal(body);

      toast.success(isEdit ? "Proposal updated" : "Proposal created");
      router.push(`/proposals/${result.id}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save proposal");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
      <div className="space-y-6">
        <div className="space-y-2">
          <Label>Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Brand & Pitch Deck Proposal"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Account (optional)</Label>
            <AccountSearchCombobox
              value={accountId}
              onChange={setAccountId}
              placeholder="Link an account..."
            />
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} - {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Valid Until</Label>
            <Input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Client Name</Label>
            <Input value={clientName} onChange={(e) => setClientName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Client Company</Label>
            <Input value={clientCompany} onChange={(e) => setClientCompany(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Project Name</Label>
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Client Email</Label>
            <Input
              type="email"
              value={clientEmail}
              onChange={(e) => setClientEmail(e.target.value)}
              placeholder="client@company.com"
            />
          </div>
          <div className="space-y-2">
            <Label>Client Address</Label>
            <Input
              value={clientAddress}
              onChange={(e) => setClientAddress(e.target.value)}
              placeholder="Street, City, Country (for formal docs)"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Theme</Label>
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="creative">Creative (brand-accented)</SelectItem>
                <SelectItem value="formal">Formal (white / minimal)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Video pitch URL</Label>
            <Input
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="Loom / YouTube link (optional)"
            />
          </div>
          <div className="space-y-2">
            <Label>Schedule-a-call URL</Label>
            <Input
              value={scheduleCallUrl}
              onChange={(e) => setScheduleCallUrl(e.target.value)}
              placeholder="tidycal.com/… (optional)"
            />
          </div>
        </div>

        <div>
          <Label className="mb-3 block">Proposal Sections</Label>
          <SectionsEditor sections={sections} onChange={setSections} />
        </div>

        <div>
          <Label className="mb-3 block">Pricing</Label>
          <ProposalPricing
            items={lineItems}
            onChange={setLineItems}
            products={products}
            taxRates={taxRates}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Public Notes</Label>
            <Textarea value={publicNotes} onChange={(e) => setPublicNotes(e.target.value)} rows={3} />
          </div>
          <div className="space-y-2">
            <Label>Internal Notes</Label>
            <Textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={3} />
          </div>
        </div>

        <div className="flex gap-3">
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving..." : isEdit ? "Update Draft" : "Save Draft"}
          </Button>
          <Button variant="outline" onClick={() => router.back()} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <TotalsPanel lineItems={totalsInput} currency={currency} locale={locale} />
      </div>
    </div>
  );
}
