"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { safeFileName, uploadProposalFile } from "@/lib/proposals/client-upload";
import { toast } from "sonner";
import { Trash2, UploadCloud, Loader2, FileText, Star, Plus } from "lucide-react";
import {
  registerProposalAsset,
  removeProposalAsset,
  updateProposalAsset,
  updatePortfolioConfig,
  type PortfolioConfig,
} from "@/actions/proposals/register-asset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Asset {
  id: string;
  title: string | null;
  kind: string;
  category?: string | null;
  featured?: boolean | null;
}

const CATS: { key: "RECENT" | "GENERAL"; label: string; hint: string }[] = [
  { key: "RECENT", label: "Recent Work (client's industry)", hint: "Feature up to 3 relevant decks" },
  { key: "GENERAL", label: "General Work (other industries)", hint: "Feature up to 3 of your best" },
];

function Zone({
  proposalId,
  category,
  busy,
  setBusy,
}: {
  proposalId: string;
  category: "RECENT" | "GENERAL";
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const router = useRouter();
  const onDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setBusy(true);
      try {
        const url = await uploadProposalFile(
          file,
          `proposals/${proposalId}/${Date.now()}-${safeFileName(file.name)}`,
        );
        await registerProposalAsset({
          proposalId,
          storageKey: url,
          title: file.name.replace(/\.[^.]+$/, ""),
          kind: file.type === "application/pdf" ? "PDF" : "IMAGE",
          fileSize: file.size,
          category,
          featured: true,
        });
        toast.success("Added");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setBusy(false);
      }
    },
    [proposalId, category, router, setBusy],
  );
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected: (rej) => {
      const err = rej[0]?.errors?.[0];
      toast.error(
        err?.code === "file-too-large"
          ? "File too large (max 100MB)"
          : err?.message || "That file type isn't supported (use PDF or an image)",
      );
    },
    maxFiles: 1,
    maxSize: 100 * 1024 * 1024,
    // Accept any image type + PDF (the explicit extension list was silently
    // rejecting design files / svgs).
    accept: { "application/pdf": [".pdf"], "image/*": [] },
    disabled: busy,
  });
  return (
    <div
      {...getRootProps()}
      className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
        isDragActive ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
      } ${busy ? "opacity-60" : ""}`}
    >
      <input {...getInputProps()} />
      {busy ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : <UploadCloud className="h-6 w-6 text-muted-foreground" />}
      <p className="text-xs text-muted-foreground">Drag &amp; drop a deck (PDF) or image · 100MB</p>
    </div>
  );
}

export function PortfolioManager({
  proposalId,
  assets,
  config,
}: {
  proposalId: string;
  assets: Asset[];
  config?: PortfolioConfig | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState<PortfolioConfig>(config ?? {});

  const saveCfg = async (patch: Partial<PortfolioConfig>) => {
    const next = { ...cfg, ...patch };
    setCfg(next);
    try {
      await updatePortfolioConfig(proposalId, next);
    } catch {
      toast.error("Couldn't save");
    }
  };

  // Multiple link buttons (migrate legacy single link on first load).
  const [links, setLinks] = useState<{ label?: string; url?: string }[]>(
    config?.links?.length
      ? config.links
      : config?.linkUrl || config?.linkLabel
        ? [{ label: config.linkLabel, url: config.linkUrl }]
        : [],
  );
  const setLink = (i: number, patch: { label?: string; url?: string }) =>
    setLinks((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLink = () => setLinks((ls) => [...ls, { label: "", url: "" }]);
  const removeLink = (i: number) => {
    const next = links.filter((_, idx) => idx !== i);
    setLinks(next);
    saveCfg({ links: next });
  };
  const commitLinks = () => saveCfg({ links });

  const onRemove = async (id: string) => {
    await removeProposalAsset(id, proposalId);
    toast.success("Removed");
    router.refresh();
  };
  const toggleFeatured = async (a: Asset) => {
    await updateProposalAsset(a.id, proposalId, { featured: !a.featured });
    router.refresh();
  };

  return (
    <div className="space-y-6">
      {/* Proposal header (hero) — subtitle, accent word, validity, prepared-for */}
      <div className="space-y-3 rounded-md border p-3">
        <div>
          <div className="text-sm font-medium">Proposal header</div>
          <div className="text-xs text-muted-foreground">Controls the dark hero at the top of the client page.</div>
        </div>
        <div>
          <Label className="text-xs">Subtitle (optional)</Label>
          <Textarea
            defaultValue={cfg.subtitle ?? ""}
            placeholder="A tailored proposal for building your… (leave blank to hide)"
            rows={2}
            className="mt-1 text-sm"
            onBlur={(e) => saveCfg({ subtitle: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Accent word (after title)</Label>
            <Input
              defaultValue={cfg.titleAccentWord ?? "Proposal"}
              placeholder="Proposal (blank = hide)"
              className="mt-1 h-8 text-sm"
              onBlur={(e) => saveCfg({ titleAccentWord: e.target.value.trim() === "" ? null : e.target.value })}
            />
          </div>
          <div>
            <Label className="text-xs">Prepared-for role</Label>
            <Input
              defaultValue={cfg.preparedForRole ?? ""}
              placeholder="e.g. Principal"
              className="mt-1 h-8 text-sm"
              onBlur={(e) => saveCfg({ preparedForRole: e.target.value || null })}
            />
          </div>
          <div>
            <Label className="text-xs">Logo tagline</Label>
            <Input
              defaultValue={cfg.logoTagline ?? ""}
              placeholder="blank = none"
              className="mt-1 h-8 text-sm"
              onBlur={(e) => saveCfg({ logoTagline: e.target.value || null })}
            />
          </div>
          <div>
            <Label className="text-xs">Valid for (days)</Label>
            <Input
              type="number"
              min={0}
              defaultValue={cfg.validDays ?? ""}
              placeholder="blank = hide"
              className="mt-1 h-8 text-sm"
              onBlur={(e) => {
                const v = e.target.value.trim();
                saveCfg({ validDays: v === "" ? null : parseInt(v, 10), showValidity: v !== "" });
              }}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            defaultChecked={cfg.showInvestment !== false}
            onChange={(e) => saveCfg({ showInvestment: e.target.checked })}
          />
          Show the Investment total in the &quot;Prepared for&quot; card
        </label>
      </div>

      {CATS.map((cat) => {
        const list = assets.filter((a) => (a.category ?? "GENERAL") === cat.key);
        return (
          <div key={cat.key} className="space-y-2">
            <div>
              <div className="text-sm font-medium">{cat.label}</div>
              <div className="text-xs text-muted-foreground">{cat.hint}</div>
            </div>
            <Input
              defaultValue={cat.key === "RECENT" ? cfg.recentTitle ?? "" : cfg.generalTitle ?? ""}
              placeholder={`Client-facing title (e.g. ${cat.key === "RECENT" ? "Your Branding Designs" : "Selected Work"})`}
              onBlur={(e) => saveCfg(cat.key === "RECENT" ? { recentTitle: e.target.value } : { generalTitle: e.target.value })}
              className="h-8 text-sm"
            />
            {list.length > 0 && (
              <ul className="space-y-1.5">
                {list.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{a.title || "Untitled"}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <button
                        type="button"
                        title="Feature (show on proposal)"
                        onClick={() => toggleFeatured(a)}
                        className={a.featured ? "text-amber-500" : "text-muted-foreground hover:text-amber-500"}
                      >
                        <Star className="h-4 w-4" fill={a.featured ? "currentColor" : "none"} />
                      </button>
                      <button type="button" onClick={() => onRemove(a.id)} className="text-muted-foreground hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Zone proposalId={proposalId} category={cat.key} busy={busy} setBusy={setBusy} />
          </div>
        );
      })}

      {/* Link box — note + CTA shown below the portfolio on the client page */}
      <div className="space-y-2 rounded-md border p-3">
        <div>
          <div className="text-sm font-medium">Link box (below the portfolio)</div>
          <div className="text-xs text-muted-foreground">
            A note + button on the client&apos;s proposal (e.g. a payment link). Leave URL blank to jump to Investment.
          </div>
        </div>
        <Textarea
          defaultValue={cfg.note ?? ""}
          placeholder="Short note (optional)"
          rows={2}
          onBlur={(e) => saveCfg({ note: e.target.value })}
        />
        <div className="space-y-2">
          {links.map((lnk, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={lnk.label ?? ""}
                placeholder="Button label (e.g. Pay now)"
                onChange={(e) => setLink(i, { label: e.target.value })}
                onBlur={commitLinks}
                className="h-8 text-sm"
              />
              <Input
                value={lnk.url ?? ""}
                placeholder="https://… (blank = Investment)"
                onChange={(e) => setLink(i, { url: e.target.value })}
                onBlur={commitLinks}
                className="h-8 text-sm"
              />
              <button
                type="button"
                onClick={() => removeLink(i)}
                className="shrink-0 text-muted-foreground hover:text-red-600"
                aria-label="Remove link"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addLink}>
            <Plus className="mr-1 h-4 w-4" /> Add link
          </Button>
        </div>
      </div>
    </div>
  );
}
