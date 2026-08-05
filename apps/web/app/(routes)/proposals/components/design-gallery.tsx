"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DESIGN_PRESETS, type DesignPreset } from "@/lib/proposals/design-presets";
import { FileText } from "lucide-react";

const FONT_STACK: Record<string, string> = {
  serif: "Georgia, 'Times New Roman', serif",
  sans: "ui-sans-serif, system-ui, sans-serif",
  display: "'Trebuchet MS', 'Segoe UI', sans-serif",
};

function Swatch({ preset }: { preset: DesignPreset }) {
  const t = preset.designTokens;
  const accent = t.accentColor ?? preset.brandColor;
  const bg = t.bg ?? "#ffffff";
  const display = FONT_STACK[t.fontDisplay ?? "serif"];
  return (
    <div className="h-36 w-full overflow-hidden rounded-md ring-1 ring-border" style={{ backgroundColor: bg }}>
      <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}99)` }} />
      <div className="p-4">
        <div className="text-[10px] uppercase tracking-widest" style={{ color: accent }}>
          Proposal
        </div>
        <div className="mt-2 text-lg font-semibold leading-tight text-stone-900" style={{ fontFamily: display }}>
          {preset.name}
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="h-1.5 w-3/4 rounded bg-stone-300/70" />
          <div className="h-1.5 w-2/3 rounded bg-stone-300/50" />
          <div className="h-1.5 w-1/2 rounded bg-stone-300/40" />
        </div>
      </div>
    </div>
  );
}

/** Design picker shown on /proposals/new when no ?preset is chosen. */
export function DesignGallery() {
  // Carry any prefilled client info (from Contacts → "Generate proposal")
  // through the design pick so the form still receives it.
  const sp = useSearchParams();
  const newProposalHref = (presetId: string) => {
    const params = new URLSearchParams();
    for (const key of ["clientName", "clientCompany", "clientEmail"]) {
      const v = sp.get(key);
      if (v) params.set(key, v);
    }
    params.set("preset", presetId);
    return `/proposals/new?${params.toString()}`;
  };

  return (
    <div>
      <p className="mb-5 text-sm text-muted-foreground">
        Start from a professionally designed template, or a blank proposal.
      </p>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {DESIGN_PRESETS.map((preset) => (
          <Link
            key={preset.id}
            href={newProposalHref(preset.id)}
            className="group rounded-xl border p-3 transition-all hover:shadow-md hover:ring-1 hover:ring-primary/40"
          >
            <Swatch preset={preset} />
            <div className="px-1 pt-3">
              <div className="font-medium">{preset.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{preset.blurb}</div>
            </div>
          </Link>
        ))}

        {/* Blank */}
        <Link
          href={newProposalHref("blank")}
          className="group flex flex-col items-center justify-center rounded-xl border border-dashed p-3 text-center transition-all hover:shadow-md hover:ring-1 hover:ring-primary/40 min-h-[14rem]"
        >
          <FileText className="h-8 w-8 text-muted-foreground" />
          <div className="mt-3 font-medium">Blank proposal</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Start from scratch</div>
        </Link>
      </div>
    </div>
  );
}
