import { HTTPException } from "hono/http-exception";

/**
 * The lifecycle of a scheduled post, and the rules that make the approval gate
 * mean something.
 *
 * Enforcement is HERE, on the server. The UI hides buttons it should not offer,
 * but hiding a button from someone who can still PATCH the row is not a
 * workflow.
 */

/** In the order a post moves through them. */
export const POST_STATUSES = [
  "draft",
  "pending_approval",
  "needs_changes",
  "approved",
  "published",
  "failed",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export function isPostStatus(value: string): value is PostStatus {
  return (POST_STATUSES as readonly string[]).includes(value);
}

/**
 * Who may move where.
 *
 * `published` is terminal on purpose — the post exists on LinkedIn now, and the
 * only honest way back is the explicit un-publish path, which refuses when we
 * were the ones who posted it. `failed` reopens to `approved` so a fixed post
 * gets a fresh set of publish attempts.
 */
const ALLOWED_TRANSITIONS: Record<PostStatus, readonly PostStatus[]> = {
  draft: ["pending_approval"],
  pending_approval: ["approved", "needs_changes"],
  needs_changes: ["pending_approval"],
  approved: ["needs_changes", "pending_approval", "published"],
  published: [],
  failed: ["approved"],
};

export function assertTransition(from: string, to: PostStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from as PostStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new HTTPException(400, {
      message: `A ${LABELS[from as PostStatus] ?? from} post cannot become ${LABELS[to]}`,
    });
  }
}

/** Human wording for error messages, so a 400 reads like a sentence. */
const LABELS: Record<PostStatus, string> = {
  draft: "draft",
  pending_approval: "awaiting approval",
  needs_changes: "changes-requested",
  approved: "approved",
  published: "published",
  failed: "failed",
};

/**
 * Statuses a post may be marked published from.
 *
 * Draft / pending / needs_changes are excluded deliberately: if something went
 * out without the tick, that is a review problem, and recording it here would
 * paper over it.
 */
export const MANUAL_PUBLISH_FROM: readonly string[] = [
  "approved",
  "failed",
  "published",
];
