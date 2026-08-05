import sharp from "sharp";
import { del, list, put } from "@/lib/storage/objects";
import {
  CAP_BASE,
  buildCapPreviewUrl,
  buildCapShareUrl,
  extractCapVideoId,
} from "./cap-link";

// Bridge between the self-hosted Cap instance (apps/cap on the VPS) and
// outgoing email. Cap's preview endpoint 302s to a ~1h-signed MinIO URL, so
// the GIF must be re-hosted in our own bucket (permanent, public) before it can
// be embedded in an email — never link the signed URL directly.
//
// Link parsing/rescue is in cap-link.ts (client-safe, no sharp/blob) and
// re-exported here so server callers keep a single import.
export { extractCapVideoId, rescueCapEmbedFromBody } from "./cap-link";

// Gmail tolerates animated GIFs but multi-MB images hurt load + spam scoring;
// above this we fall back to a static first-frame JPEG with a play overlay.
const GIF_EMAIL_LIMIT = 2.5 * 1024 * 1024;
const GIF_HARD_LIMIT = 8 * 1024 * 1024;

export type CapEmbed = {
  shareUrl: string;
  /** Permanent public object-store URL (animated GIF, or JPEG fallback). */
  gifUrl: string;
  title: string;
};

async function fetchTitle(videoId: string): Promise<string> {
  try {
    const res = await fetch(`${CAP_BASE}/s/${videoId}`, {
      headers: { "user-agent": "nuraview-crm-embed" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return "Watch video";
    const html = await res.text();
    const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)
      ?? html.match(/<title>([^<]*)<\/title>/i);
    const title = og?.[1]?.replace(/\s*\|\s*Cap.*$/i, "").trim();
    return title || "Watch video";
  } catch {
    return "Watch video";
  }
}

// Loom-style play badge: dark circle + white triangle, baked into the image
// so the email thumbnail unmistakably reads as "video — click me".
function playOverlaySvg(w: number, h: number): Buffer {
  const r = Math.round(Math.min(w, h) * 0.16);
  return Buffer.from(
    `<svg width="${w}" height="${h}">
       <circle cx="${w / 2}" cy="${h / 2}" r="${r}" fill="rgba(17,17,17,0.62)" stroke="white" stroke-width="${Math.max(3, Math.round(r * 0.09))}"/>
       <polygon points="${w / 2 - r * 0.3},${h / 2 - r * 0.48} ${w / 2 - r * 0.3},${h / 2 + r * 0.48} ${w / 2 + r * 0.55},${h / 2}" fill="white"/>
     </svg>`,
  );
}

/** Bake the play badge onto EVERY frame of an animated GIF (Loom look). */
async function overlayPlayOnGif(gif: Buffer): Promise<Buffer> {
  const img = sharp(gif, { animated: true });
  const meta = await img.metadata();
  const w = meta.width ?? 480;
  const pageH = meta.pageHeight ?? meta.height ?? 270;
  const pages = meta.pages ?? 1;
  // sharp represents an animated GIF as one tall strip of stacked frames —
  // composite the badge once per frame at each page offset.
  const badge = playOverlaySvg(w, pageH);
  const withBadge = await img
    .composite(
      Array.from({ length: pages }, (_, i) => ({
        input: badge,
        top: i * pageH,
        left: 0,
      })),
    )
    .gif()
    .toBuffer();
  // Re-encode can inflate size; prefer the original over blowing the budget.
  return withBadge.byteLength <= GIF_EMAIL_LIMIT ? withBadge : gif;
}

/** Static poster fallback: first GIF frame + play-button overlay, small JPEG. */
async function gifToPosterJpeg(gif: Buffer): Promise<Buffer> {
  const frame = sharp(gif, { animated: false }).flatten({ background: "#000" });
  const meta = await frame.metadata();
  const width = Math.min(meta.width ?? 640, 640);
  const resized = await frame.resize({ width }).toBuffer();
  const { width: w = width, height: h = 360 } = await sharp(resized).metadata();
  return sharp(resized)
    .composite([{ input: playOverlaySvg(w, h) }])
    .jpeg({ quality: 78 })
    .toBuffer();
}

const GIFMAKER_URL = (process.env.CAP_GIFMAKER_URL ?? `${CAP_BASE}/gifmaker`).replace(/\/$/, "");
const GIFMAKER_SECRET = process.env.CAP_GIFMAKER_SECRET;

/**
 * Fetch the preview GIF. Primary source: our gifmaker sidecar (apps/cap),
 * which samples frames across the WHOLE video and replays them fast — a
 * Loom-style lively preview. Cap's own /api/video/preview only covers the
 * first ~4s, which looks static for screen recordings; it stays as fallback
 * (and returns the static screenshot while the video is still processing).
 */
async function fetchPreviewGif(
  videoId: string,
): Promise<{ buf: Buffer; isGif: boolean } | null> {
  if (GIFMAKER_SECRET) {
    try {
      const res = await fetch(`${GIFMAKER_URL}/gif?videoId=${videoId}`, {
        headers: { "X-Gifmaker-Secret": GIFMAKER_SECRET },
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok && (res.headers.get("content-type") ?? "").includes("gif")) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength <= GIF_HARD_LIMIT) return { buf, isGif: true };
      }
    } catch {
      // sidecar down → fall through to Cap's own preview
    }
  }

  const res = await fetch(buildCapPreviewUrl(videoId), {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("image/")) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > GIF_HARD_LIMIT) {
    throw new Error(`Cap preview too large (${Math.round(buf.byteLength / 1e6)}MB)`);
  }
  return { buf, isGif: contentType.includes("gif") };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve a Cap share URL into email-embeddable assets. Idempotent: the object
 * store is the cache (deterministic path per videoId). A cached .gif is
 * final; a cached .jpg is provisional (video wasn't fully processed at first
 * send) and upgrades to the animated GIF automatically on later sends.
 */
export async function resolveCapEmbed(shareUrl: string): Promise<CapEmbed> {
  const videoId = extractCapVideoId(shareUrl);
  if (!videoId) {
    throw new Error(`Not a Cap share link: ${shareUrl}`);
  }
  const canonicalShareUrl = buildCapShareUrl(videoId);

  // Email <img> URL on the branded cap domain (gifmaker /thumb, badge baked
  // in, long-cache). One reputable host — Gmail hides images when an email
  // pulls from several random third-party hosts (blob subdomain, CDNs).
  const brandedGifUrl = `${GIFMAKER_URL}/thumb/${videoId}.gif`;

  const { blobs } = await list({ prefix: `videos/cap/${videoId}.`, limit: 3 });
  const cachedGif = blobs.find((b) => b.pathname.endsWith(".gif"));
  if (cachedGif) {
    return {
      shareUrl: canonicalShareUrl,
      gifUrl: brandedGifUrl,
      title: await fetchTitle(videoId),
    };
  }
  const cachedJpg = blobs.find((b) => b.pathname.endsWith(".jpg"));

  // Poll briefly: right after recording, the media-server may still be
  // rendering the animated preview and the endpoint serves the screenshot.
  let preview = await fetchPreviewGif(videoId);
  for (let attempt = 0; preview && !preview.isGif && attempt < 2; attempt++) {
    await sleep(4000);
    const retry = await fetchPreviewGif(videoId);
    if (retry) preview = retry;
  }
  if (!preview) {
    if (cachedJpg) {
      return { shareUrl: canonicalShareUrl, gifUrl: cachedJpg.url, title: await fetchTitle(videoId) };
    }
    throw new Error(`Cap preview unavailable for ${videoId}`);
  }

  let body: Buffer;
  let pathname: string;
  let objectContentType: string;
  if (preview.isGif && preview.buf.byteLength <= GIF_EMAIL_LIMIT) {
    body = await overlayPlayOnGif(preview.buf);
    pathname = `videos/cap/${videoId}.gif`;
    objectContentType = "image/gif";
  } else {
    // Screenshot-only (or oversized GIF) → static poster with play badge.
    body = await gifToPosterJpeg(preview.buf);
    pathname = `videos/cap/${videoId}.jpg`;
    objectContentType = "image/jpeg";
  }

  const { url } = await put(pathname, body, { contentType: objectContentType });
  if (pathname.endsWith(".gif") && cachedJpg) {
    // Upgraded from provisional poster — drop it so the cache has one truth.
    await del(cachedJpg.url).catch(() => {});
  }

  return {
    shareUrl: canonicalShareUrl,
    // GIF → branded cap-domain URL; JPEG poster fallback served from our bucket.
    gifUrl: pathname.endsWith(".gif") ? brandedGifUrl : url,
    title: await fetchTitle(videoId),
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Table-based card — the only video pattern email clients render reliably.
 * Explicit width attrs everywhere: clients like Zoho stretch width-less
 * tables to full message width, which wrecks the layout around them. */
export function renderVideoCardHtml(embed: CapEmbed): string {
  const title = escapeHtml(embed.title);
  return `<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:100%;margin:16px 0">
  <tr><td width="480" style="width:480px;max-width:100%">
    <a href="${embed.shareUrl}" target="_blank" style="text-decoration:none">
      <img src="${embed.gifUrl}" alt="&#9654; ${title}" width="480" style="width:480px;max-width:100%;border-radius:8px;border:1px solid #e5e7eb;display:block"/>
      <p style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;font-weight:600;color:#2563eb;margin:8px 0 0">&#9654; ${title} — watch video</p>
    </a>
  </td></tr>
</table>`;
}

export function renderVideoCardText(embed: CapEmbed): string {
  return `▶ Watch: ${embed.title}\n${embed.shareUrl}`;
}

/** Plain styled link used when GIF resolution fails — sending must never break. */
export function renderVideoLinkFallbackHtml(shareUrl: string): string {
  return `<p style="margin:16px 0"><a href="${escapeHtml(shareUrl)}" target="_blank" style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:14px;font-weight:600;color:#2563eb">&#9654; Watch my video</a></p>`;
}
