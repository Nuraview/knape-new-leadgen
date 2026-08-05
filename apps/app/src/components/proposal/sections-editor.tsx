import { useMemo, useState } from "react";
import { safeFileName, uploadProposalFile } from "@/lib/proposal-upload";
import { toast } from "@/lib/toast";
import * as Lucide from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Copy, GripVertical, ImagePlus, Plus, Trash2, X, Star, Upload } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  ProposalSection,
  ScopeItem,
  TimelinePhase,
  PricingRow,
  Testimonial,
} from "@/types/proposal";

// Vite has no SSR, so Next's dynamic() wrapper is unnecessary — this is the
// same CKEditor component the composer uses, imported directly.
import { CkEditor } from "@/components/marketing/ck-editor";

const newSectionKey = () => `custom-${crypto.randomUUID()}`;

// Section kinds an author can add. `scope` = feature cards (icon + bullets).
type SectionKind = "richtext" | "scope" | "pricing" | "timeline" | "testimonials";
const KINDS: { kind: SectionKind; label: string; title: string }[] = [
  { kind: "richtext", label: "Rich text", title: "New Section" },
  { kind: "scope", label: "Feature cards", title: "Proposed Solution" },
  { kind: "pricing", label: "Pricing table", title: "Tools & Investment" },
  { kind: "timeline", label: "Timeline", title: "Project Timeline" },
  { kind: "testimonials", label: "Testimonials", title: "Testimonial" },
];

// Default section scaffold for a brand-new proposal.
const DEFS: { key: string; title: string; type: "richtext" | "scope" | "timeline"; rows?: number }[] = [
  { key: "intro", title: "Introduction", type: "richtext", rows: 8 },
  { key: "scope", title: "Scope of Work", type: "scope" },
  { key: "timeline", title: "Timeline", type: "timeline" },
  { key: "terms", title: "Terms & Conditions", type: "richtext", rows: 4 },
];

function freshSection(d: (typeof DEFS)[number], order: number): ProposalSection {
  return {
    key: d.key,
    type: d.type,
    title: d.title,
    bodyHtml: "",
    bodyJson: null,
    order,
    bannerUrl: null,
    items: d.type === "scope" ? [{ title: "", description: "" }] : undefined,
    phases: d.type === "timeline" ? [{ label: "Initial draft", duration: "1–2 days" }] : undefined,
    clientField: d.type === "timeline" ? { label: "Time taken by you", unit: "days" } : undefined,
  };
}

export function buildDefaultSections(existing?: ProposalSection[] | null): ProposalSection[] {
  if (existing && existing.length) {
    return [...existing]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((s, i) => ({ ...s, order: i }));
  }
  return DEFS.map((d, i) => freshSection(d, i));
}

// New author-added section, scaffolded per kind.
function makeSection(kind: SectionKind): ProposalSection {
  const base = { key: newSectionKey(), order: 0, bannerUrl: null as string | null, bodyHtml: "", bodyJson: null };
  const def = KINDS.find((k) => k.kind === kind)!;
  switch (kind) {
    case "scope":
      return { ...base, type: "scope", title: def.title, items: [{ title: "", icon: "Sparkles", description: "", bullets: [""] }] };
    case "pricing":
      return {
        ...base, type: "pricing", title: def.title,
        rows: [{ item: "", type: "One-time", amount: "", included: false }],
        totalLabel: "Total Investment", totalType: "One-time", totalAmount: "",
      };
    case "timeline":
      return {
        ...base, type: "timeline", title: def.title,
        phases: [{ label: "Initial draft", duration: "1–2 days" }],
        clientField: { label: "Time taken by you", unit: "days" },
      };
    case "testimonials":
      return { ...base, type: "testimonials", title: def.title, testimonials: [{ name: "", role: "", quote: "", rating: 5 }] };
    default:
      return { ...base, type: "richtext", title: def.title };
  }
}

/* ── object-store upload helper (icons, avatars, banners) ── */
async function uploadImage(file: File, prefix: string): Promise<string> {
  return uploadProposalFile(file, `${prefix}/${Date.now()}-${safeFileName(file.name)}`);
}

function BannerUpload({ url, onChange }: { url: string | null | undefined; onChange: (u: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try { onChange(await uploadImage(file, "proposal-banners")); }
    catch { toast.error("Banner upload failed"); }
    finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-3">
      {url ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="banner" className="h-12 rounded object-cover" />
          <button type="button" onClick={() => onChange(null)}
            className="absolute -right-2 -top-2 rounded-full border bg-background p-0.5 text-muted-foreground">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ImagePlus className="h-4 w-4" />
          {busy ? "Uploading…" : "Add banner"}
          <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={busy} />
        </label>
      )}
    </div>
  );
}

/* ── lucide icon picker (marketplace) + custom upload ── */
const ICON_EXCLUDE = new Set(["Icon", "LucideIcon", "createLucideIcon"]);
const ICON_NAMES: string[] = Object.keys(Lucide).filter((k) => {
  if (!/^[A-Z][A-Za-z0-9]+$/.test(k) || ICON_EXCLUDE.has(k) || k.endsWith("Icon")) return false;
  const v = (Lucide as any)[k];
  return typeof v === "object" || typeof v === "function"; // forwardRef component
});

function IconPicker({ value, onChange }: { value?: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const base = term ? ICON_NAMES.filter((n) => n.toLowerCase().includes(term)) : ICON_NAMES;
    return base.slice(0, 60);
  }, [q]);

  const isUrl = value && /^https?:\/\//.test(value);
  const Current = value && !isUrl ? (Lucide as any)[value] : null;

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try { onChange(await uploadImage(file, "proposal-icons")); setOpen(false); }
    catch { toast.error("Icon upload failed"); }
    finally { setBusy(false); }
  };

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} title="Choose icon"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-muted/40 text-muted-foreground hover:text-foreground">
        {isUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value!} alt="" className="h-5 w-5 object-contain" />
        ) : Current ? (
          <Current className="h-5 w-5" />
        ) : (
          <Lucide.Sparkles className="h-5 w-5" />
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-30 w-72 rounded-lg border bg-popover p-3 shadow-xl">
          <div className="mb-2 flex items-center gap-2">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search icons…" className="h-8 text-sm" autoFocus />
            <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid max-h-56 grid-cols-8 gap-1 overflow-y-auto">
            {results.map((name) => {
              const Cmp = (Lucide as any)[name];
              return (
                <button key={name} type="button" title={name}
                  onClick={() => { onChange(name); setOpen(false); }}
                  className={`flex h-7 w-7 items-center justify-center rounded hover:bg-accent ${value === name ? "bg-accent ring-1 ring-primary" : ""}`}>
                  <Cmp className="h-4 w-4" />
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t pt-2">
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <Upload className="h-3.5 w-3.5" /> {busy ? "Uploading…" : "Upload custom"}
              <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={busy} />
            </label>
            {value && (
              <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="text-xs text-muted-foreground hover:text-red-600">Clear</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AvatarUpload({ url, name, onChange }: { url?: string | null; name?: string; onChange: (u: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try { onChange(await uploadImage(file, "proposal-avatars")); }
    catch { toast.error("Avatar upload failed"); }
    finally { setBusy(false); }
  };
  return (
    <label className="relative flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border bg-muted text-xs text-muted-foreground">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : busy ? "…" : (name?.charAt(0).toUpperCase() || <ImagePlus className="h-4 w-4" />)}
      <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={busy} />
    </label>
  );
}

export function SectionsEditor({
  sections,
  onChange,
}: {
  sections: ProposalSection[];
  onChange: (s: ProposalSection[]) => void;
}) {
  const patch = (key: string, p: Partial<ProposalSection>) =>
    onChange(sections.map((s) => (s.key === key ? { ...s, ...p } : s)));

  const reindex = (list: ProposalSection[]) => list.map((s, i) => ({ ...s, order: i }));
  const remove = (key: string) => onChange(reindex(sections.filter((s) => s.key !== key)));

  const duplicate = (key: string) => {
    const idx = sections.findIndex((s) => s.key === key);
    if (idx < 0) return;
    const src = sections[idx];
    const copy: ProposalSection = {
      ...src,
      key: newSectionKey(),
      title: `${src.title} (copy)`,
      items: src.items ? src.items.map((it) => ({ ...it, bullets: it.bullets ? [...it.bullets] : undefined })) : undefined,
      phases: src.phases ? src.phases.map((p) => ({ ...p })) : undefined,
      rows: src.rows ? src.rows.map((r) => ({ ...r })) : undefined,
      testimonials: src.testimonials ? src.testimonials.map((t) => ({ ...t })) : undefined,
      clientField: src.clientField ? { ...src.clientField } : src.clientField,
    };
    const next = [...sections];
    next.splice(idx + 1, 0, copy);
    onChange(reindex(next));
  };

  const addSection = (kind: SectionKind, where: "start" | "end") =>
    onChange(reindex(where === "start" ? [makeSection(kind), ...sections] : [...sections, makeSection(kind)]));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = sections.findIndex((s) => s.key === active.id);
    const newI = sections.findIndex((s) => s.key === over.id);
    if (oldI < 0 || newI < 0) return;
    onChange(reindex(arrayMove(sections, oldI, newI)));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <AddMenu onAdd={(k) => addSection(k, "start")} />
      <SortableContext items={sections.map((s) => s.key)} strategy={verticalListSortingStrategy}>
        <div className="space-y-6">
          {sections.map((s) => (
            <SortableSection key={s.key} s={s} patch={patch} onDelete={remove} onDuplicate={duplicate} />
          ))}
        </div>
      </SortableContext>
      <AddMenu onAdd={(k) => addSection(k, "end")} />
    </DndContext>
  );
}

function AddMenu({ onAdd }: { onAdd: (kind: SectionKind) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative my-6">
      <Button type="button" variant="outline" onClick={() => setOpen((o) => !o)}
        className="w-full border-dashed py-6 text-muted-foreground hover:text-foreground">
        <Plus className="mr-1.5 h-4 w-4" /> Add Section
      </Button>
      {open && (
        <div className="absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-lg border bg-popover p-1 shadow-xl">
          {KINDS.map((k) => (
            <button key={k.kind} type="button" onClick={() => { onAdd(k.kind); setOpen(false); }}
              className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent">
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortableSection({
  s, patch, onDelete, onDuplicate,
}: {
  s: ProposalSection;
  patch: (key: string, p: Partial<ProposalSection>) => void;
  onDelete: (key: string) => void;
  onDuplicate: (key: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.key });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="space-y-3 rounded-lg border bg-background p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button type="button" {...attributes} {...listeners} title="Drag to reorder"
            className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing">
            <GripVertical className="h-4 w-4" />
          </button>
          <Input value={s.title} onChange={(e) => patch(s.key, { title: e.target.value })}
            className="max-w-xs font-medium" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }} />
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {KINDS.find((k) => k.kind === s.type)?.label ?? s.type}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <BannerUpload url={s.bannerUrl} onChange={(u) => patch(s.key, { bannerUrl: u })} />
          <button type="button" onClick={() => onDuplicate(s.key)} title="Duplicate section" className="text-muted-foreground hover:text-foreground">
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => onDelete(s.key)} title="Delete section" className="text-muted-foreground hover:text-red-600">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {s.type === "richtext" && (
        <CkEditor content={s.bodyHtml} placeholder={`Write the ${s.title.toLowerCase()}…`}
          uploadUrl="/api/proposals/ckeditor-upload"
          onChange={(html) => patch(s.key, { bodyHtml: html, bodyJson: null })} />
      )}

      {s.type === "scope" && (
        <ScopeEditor items={s.items ?? []} onChange={(items) => patch(s.key, { items })} />
      )}

      {s.type === "pricing" && (
        <PricingEditor s={s} patch={(p) => patch(s.key, p)} />
      )}

      {s.type === "testimonials" && (
        <TestimonialsEditor list={s.testimonials ?? []} onChange={(testimonials) => patch(s.key, { testimonials })} />
      )}

      {s.type === "timeline" && (
        <TimelineEditor
          phases={s.phases ?? []}
          clientField={s.clientField ?? { label: "Time taken by you", unit: "days" }}
          onPhases={(phases) => patch(s.key, { phases })}
          onClientField={(clientField) => patch(s.key, { clientField })} />
      )}
    </div>
  );
}

/* ── Feature cards (scope): icon + title + description + bullets ── */
function ScopeEditor({ items, onChange }: { items: ScopeItem[]; onChange: (i: ScopeItem[]) => void }) {
  const set = (i: number, p: Partial<ScopeItem>) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
  const setBullet = (i: number, bi: number, v: string) =>
    set(i, { bullets: (items[i].bullets ?? []).map((b, idx) => (idx === bi ? v : b)) });
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i} className="rounded-lg border p-3">
          <div className="flex items-start gap-3">
            <IconPicker value={it.icon} onChange={(icon) => set(i, { icon })} />
            <div className="flex-1 space-y-1.5">
              <Input value={it.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="Card title (e.g. Dashboard Features)" className="font-medium" />
              <Input value={it.description ?? ""} onChange={(e) => set(i, { description: e.target.value })} placeholder="Optional one-line description" className="text-sm" />
            </div>
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="mt-2 text-muted-foreground hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 space-y-1.5 pl-[52px]">
            {(it.bullets ?? []).map((b, bi) => (
              <div key={bi} className="flex items-center gap-2">
                <span className="text-muted-foreground">•</span>
                <Input value={b} onChange={(e) => setBullet(i, bi, e.target.value)} placeholder="Bullet point" className="h-8 text-sm" />
                <button type="button" onClick={() => set(i, { bullets: (it.bullets ?? []).filter((_, idx) => idx !== bi) })} className="text-muted-foreground hover:text-red-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground"
              onClick={() => set(i, { bullets: [...(it.bullets ?? []), ""] })}>
              <Plus className="mr-1 h-3 w-3" /> Add bullet
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm"
        onClick={() => onChange([...items, { title: "", icon: "Sparkles", description: "", bullets: [""] }])}>
        <Plus className="mr-1 h-4 w-4" /> Add card
      </Button>
    </div>
  );
}

/* ── Pricing table: rows + total + callout ── */
function PricingEditor({ s, patch }: { s: ProposalSection; patch: (p: Partial<ProposalSection>) => void }) {
  const rows = s.rows ?? [];
  const setRow = (i: number, p: Partial<PricingRow>) => patch({ rows: rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)) });
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={r.item} onChange={(e) => setRow(i, { item: e.target.value })} placeholder="Item (e.g. Claude AI Subscription)" className="h-8 flex-1 text-sm" />
            <Input value={r.type ?? ""} onChange={(e) => setRow(i, { type: e.target.value })} placeholder="Type (Monthly)" className="h-8 w-28 text-sm" />
            <Input value={String(r.amount ?? "")} onChange={(e) => setRow(i, { amount: e.target.value })} placeholder="$100" className="h-8 w-24 text-sm" />
            <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              <input type="checkbox" checked={!!r.included} onChange={(e) => setRow(i, { included: e.target.checked })} /> Incl.
            </label>
            <button type="button" onClick={() => patch({ rows: rows.filter((_, idx) => idx !== i) })} className="text-muted-foreground hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => patch({ rows: [...rows, { item: "", type: "One-time", amount: "", included: false }] })}>
          <Plus className="mr-1 h-4 w-4" /> Add row
        </Button>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 p-2">
        <span className="text-xs text-muted-foreground">Total row</span>
        <Input value={s.totalLabel ?? ""} onChange={(e) => patch({ totalLabel: e.target.value })} placeholder="Total Investment" className="h-8 flex-1 text-sm" />
        <Input value={s.totalType ?? ""} onChange={(e) => patch({ totalType: e.target.value })} placeholder="One-time" className="h-8 w-28 text-sm" />
        <Input value={String(s.totalAmount ?? "")} onChange={(e) => patch({ totalAmount: e.target.value })} placeholder="$1,000" className="h-8 w-24 text-sm" />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Callout (optional — appears below the table)</Label>
        <Textarea value={s.bodyHtml ?? ""} onChange={(e) => patch({ bodyHtml: e.target.value })}
          placeholder="What this covers… (plain text or simple HTML)" rows={3} className="mt-1 text-sm" />
      </div>
    </div>
  );
}

/* ── Testimonials slider entries ── */
function TestimonialsEditor({ list, onChange }: { list: Testimonial[]; onChange: (t: Testimonial[]) => void }) {
  const set = (i: number, p: Partial<Testimonial>) => onChange(list.map((t, idx) => (idx === i ? { ...t, ...p } : t)));
  return (
    <div className="space-y-3">
      {list.map((t, i) => (
        <div key={i} className="rounded-lg border p-3">
          <div className="flex items-start gap-3">
            <AvatarUpload url={t.avatarUrl} name={t.name} onChange={(u) => set(i, { avatarUrl: u })} />
            <div className="flex-1 space-y-1.5">
              <div className="flex gap-2">
                <Input value={t.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Name" className="h-8 flex-1 text-sm font-medium" />
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" onClick={() => set(i, { rating: n })} className="text-amber-500">
                      <Star className="h-4 w-4" fill={(t.rating ?? 5) >= n ? "currentColor" : "none"} />
                    </button>
                  ))}
                </div>
              </div>
              <Input value={t.role ?? ""} onChange={(e) => set(i, { role: e.target.value })} placeholder="Role / company" className="h-8 text-sm" />
            </div>
            <button type="button" onClick={() => onChange(list.filter((_, idx) => idx !== i))} className="mt-2 text-muted-foreground hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <Input value={t.highlight ?? ""} onChange={(e) => set(i, { highlight: e.target.value })} placeholder="Bold highlight line (optional)" className="mt-2 h-8 text-sm" />
          <Textarea value={t.quote} onChange={(e) => set(i, { quote: e.target.value })} placeholder="Testimonial quote" rows={3} className="mt-2 text-sm" />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...list, { name: "", role: "", quote: "", rating: 5 }])}>
        <Plus className="mr-1 h-4 w-4" /> Add testimonial
      </Button>
    </div>
  );
}

/* ── Timeline (unchanged behaviour) ── */
function TimelineEditor({
  phases, clientField, onPhases, onClientField,
}: {
  phases: TimelinePhase[];
  clientField: { label: string; unit: "days" | "hours" };
  onPhases: (p: TimelinePhase[]) => void;
  onClientField: (c: { label: string; unit: "days" | "hours" }) => void;
}) {
  const set = (i: number, p: Partial<TimelinePhase>) => onPhases(phases.map((ph, idx) => (idx === i ? { ...ph, ...p } : ph)));
  return (
    <div className="space-y-2">
      {phases.map((ph, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input value={ph.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Phase (e.g. Revisions)" className="flex-1" />
          <Input value={ph.duration} onChange={(e) => set(i, { duration: e.target.value })} placeholder="2–3 days" className="w-32" />
          <button type="button" onClick={() => onPhases(phases.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-red-600">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onPhases([...phases, { label: "", duration: "" }])}>
        <Plus className="mr-1 h-4 w-4" /> Add phase
      </Button>
      <div className="mt-3 rounded-md border border-dashed bg-muted/30 p-3">
        <Label className="text-xs">Client-editable row (sets expectations)</Label>
        <div className="mt-1 flex gap-2">
          <Input value={clientField.label} onChange={(e) => onClientField({ ...clientField, label: e.target.value })} placeholder="Time taken by you" className="flex-1" />
          <select value={clientField.unit} onChange={(e) => onClientField({ ...clientField, unit: e.target.value as "days" | "hours" })}
            className="rounded-md border bg-background px-2 text-sm">
            <option value="days">days</option>
            <option value="hours">hours</option>
          </select>
        </div>
      </div>
    </div>
  );
}
