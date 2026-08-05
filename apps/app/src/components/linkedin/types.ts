import { getApiUrl } from "@/fetchers/get-api-url";

export type PostMedia = {
  id: string;
  kind: string;
  fileName: string;
  url: string;
  contentType?: string | null;
  sizeBytes?: number | null;
};

export type Post = {
  id: string;
  status: string;
  title: string | null;
  body: string;
  scheduledAt: string | null;
  timezone: string;
  approvedBy: string | null;
  approvedAt: string | null;
  shareToken: string | null;
  linkedinPostUrl: string | null;
  autoPublished: boolean;
  publishedAt: string | null;
  publishError: string | null;
  publishAttempts: number;
  createdBy: string | null;
  createdAt: string | null;
  media?: PostMedia[];
};

export type PostEvent = {
  id: string;
  author: string | null;
  kind: string;
  body: string;
  createdAt: string | null;
};

export type SchedulerMeta = {
  statuses: string[];
  angles: { key: string; name: string }[];
  storageConfigured: boolean;
  aiConfigured: boolean;
};

/** LinkedIn's hard cap. */
export const MAX_BODY = 3000;

/**
 * Roughly what fits above the feed's "…see more" fold. The real cut is three
 * rendered lines, which only the preview can measure — this is the number the
 * composer warns on so the hook gets written short in the first place.
 */
export const FOLD_HINT = 210;

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  needs_changes: "Changes requested",
  approved: "Approved",
  published: "Published",
  failed: "Publish failed",
};

/** Short form, for calendar chips where space is the constraint. */
export const STATUS_SHORT: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Awaiting",
  needs_changes: "Changes",
  approved: "Approved",
  published: "Live",
  failed: "Failed",
};

/** Same tone vocabulary the Orders page uses, so statuses read consistently. */
export const STATUS_TONE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  pending_approval: "bg-amber-500/15 text-amber-500",
  needs_changes: "bg-rose-500/15 text-rose-500",
  approved: "bg-emerald-500/15 text-emerald-500",
  published: "bg-primary/15 text-primary",
  failed: "bg-rose-500/15 text-rose-500",
};

/** The colour rail on a calendar chip / agenda card. */
export const STATUS_RAIL: Record<string, string> = {
  draft: "bg-muted-foreground/40",
  pending_approval: "bg-amber-500",
  needs_changes: "bg-rose-500",
  approved: "bg-emerald-500",
  published: "bg-primary",
  failed: "bg-rose-500",
};

export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "UTC",
];

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(getApiUrl(path), {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body?.message ?? message;
    } catch {
      /* keep the status text */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/** Raw-body upload — the bytes are the body, metadata rides in the query. */
export async function uploadCreative(postId: string, file: File): Promise<void> {
  const query = new URLSearchParams({
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
  });
  const res = await fetch(
    getApiUrl(`linkedin/posts/${postId}/media?${query}`),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    },
  );
  if (!res.ok) {
    let message = `Upload failed (${res.status})`;
    try {
      const body = await res.json();
      message = body?.message ?? message;
    } catch {
      /* keep the status */
    }
    throw new Error(message);
  }
}
