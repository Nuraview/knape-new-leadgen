/**
 * The social content scheduler — drafted posts, their creatives, the approval
 * trail.
 *
 * These rows are SHARED with the client's original cockpit, the same way the
 * project board is: one social_posts table, two dashboards. A post approved
 * here shows as approved there. The schedule already held months of Knape
 * content before this app could display any of it.
 *
 * Everything goes through the CRM's own /api/leadgen proxy — see client.ts for
 * why the browser never talks to the cockpit directly.
 */
import { getApiUrl } from "@/fetchers/get-api-url";
import { leadgen } from "./client";

/** Statuses a post moves through. `scheduled`/`failed` are publisher-only. */
export type SocialStatus =
  | "draft"
  | "pending_approval"
  | "needs_changes"
  | "approved"
  | "scheduled"
  | "published"
  | "failed";

export type SocialMedia = {
  id: number;
  post_id: number;
  kind: "image" | "video";
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
};

export type SocialPost = {
  id: number;
  status: SocialStatus;
  title: string | null;
  body: string;
  /** Epoch SECONDS, not milliseconds — the cockpit is a Python service. */
  scheduled_at: number | null;
  timezone: string;
  approved_by: string | null;
  approved_at: number | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  linkedin_post_url?: string | null;
  published_at?: number | null;
  media?: SocialMedia[];
  comment_count?: number;
};

export type SocialComment = {
  id: number;
  post_id: number;
  author: string | null;
  kind: "comment" | "change_request" | "approval";
  body: string;
  created_at: number;
};

export type SocialPostDetail = {
  post: SocialPost;
  media: SocialMedia[];
  comments: SocialComment[];
};

/**
 * Direct URL for a creative, for use as an <img src>.
 *
 * Same-origin, so the browser attaches the CRM session cookie on its own and
 * the proxy adds the cockpit bearer server-side. The upstream service also
 * accepts `?token=` for exactly this case; going through the proxy means that
 * token never appears in a URL, where it would be recorded in browser history
 * and every access log along the way.
 */
export function socialMediaUrl(mediaId: number): string {
  return getApiUrl(`/leadgen/api/social/media/${mediaId}/file`);
}

export const leadgenSocial = {
  /**
   * Posts for one month, as "YYYY-MM".
   *
   * Upstream also returns UNSCHEDULED drafts alongside the month's posts, on
   * purpose — a post with no date belongs to no calendar cell, and silently
   * omitting it would let a draft vanish from every view at once.
   */
  list: (month?: string, status?: SocialStatus) =>
    leadgen.get<{ statuses: SocialStatus[]; posts: SocialPost[] }>(
      "/api/social/posts",
      { month, status },
    ),

  detail: (postId: number) =>
    leadgen.get<SocialPostDetail>(`/api/social/posts/${postId}`),

  create: (input: {
    body: string;
    title?: string | null;
    scheduled_at?: number | null;
    timezone?: string | null;
  }) => leadgen.post<{ post: SocialPost }>("/api/social/posts", input),

  /**
   * Partial edit. Only the keys present are changed — omitting `scheduled_at`
   * leaves the schedule alone, whereas sending it as null unschedules the post.
   */
  update: (
    postId: number,
    patch: Partial<{
      body: string;
      title: string | null;
      scheduled_at: number | null;
      timezone: string | null;
    }>,
  ) => leadgen.patch<{ post: SocialPost }>(`/api/social/posts/${postId}`, patch),

  approve: (postId: number) =>
    leadgen.post<{ post: SocialPost }>(`/api/social/posts/${postId}/approve`),

  requestChanges: (postId: number, comment: string) =>
    leadgen.post<{ post: SocialPost }>(
      `/api/social/posts/${postId}/request-changes`,
      { comment },
    ),

  submit: (postId: number) =>
    leadgen.post<{ post: SocialPost }>(`/api/social/posts/${postId}/submit`),

  comment: (postId: number, body: string) =>
    leadgen.post<{ comment: SocialComment }>(
      `/api/social/posts/${postId}/comments`,
      { body },
    ),

  markPublished: (postId: number, url: string) =>
    leadgen.post<{ post: SocialPost }>(`/api/social/posts/${postId}/published`, {
      url,
    }),

  remove: (postId: number) =>
    leadgen.del<{ deleted: boolean }>(`/api/social/posts/${postId}`),

  removeMedia: (mediaId: number) =>
    leadgen.del<{ deleted: boolean }>(`/api/social/media/${mediaId}`),

  /**
   * Upload a creative.
   *
   * The file bytes ARE the request body — no multipart, with the metadata in
   * query params. That is upstream's design and it happens to be what lets the
   * proxy forward the bytes untouched; a multipart body would have to be parsed
   * and re-encoded in the middle, and anything that decodes image bytes as text
   * corrupts them silently.
   *
   * Hand-rolled rather than routed through `leadgen.post`, which JSON-stringifies
   * its body.
   */
  uploadMedia: async (
    postId: number,
    file: File,
  ): Promise<{ media: SocialMedia }> => {
    const url = new URL(
      getApiUrl(`/leadgen/api/social/posts/${postId}/media`),
      window.location.origin,
    );
    url.searchParams.set("file_name", file.name);
    url.searchParams.set(
      "content_type",
      file.type || "application/octet-stream",
    );

    const response = await fetch(url.toString(), {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });

    if (!response.ok) {
      let message = response.statusText || `Upload failed (${response.status})`;
      try {
        const problem = await response.json();
        if (typeof problem?.message === "string") message = problem.message;
        else if (typeof problem?.detail === "string") message = problem.detail;
      } catch {
        // Non-JSON body; keep the status text.
      }
      throw new Error(message);
    }

    return (await response.json()) as { media: SocialMedia };
  },
};
