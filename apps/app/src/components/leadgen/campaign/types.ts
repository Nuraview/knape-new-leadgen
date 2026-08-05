/**
 * One campaign run, as the wizard builds it up.
 *
 * Held in the URL rather than component state so a refresh mid-run does not
 * lose the choices — step 4 can take minutes over 200 leads, and a reload that
 * dumped you back at step 1 would be the worst moment for it.
 */
export type CampaignDraft = {
  /** How many leads to draft for. */
  total: number;
  /** null = rotate all ten deterministically per account. */
  angle: string | null;
  /** Sends per batch, and the wait between batches. */
  batchSize: number;
  intervalMinutes: number;
};

export const DEFAULT_DRAFT: CampaignDraft = {
  total: 50,
  angle: null,
  // 25 every 20 minutes is the cockpit's own default: enough to move 200 in a
  // working day without a receiving server seeing a blast.
  batchSize: 25,
  intervalMinutes: 20,
};

export const STEPS = [
  { key: "audience", label: "Audience" },
  { key: "message", label: "Message" },
  { key: "schedule", label: "Schedule" },
  { key: "generate", label: "Generate" },
  { key: "review", label: "Review" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];
