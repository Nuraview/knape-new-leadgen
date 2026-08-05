// Source of truth for the status model the reviewer actually works with.
// Per client (Apr 2026): the only actionable statuses are "Follow-up" and
// "Lost". Everything else (New / Reviewed / Contacted / Closed / Qualified)
// is dropped from the dropdown, the chip, and the stripe — the reviewer
// wants a binary "should I chase this" / "this is dead" decision and
// nothing in between. The "irrelevant" mark is a separate dimension and
// stays unaffected.
//
// Color picks:
//   Follow-up  — orange (needs action — chase it)
//   Lost       — rose   (dead — don't waste time)
//
// Anything else (legacy values still in DB on old leads, or null) falls
// back to NEUTRAL so it visually recedes; the chip is hidden entirely
// (see isAllowedStatus + the LeadsList / KanbanBoard render guards).

export type StatusColor = {
  stripe: string;
  chip: string;
};

const NEUTRAL: StatusColor = {
  stripe: "border-l-zinc-300 dark:border-l-zinc-700",
  chip: "bg-muted text-muted-foreground border-border",
};

// Render order for the dropdown. Keep this list authoritative — adding a
// status here is the only step needed to surface it across loadStatuses,
// the chip, and the stripe.
export const ALLOWED_STATUSES = ["Follow-up", "Lost"] as const;
export type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

const PALETTE: Record<AllowedStatus, StatusColor> = {
  "Follow-up": {
    stripe: "border-l-orange-500",
    chip:
      "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  },
  Lost: {
    stripe: "border-l-rose-500",
    chip:
      "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  },
};

export function isAllowedStatus(
  name: string | null | undefined,
): name is AllowedStatus {
  return !!name && (ALLOWED_STATUSES as readonly string[]).includes(name);
}

export function statusColor(name: string | null | undefined): StatusColor {
  if (!isAllowedStatus(name)) return NEUTRAL;
  return PALETTE[name];
}
