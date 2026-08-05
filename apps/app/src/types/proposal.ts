import { z } from "zod/v4";

/* ------------------------------------------------------------------ */
/*  Shared constants                                                   */
/* ------------------------------------------------------------------ */

export const PROPOSAL_STATUSES = [
  "DRAFT", "SENT", "VIEWED", "APPROVED", "REJECTED", "EXPIRED", "PAID",
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PRICING_MODES = ["FIXED", "LINE_ITEMS"] as const;
export const PAYMENT_METHODS = ["stripe", "paypal", "bank"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Payment method labels + processing-fee % (applied dynamically to the total). */
export const PAYMENT_METHOD_META: Record<
  PaymentMethod,
  { label: string; pct: number; hint: string }
> = {
  stripe: { label: "Stripe (Card)", pct: 3.5, hint: "+3.5% processing fee" },
  paypal: { label: "PayPal", pct: 5, hint: "+5% processing fee" },
  bank: { label: "Direct transfer", pct: 0, hint: "no fee" },
};
export const ASSET_CATEGORIES = ["RECENT", "GENERAL"] as const;
export const PROPOSAL_THEMES = ["creative", "formal"] as const;

/* ------------------------------------------------------------------ */
/*  Design tokens — seeded from a code preset (design-presets.ts).     */
/*  accent + font pair + layout drive the public viewer & PDF look.    */
/* ------------------------------------------------------------------ */

export const PRESET_FONTS = ["serif", "sans", "display"] as const;
export type PresetFont = (typeof PRESET_FONTS)[number];

export const designTokensSchema = z
  .object({
    accentColor: z.string(),
    fontDisplay: z.enum(PRESET_FONTS),
    fontBody: z.enum(PRESET_FONTS),
    bg: z.string(),
    layout: z.enum(["centered", "wide"]),
  })
  .partial();

export type DesignTokens = z.infer<typeof designTokensSchema>;

/** Default section scaffold for a new proposal (intro → scope → timeline → terms). */
export const DEFAULT_SECTION_KEYS = [
  "intro", "scope", "portfolio", "pricing", "timeline", "terms", "cta",
] as const;

/* ------------------------------------------------------------------ */
/*  Section schema — discriminated by `type`; all share base fields.   */
/*  richtext: bodyHtml | scope: items[] | timeline: phases[]+clientField */
/* ------------------------------------------------------------------ */

export const scopeItemSchema = z.object({
  title: z.string().default(""),
  description: z.string().default(""),
  // v4 feature-card mode: lucide icon name OR an uploaded image URL + bullets
  icon: z.string().optional().nullable(),
  bullets: z.array(z.string()).optional(),
});
export type ScopeItem = z.infer<typeof scopeItemSchema>;

export const timelinePhaseSchema = z.object({
  label: z.string().default(""),
  duration: z.string().default(""),
});
export type TimelinePhase = z.infer<typeof timelinePhaseSchema>;

/* v4: pricing-table section rows (ITEM / TYPE / AMOUNT + Included badge). */
export const pricingRowSchema = z.object({
  item: z.string().default(""),
  type: z.string().default(""),
  amount: z.union([z.string(), z.number()]).optional(),
  included: z.boolean().optional(),
});
export type PricingRow = z.infer<typeof pricingRowSchema>;

/* v4: testimonial slider entries. */
export const testimonialSchema = z.object({
  name: z.string().default(""),
  role: z.string().optional(),
  quote: z.string().default(""),
  avatarUrl: z.string().optional().nullable(),
  rating: z.number().min(0).max(5).optional(),
  highlight: z.string().optional(),
});
export type Testimonial = z.infer<typeof testimonialSchema>;

export const proposalSectionSchema = z.object({
  key: z.string().min(1),
  type: z.string().default("richtext"), // richtext | scope | timeline | pricing | testimonials
  title: z.string().default(""),
  bodyHtml: z.string().default(""),
  bodyJson: z.any().optional().nullable(),
  order: z.number().int().min(0),
  // v2: optional designed banner image per section (Abib art → Blob URL)
  bannerUrl: z.string().optional().nullable(),
  // v2 scope: structured list (v4: items may carry icon + bullets = feature cards)
  items: z.array(scopeItemSchema).optional(),
  // v2 timeline: phase rows + a client-editable final row
  phases: z.array(timelinePhaseSchema).optional(),
  clientField: z
    .object({
      label: z.string().default("Time taken by you"),
      unit: z.enum(["days", "hours"]).default("days"),
    })
    .optional()
    .nullable(),
  // v4 pricing table: rows + a highlighted total row (bodyHtml = callout note)
  rows: z.array(pricingRowSchema).optional(),
  totalLabel: z.string().optional(),
  totalAmount: z.union([z.string(), z.number()]).optional(),
  totalType: z.string().optional(),
  // v4 testimonials: one-at-a-time slider entries
  testimonials: z.array(testimonialSchema).optional(),
});

export type ProposalSection = z.infer<typeof proposalSectionSchema>;

/* ------------------------------------------------------------------ */
/*  Line item schema                                                   */
/* ------------------------------------------------------------------ */

export const proposalLineItemSchema = z.object({
  position: z.number().int().min(0),
  productId: z.string().uuid().optional().nullable(),
  description: z.string().min(1, "Description is required"),
  quantity: z.number().positive("Quantity must be positive"),
  unitPrice: z.number().min(0, "Unit price must be >= 0"),
  discountPercent: z.number().min(0).max(100).default(0),
  taxRateId: z.string().uuid().optional().nullable(),
  // dynamic client-adjustable quantity (e.g. # of pitch decks)
  clientAdjustable: z.boolean().default(false),
  minQty: z.number().min(0).optional().nullable(),
  maxQty: z.number().min(0).optional().nullable(),
  // volume/tier pricing: unit price drops as qty rises
  tiers: z
    .array(z.object({ minQty: z.number().min(1), unitPrice: z.number().min(0) }))
    .optional()
    .nullable(),
});

export type ProposalLineItemInput = z.infer<typeof proposalLineItemSchema>;

/* ------------------------------------------------------------------ */
/*  Create / update proposal                                           */
/* ------------------------------------------------------------------ */

const proposalBaseSchema = z.object({
  title: z.string().min(1, "Title is required"),
  accountId: z.string().uuid().optional().nullable(),
  contactId: z.string().uuid().optional().nullable(),
  currency: z.string().length(3, "Currency must be a 3-letter code"),
  clientName: z.string().optional().nullable(),
  clientCompany: z.string().optional().nullable(),
  clientEmail: z.string().optional().nullable(),
  clientAddress: z.string().optional().nullable(),
  projectName: z.string().optional().nullable(),
  proposalDate: z.coerce.date().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  theme: z.enum(PROPOSAL_THEMES).default("creative"),
  designPresetId: z.string().optional().nullable(),
  designTokens: designTokensSchema.optional().nullable(),
  videoUrl: z.string().optional().nullable(),
  scheduleCallUrl: z.string().optional().nullable(),
  sections: z.array(proposalSectionSchema).default([]),
  pricingMode: z.enum(PRICING_MODES).default("LINE_ITEMS"),
  fixedPrice: z.number().min(0).optional().nullable(),
  transactionFee: z.number().min(0).default(0),
  depositAmount: z.number().min(0).optional().nullable(),
  brandColor: z.string().optional().nullable(),
  publicNotes: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  lineItems: z.array(proposalLineItemSchema).default([]),
});

export const createProposalSchema = proposalBaseSchema;
export type CreateProposalInput = z.infer<typeof createProposalSchema>;

export const updateProposalSchema = proposalBaseSchema.partial().extend({
  id: z.string().uuid(),
});
export type UpdateProposalInput = z.infer<typeof updateProposalSchema>;

/* ------------------------------------------------------------------ */
/*  Save as template                                                   */
/* ------------------------------------------------------------------ */

export const saveAsTemplateSchema = z.object({
  proposalId: z.string().uuid(),
  templateName: z.string().min(1, "Template name is required"),
});

/* ------------------------------------------------------------------ */
/*  Public approval / signature                                        */
/* ------------------------------------------------------------------ */

export const approveProposalSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email().optional().nullable(),
  signatureType: z.enum(["DRAWN", "TYPED"]),
  // DRAWN: base64 PNG dataURL; TYPED: the typed name string
  signatureData: z.string().min(1, "Signature is required"),
  // client-adjusted quantities keyed by line item position
  adjustedQuantities: z.record(z.string(), z.number().positive()).optional(),
  // v2: chosen payment method + the client's "time taken by you" timeline input
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  clientTimeline: z
    .object({ value: z.number().min(0), unit: z.enum(["days", "hours"]) })
    .optional(),
});

export type ApproveProposalInput = z.infer<typeof approveProposalSchema>;

export const rejectProposalSchema = z.object({
  reason: z.string().optional().nullable(),
});
