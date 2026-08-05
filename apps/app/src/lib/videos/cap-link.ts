// Client-safe Cap link utilities. Ported verbatim from apps/web/lib/videos/
// cap-link.ts — only the env read changes (Vite inlines import.meta.env, Next
// used process.env). Server-side resolution lives in the API's cap-embed.ts.

export const CAP_BASE = (
  (import.meta.env.VITE_CAP_URL as string | undefined) ??
  "https://cap.nuraview.com"
).replace(/\/$/, "");

// Any Cap video URL — share (/s/<id>) or embed (/embed/<id>) — even when it's
// buried inside pasted iframe embed code or HTML-escaped markup. [^\s"'&<]
// stops before &quot; so escaped attributes still yield a clean URL.
const CAP_URL_RE = /https?:\/\/[^\s"'&<]+\/(?:s|embed)\/([A-Za-z0-9_-]+)/;

function isCapHost(hostname: string): boolean {
  const capHost = new URL(CAP_BASE).hostname;
  return [capHost, "cap.so", "www.cap.so"].includes(hostname);
}

/**
 * Accepts whatever the user pastes: a share link, an embed link, or the full
 * iframe embed-code snippet Cap's "copy embed" button produces (users
 * habitually grab that one — it never works in email, so we translate it).
 */
export function extractCapVideoId(input: string): string | null {
  const match = input.trim().match(CAP_URL_RE);
  if (!match) return null;
  try {
    if (!isCapHost(new URL(match[0]).hostname)) return null;
  } catch {
    return null;
  }
  return match[1] ?? null;
}

export function buildCapShareUrl(videoId: string): string {
  return `${CAP_BASE}/s/${videoId}`;
}

/** Public, unauthenticated animated-preview endpoint (302 → signed GIF). */
export function buildCapPreviewUrl(videoId: string): string {
  return `${CAP_BASE}/api/video/preview?videoId=${videoId}`;
}

/**
 * Rescue pasted iframe embed code from an email body (raw or HTML-escaped —
 * CKEditor escapes pasted markup into visible text). Returns the body with
 * those dead blocks stripped plus the canonical share URL, or null when the
 * body contains no Cap iframe code. Plain share links typed as text are left
 * untouched.
 */
export function rescueCapEmbedFromBody(
  body: string,
): { cleaned: string; shareUrl: string } | null {
  let videoId: string | null = null;
  const stripIfCap = (block: string): string => {
    const id = extractCapVideoId(block);
    if (!id) return block;
    videoId = videoId ?? id;
    return "";
  };

  let cleaned = body
    // Raw wrapper div + iframe (pasted into an HTML-aware surface)
    .replace(/<div[^>]*>\s*<iframe[\s\S]*?<\/iframe>\s*<\/div>/gi, stripIfCap)
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, stripIfCap)
    // HTML-escaped variants (CKEditor renders pasted code as literal text)
    .replace(/&lt;div[\s\S]*?&lt;\/div&gt;/gi, stripIfCap)
    .replace(/&lt;iframe[\s\S]*?&lt;\/iframe&gt;/gi, stripIfCap);

  if (!videoId) return null;
  cleaned = cleaned.replace(/<p>\s*<\/p>/gi, "").trim();
  return { cleaned, shareUrl: buildCapShareUrl(videoId) };
}
