"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { safeFileName, uploadProposalFile } from "@/lib/proposals/client-upload";
import { updateProposalSettings } from "@/actions/proposals/update-settings";

interface Settings {
  baseCurrency: string;
  defaultExpiryDays: number;
  brandColor: string | null;
  fontFamily: string | null;
  companyName: string | null;
  companyEmail: string | null;
  companyWebsite: string | null;
  footerText: string | null;
  defaultTermsHtml: string | null;
  logoStorageKey: string | null;
  clientAvatars: string[] | null;
  scheduleCallUrl: string | null;
  postSignRedirectUrl: string | null;
  stripeFeePercent: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIban: string | null;
  bankSwift: string | null;
  bankRouting: string | null;
  bankInstructions: string | null;
}

export function ProposalSettingsForm({ settings }: { settings: Settings | null }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [baseCurrency, setBaseCurrency] = useState(settings?.baseCurrency ?? "USD");
  const [defaultExpiryDays, setDefaultExpiryDays] = useState(settings?.defaultExpiryDays ?? 30);
  const [brandColor, setBrandColor] = useState(settings?.brandColor ?? "#2563eb");
  const [companyName, setCompanyName] = useState(settings?.companyName ?? "");
  const [companyEmail, setCompanyEmail] = useState(settings?.companyEmail ?? "");
  const [companyWebsite, setCompanyWebsite] = useState(settings?.companyWebsite ?? "");
  const [footerText, setFooterText] = useState(settings?.footerText ?? "");
  const [defaultTermsHtml, setDefaultTermsHtml] = useState(settings?.defaultTermsHtml ?? "");
  const [logoUrl, setLogoUrl] = useState(settings?.logoStorageKey ?? "");
  const [logoBusy, setLogoBusy] = useState(false);

  const onLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoBusy(true);
    try {
      const url = await uploadProposalFile(
        file,
        `proposal-branding/logo-${Date.now()}-${safeFileName(file.name)}`,
      );
      setLogoUrl(url);
      toast.success("Logo uploaded");
    } catch {
      toast.error("Logo upload failed");
    } finally {
      setLogoBusy(false);
    }
  };
  const [avatars, setAvatars] = useState((settings?.clientAvatars ?? []).join("\n"));
  const [scheduleCallUrl, setScheduleCallUrl] = useState(settings?.scheduleCallUrl ?? "");
  const [postSignRedirectUrl, setPostSignRedirectUrl] = useState(settings?.postSignRedirectUrl ?? "");
  const [stripeFeePercent, setStripeFeePercent] = useState(
    settings?.stripeFeePercent ? parseFloat(settings.stripeFeePercent) : 3.5,
  );
  const [bankName, setBankName] = useState(settings?.bankName ?? "");
  const [bankAccountName, setBankAccountName] = useState(settings?.bankAccountName ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(settings?.bankAccountNumber ?? "");
  const [bankIban, setBankIban] = useState(settings?.bankIban ?? "");
  const [bankSwift, setBankSwift] = useState(settings?.bankSwift ?? "");
  const [bankRouting, setBankRouting] = useState(settings?.bankRouting ?? "");
  const [bankInstructions, setBankInstructions] = useState(settings?.bankInstructions ?? "");

  const save = async () => {
    setSaving(true);
    try {
      await updateProposalSettings({
        baseCurrency,
        defaultExpiryDays: Number(defaultExpiryDays) || 30,
        brandColor,
        companyName: companyName || null,
        companyEmail: companyEmail || null,
        companyWebsite: companyWebsite || null,
        footerText: footerText || null,
        defaultTermsHtml: defaultTermsHtml || null,
        logoStorageKey: logoUrl || null,
        clientAvatars: avatars
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
        scheduleCallUrl: scheduleCallUrl || null,
        postSignRedirectUrl: postSignRedirectUrl || null,
        stripeFeePercent: Number(stripeFeePercent) || 3.5,
        bankName: bankName || null,
        bankAccountName: bankAccountName || null,
        bankAccountNumber: bankAccountNumber || null,
        bankIban: bankIban || null,
        bankSwift: bankSwift || null,
        bankRouting: bankRouting || null,
        bankInstructions: bankInstructions || null,
      });
      toast.success("Settings saved");
      router.refresh();
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Base Currency</Label>
          <Input value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value.toUpperCase().slice(0, 3))} />
        </div>
        <div className="space-y-2">
          <Label>Default Expiry (days)</Label>
          <Input type="number" value={defaultExpiryDays} onChange={(e) => setDefaultExpiryDays(parseInt(e.target.value) || 30)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Brand Color</Label>
          <div className="flex gap-2 items-center">
            <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-9 w-12 rounded border" />
            <Input value={brandColor} onChange={(e) => setBrandColor(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Company Name</Label>
          <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Company Email</Label>
          <Input value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Company Website</Label>
          <Input value={companyWebsite} onChange={(e) => setCompanyWebsite(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Logo</Label>
        {logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="logo" className="h-12 mb-2 object-contain" />
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={onLogoFile}
          disabled={logoBusy}
          className="text-sm"
        />
        {logoBusy && <p className="text-xs text-muted-foreground">Uploading to Blob…</p>}
      </div>

      <div className="space-y-2">
        <Label>Client Avatars (one image URL per line — the &quot;happy faces&quot;)</Label>
        <Textarea rows={4} value={avatars} onChange={(e) => setAvatars(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label>Default Terms &amp; Conditions</Label>
        <Textarea rows={4} value={defaultTermsHtml} onChange={(e) => setDefaultTermsHtml(e.target.value)} />
      </div>

      <div className="space-y-2">
        <Label>Footer Text</Label>
        <Input value={footerText} onChange={(e) => setFooterText(e.target.value)} />
      </div>

      <div className="rounded-lg border p-4 space-y-4">
        <div className="text-sm font-semibold">Payments &amp; Scheduling</div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Schedule-a-call URL</Label>
            <Input value={scheduleCallUrl} onChange={(e) => setScheduleCallUrl(e.target.value)} placeholder="tidycal.com/…" />
          </div>
          <div className="space-y-2">
            <Label>Stripe processing fee %</Label>
            <Input type="number" step="0.1" value={stripeFeePercent} onChange={(e) => setStripeFeePercent(parseFloat(e.target.value) || 0)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label>After-sign redirect URL (e.g. your LinkedIn)</Label>
          <Input value={postSignRedirectUrl} onChange={(e) => setPostSignRedirectUrl(e.target.value)} placeholder="https://www.linkedin.com/in/…" />
          <p className="text-xs text-muted-foreground">When set, signing a proposal skips the online payment step and sends the client straight here.</p>
        </div>
        <div className="text-xs font-medium text-muted-foreground pt-1">Direct bank transfer details (shown to clients who pick bank transfer)</div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2"><Label>Bank name</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} /></div>
          <div className="space-y-2"><Label>Account name</Label><Input value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} /></div>
          <div className="space-y-2"><Label>Account number</Label><Input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value)} /></div>
          <div className="space-y-2"><Label>IBAN</Label><Input value={bankIban} onChange={(e) => setBankIban(e.target.value)} /></div>
          <div className="space-y-2"><Label>SWIFT/BIC</Label><Input value={bankSwift} onChange={(e) => setBankSwift(e.target.value)} /></div>
          <div className="space-y-2"><Label>Routing</Label><Input value={bankRouting} onChange={(e) => setBankRouting(e.target.value)} /></div>
        </div>
        <div className="space-y-2">
          <Label>Transfer instructions</Label>
          <Textarea rows={2} value={bankInstructions} onChange={(e) => setBankInstructions(e.target.value)} placeholder="Reference / notes for the client" />
        </div>
      </div>

      <Button onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save Settings"}
      </Button>
    </div>
  );
}
