import type { DesignTokens, ProposalSection } from "@/types/proposal";

/**
 * Curated design presets — the "design template gallery".
 *
 * These live in code (not the DB) so the gallery is never blank, presets are
 * version-controlled, and adding a new design = adding an entry here. A preset
 * seeds a fresh proposal's sections, sample copy, accent colour, font pair, and
 * (optionally) sample line items. User-saved templates (isTemplate=true) render
 * alongside these but are a separate concept.
 *
 * Phase 1 ships three LIGHT presets. A true "Bold Dark" preset lands with the
 * dark public-viewer refactor (fast-follow).
 */

export interface PresetLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
}

export interface DesignPreset {
  id: string;
  name: string;
  blurb: string;
  /** Coarse theme kept for back-compat with the existing viewer/PDF fallback. */
  theme: "creative" | "formal";
  brandColor: string;
  designTokens: DesignTokens;
  buildSections: () => ProposalSection[];
  sampleLineItems?: PresetLineItem[];
}

/** Build the standard scaffold (intro → scope → timeline → terms) with copy. */
function scaffold(opts: {
  introHtml: string;
  scope: { title: string; description: string }[];
  phases: { label: string; duration: string }[];
  termsHtml: string;
}): ProposalSection[] {
  return [
    {
      key: "intro",
      type: "richtext",
      title: "Introduction",
      bodyHtml: opts.introHtml,
      bodyJson: null,
      order: 0,
      bannerUrl: null,
    },
    {
      key: "scope",
      type: "scope",
      title: "Scope of Work",
      bodyHtml: "",
      bodyJson: null,
      order: 1,
      bannerUrl: null,
      items: opts.scope,
    },
    {
      key: "timeline",
      type: "timeline",
      title: "Timeline",
      bodyHtml: "",
      bodyJson: null,
      order: 2,
      bannerUrl: null,
      phases: opts.phases,
      clientField: { label: "Time taken by you", unit: "days" },
    },
    {
      key: "terms",
      type: "richtext",
      title: "Terms & Conditions",
      bodyHtml: opts.termsHtml,
      bodyJson: null,
      order: 3,
      bannerUrl: null,
    },
  ];
}

export const DESIGN_PRESETS: DesignPreset[] = [
  {
    id: "minimal-white",
    name: "Minimal White",
    blurb: "Restrained, serif-led, near-black accent. Best for formal US clients.",
    theme: "formal",
    brandColor: "#1c1917",
    designTokens: {
      accentColor: "#1c1917",
      fontDisplay: "serif",
      fontBody: "sans",
      bg: "#ffffff",
      layout: "centered",
    },
    buildSections: () =>
      scaffold({
        introHtml:
          "<p>Thank you for the opportunity to put this together. Below is a clear, no-nonsense outline of how we'll approach the work, what you'll receive, and the timeline to delivery.</p>",
        scope: [
          { title: "Discovery & direction", description: "A short kickoff to align on goals, audience, and references." },
          { title: "Design & build", description: "The core deliverable, produced to a professional standard." },
          { title: "Revisions", description: "Two rounds of refinement to get every detail right." },
        ],
        phases: [
          { label: "Initial draft", duration: "1–2 days" },
          { label: "First review", duration: "1–2 days" },
          { label: "Revisions", duration: "2–3 days" },
          { label: "Final delivery", duration: "1 day" },
        ],
        termsHtml:
          "<p>50% deposit to begin, balance on delivery. Final files released after full payment. This proposal is valid for 14 days.</p>",
      }),
    sampleLineItems: [
      { description: "Project fee", quantity: 1, unitPrice: 150, discountPercent: 0 },
    ],
  },
  {
    id: "creative-branded",
    name: "Creative Branded",
    blurb: "Warm paper background, brand-accent headings, portfolio-forward.",
    theme: "creative",
    brandColor: "#c2410c",
    designTokens: {
      accentColor: "#c2410c",
      fontDisplay: "serif",
      fontBody: "sans",
      bg: "#f7f4ef",
      layout: "centered",
    },
    buildSections: () =>
      scaffold({
        introHtml:
          "<p>We're excited about this one. Here's our thinking, the work we'll deliver, and a few examples of recent projects in your space. We build to <strong>stand out</strong> — not blend in.</p>",
        scope: [
          { title: "Brand & visual direction", description: "A distinctive look tailored to your audience." },
          { title: "Production", description: "Pixel-perfect, on-brand assets ready to ship." },
          { title: "Handover", description: "Source files, guidelines, and a walkthrough." },
        ],
        phases: [
          { label: "Concept & moodboard", duration: "2–3 days" },
          { label: "First designs", duration: "2–3 days" },
          { label: "Revisions", duration: "2–3 days" },
          { label: "Final assets", duration: "1–2 days" },
        ],
        termsHtml:
          "<p>50% to start, 50% on completion. Two revision rounds included; additional rounds billed hourly. Valid for 14 days.</p>",
      }),
    sampleLineItems: [
      { description: "Creative package", quantity: 1, unitPrice: 600, discountPercent: 0 },
    ],
  },
  {
    id: "modern-bold",
    name: "Modern Bold",
    blurb: "Oversized display type, saturated accent, confident and modern.",
    theme: "creative",
    brandColor: "#4f46e5",
    designTokens: {
      accentColor: "#4f46e5",
      fontDisplay: "display",
      fontBody: "sans",
      bg: "#fafafa",
      layout: "wide",
    },
    buildSections: () =>
      scaffold({
        introHtml:
          "<p>Big goals deserve a bold plan. This proposal lays out exactly what we'll build, how fast, and what it costs — no surprises.</p>",
        scope: [
          { title: "Strategy", description: "Sharp positioning and a clear plan of attack." },
          { title: "Execution", description: "High-craft delivery, fast." },
          { title: "Launch support", description: "We stay close through go-live." },
        ],
        phases: [
          { label: "Kickoff", duration: "1 day" },
          { label: "Build", duration: "3–4 days" },
          { label: "Review & polish", duration: "2 days" },
          { label: "Launch", duration: "1 day" },
        ],
        termsHtml:
          "<p>50% deposit secures your slot. Balance due on delivery. Valid for 14 days.</p>",
      }),
    sampleLineItems: [
      { description: "Engagement fee", quantity: 1, unitPrice: 1200, discountPercent: 0 },
    ],
  },
];

export function getPreset(id: string | null | undefined): DesignPreset | null {
  if (!id) return null;
  return DESIGN_PRESETS.find((p) => p.id === id) ?? null;
}
