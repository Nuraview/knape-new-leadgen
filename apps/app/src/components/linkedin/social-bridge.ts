/**
 * Points the Scheduler at the content the client actually has.
 *
 * This app shipped a LinkedIn scheduler backed by the CRM's own
 * `nv_linkedin_*` tables in `knape_crm`. Those tables are EMPTY and always have
 * been. Knape's real content calendar — six months of drafted posts with their
 * creatives, approval trail and schedule — lives in `social_posts` in the
 * `leadgen` database, written by the client's original cockpit. The calendar
 * looked broken because it was faithfully rendering an empty table.
 *
 * So this is a translation layer, not a new feature. Every component under
 * components/linkedin/ is untouched; `api()` in ./types simply hands paths here
 * instead of to the CRM's own endpoints, and this file maps them onto the
 * cockpit's /api/social/* surface, proxied like everything else in the lead
 * domain. Same rows as the client's other dashboard: a post approved here is
 * approved there.
 *
 * Two shape gaps have to be closed on the way through:
 *
 *   1. WIRE FORMAT. The CRM's endpoints speak camelCase with ISO strings and
 *      string ids; the cockpit is Python and speaks snake_case with epoch
 *      SECONDS and integer ids.
 *
 *   2. TIMEZONE RESOLUTION. This is the one behavioural difference. The CRM's
 *      API accepted a wall-clock string plus a zone name and resolved them on
 *      the SERVER; the cockpit stores an already-resolved instant. So the
 *      resolution moves here — see zonedToEpoch, which has to be zone-correct
 *      rather than using the browser's offset, because the composer's clock
 *      field sits directly under a timezone picker naming a different zone.
 *
 * Deliberately absent: share links. Upstream can mint a token that grants
 * read access with no session, and the proxy refuses those paths (see the
 * DENIED list in apps/api/src/leadgen/index.ts). The share button is hidden
 * rather than left to fail.
 */
import {
  leadgenSocial,
  socialMediaUrl,
  type SocialComment,
  type SocialMedia,
  type SocialPost,
} from "@/fetchers/leadgen/social";
import type { Post, PostEvent, PostMedia, SchedulerMeta } from "./types";

/* -------------------------------------------------------------- timezones */

/**
 * How far `timeZone` sits from UTC at a given instant, in milliseconds.
 *
 * Formats the instant into the zone, reads the fields back as if they were
 * UTC, and takes the difference. This is the standard trick for getting a zone
 * offset out of Intl, which will not report one directly.
 */
function zoneOffsetMs(ts: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ts));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    // hour12:false yields 24 for midnight in some ICU versions.
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - ts;
}

/**
 * "YYYY-MM-DDTHH:mm" read in `timeZone` → epoch SECONDS.
 *
 * Iterated twice on purpose. The offset depends on the instant, but the
 * instant is what we are solving for, so the first pass uses the offset at the
 * wrong moment. One correction is enough everywhere except within an hour of a
 * DST transition, where the second pass settles it.
 */
export function zonedToEpoch(local: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let ts = naive;
  for (let i = 0; i < 2; i++) {
    let offset: number;
    try {
      offset = zoneOffsetMs(ts, timeZone);
    } catch {
      offset = 0; // Unknown zone name — fall back to UTC rather than throw.
    }
    ts = naive - offset;
  }
  return Math.floor(ts / 1000);
}

/** Epoch seconds → the "YYYY-MM-DD" that instant falls on in `timeZone`. */
function dayKeyOf(epoch: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(epoch * 1000));
  } catch {
    return new Date(epoch * 1000).toISOString().slice(0, 10);
  }
}

/** Epoch seconds → "HH:mm" clock in `timeZone`. */
function clockOf(epoch: number, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(epoch * 1000));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return `${String(Number(get("hour")) % 24).padStart(2, "0")}:${get("minute")}`;
  } catch {
    return "09:00";
  }
}

/* ----------------------------------------------------------------- mapping */

const iso = (epoch?: number | null): string | null =>
  epoch ? new Date(epoch * 1000).toISOString() : null;

function toMedia(m: SocialMedia): PostMedia {
  return {
    id: String(m.id),
    kind: m.kind,
    fileName: m.file_name,
    url: socialMediaUrl(m.id),
    contentType: m.content_type,
    sizeBytes: m.size_bytes,
  };
}

function toPost(p: SocialPost): Post {
  return {
    id: String(p.id),
    status: p.status,
    title: p.title,
    body: p.body,
    scheduledAt: iso(p.scheduled_at),
    timezone: p.timezone || "America/New_York",
    approvedBy: p.approved_by,
    approvedAt: iso(p.approved_at),
    // Share links are not proxied — see the file header.
    shareToken: null,
    linkedinPostUrl: p.linkedin_post_url ?? null,
    autoPublished: false,
    publishedAt: iso(p.published_at),
    publishError: null,
    publishAttempts: 0,
    createdBy: p.created_by,
    createdAt: iso(p.created_at),
    media: (p.media ?? []).map(toMedia),
  };
}

function toEvent(c: SocialComment): PostEvent {
  return {
    id: String(c.id),
    author: c.author,
    kind: c.kind,
    body: c.body,
    createdAt: iso(c.created_at),
  };
}

const META: SchedulerMeta = {
  statuses: [
    "draft",
    "pending_approval",
    "needs_changes",
    "approved",
    "published",
  ],
  // The cockpit has no per-post angle taxonomy and no draft-writing endpoint on
  // this surface, so the composer's AI helper stays switched off rather than
  // offering a button that 404s.
  angles: [],
  storageConfigured: true,
  aiConfigured: false,
};

/* ------------------------------------------------------------------ router */

type Json = Record<string, unknown>;

const POSTS = /^linkedin\/posts\/([^/?]+)(?:\/([^/?]+))?/;

/**
 * Serves one `api()` call from the cockpit.
 *
 * Returns `undefined` for a path this bridge does not handle, so the caller can
 * decide what to do rather than have an unknown route silently resolve to null.
 */
export async function routeSocial<T>(
  path: string,
  init?: RequestInit,
): Promise<T | undefined> {
  const method = (init?.method ?? "GET").toUpperCase();
  const payload: Json =
    typeof init?.body === "string" ? JSON.parse(init.body) : {};

  if (path.startsWith("linkedin/meta")) return META as T;

  /* ------------------------------------------------------------- the list */
  if (path.startsWith("linkedin/posts?") || path === "linkedin/posts") {
    if (method === "POST") {
      const tz = String(payload.timezone || "America/New_York");
      const local = payload.scheduledLocal
        ? String(payload.scheduledLocal)
        : null;
      const created = await leadgenSocial.create({
        body: String(payload.body ?? ""),
        title: (payload.title as string | null) ?? null,
        scheduled_at: local ? zonedToEpoch(local, tz) : null,
        timezone: tz,
      });
      return { post: toPost(created.post) } as T;
    }

    /*
     * The page asks for an absolute [from, to] window covering the month grid.
     * The cockpit filters by calendar month instead, and a six-week grid spans
     * two of them — so fetch unfiltered and window it here. This is a content
     * calendar measured in dozens of posts, not a feed; the request that would
     * save is not worth a card going missing from the row it belongs in.
     */
    const query = new URLSearchParams(path.split("?")[1] ?? "");
    const from = query.get("from");
    const to = query.get("to");
    const status = query.get("status") || undefined;

    const { posts } = await leadgenSocial.list(
      undefined,
      status as Parameters<typeof leadgenSocial.list>[1],
    );
    const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
    const toMs = to ? Date.parse(to) : Number.POSITIVE_INFINITY;

    const items = posts
      .filter((p) => {
        // Unscheduled drafts belong to no cell; the list view still shows them.
        if (!p.scheduled_at) return true;
        const ms = p.scheduled_at * 1000;
        return ms >= fromMs && ms <= toMs;
      })
      .map(toPost);

    return { items } as T;
  }

  /* ----------------------------------------------------- one post, and its
                                                            sub-resources    */
  const match = POSTS.exec(path);
  if (!match) return undefined;

  const id = Number(match[1]);
  const action = match[2];

  if (!action) {
    if (method === "GET") {
      const detail = await leadgenSocial.detail(id);
      return {
        post: toPost({ ...detail.post, media: detail.media }),
        media: (detail.media ?? []).map(toMedia),
        events: (detail.comments ?? []).map(toEvent),
      } as T;
    }

    if (method === "PATCH") {
      const patch: Parameters<typeof leadgenSocial.update>[1] = {};
      if ("body" in payload) patch.body = String(payload.body ?? "");
      if ("title" in payload)
        patch.title = (payload.title as string | null) ?? null;
      if ("timezone" in payload)
        patch.timezone = String(payload.timezone ?? "");

      /*
       * Two different ways the schedule moves, and they must not be conflated:
       *
       *   scheduledLocal — the composer's clock field. A whole new wall time.
       *   scheduledDate  — a drag onto another calendar cell. The DAY changes
       *                    and the clock time is preserved, which is why the
       *                    post has to be read first: the day alone does not
       *                    say what time it went out at.
       */
      if ("scheduledLocal" in payload) {
        const local = payload.scheduledLocal
          ? String(payload.scheduledLocal)
          : null;
        const tz =
          (payload.timezone as string | undefined) ??
          (await leadgenSocial.detail(id)).post.timezone ??
          "America/New_York";
        patch.scheduled_at = local ? zonedToEpoch(local, tz) : null;
      } else if ("scheduledDate" in payload) {
        const day = payload.scheduledDate
          ? String(payload.scheduledDate)
          : null;
        if (!day) {
          patch.scheduled_at = null;
        } else {
          const current = (await leadgenSocial.detail(id)).post;
          const tz = current.timezone || "America/New_York";
          const clock = current.scheduled_at
            ? clockOf(current.scheduled_at, tz)
            : "09:00";
          patch.scheduled_at = zonedToEpoch(`${day}T${clock}`, tz);
        }
      }

      const updated = await leadgenSocial.update(id, patch);
      return { post: toPost(updated.post) } as T;
    }

    if (method === "DELETE") return (await leadgenSocial.remove(id)) as T;
  }

  if (method === "POST") {
    switch (action) {
      case "submit":
        return { post: toPost((await leadgenSocial.submit(id)).post) } as T;
      case "approve":
        return { post: toPost((await leadgenSocial.approve(id)).post) } as T;
      case "request-changes":
        return {
          post: toPost(
            (
              await leadgenSocial.requestChanges(
                id,
                String(payload.comment ?? ""),
              )
            ).post,
          ),
        } as T;
      case "comment":
        return (await leadgenSocial.comment(
          id,
          String(payload.body ?? ""),
        )) as T;
      case "published":
        return {
          post: toPost(
            (await leadgenSocial.markPublished(id, String(payload.url ?? "")))
              .post,
          ),
        } as T;
      default:
        return undefined;
    }
  }

  return undefined;
}

/** Creative upload, mapped onto the cockpit's raw-body endpoint. */
export async function uploadSocialCreative(
  postId: string,
  file: File,
): Promise<void> {
  await leadgenSocial.uploadMedia(Number(postId), file);
}

/** Media removal, for the detail dialog's delete control. */
export async function removeSocialCreative(mediaId: string): Promise<void> {
  await leadgenSocial.removeMedia(Number(mediaId));
}
