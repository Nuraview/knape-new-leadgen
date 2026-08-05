/**
 * Base URL for the API.
 *
 * When VITE_API_URL is EMPTY the app talks to its own origin — `/api/...`.
 * That is what makes one bundle work on both crmx1 and crmx2: Vite inlines
 * VITE_* at build time, so a baked-in absolute host meant the image was pinned
 * to whichever domain it was built for. Serving the crmx2 bundle from crmx1
 * would have sent every request cross-origin, with the session cookie scoped to
 * the wrong host — a login loop that looks like broken auth.
 *
 * An absolute value is still honoured, for local dev against a remote API.
 */
export function getApiUrl(path: string) {
  const raw = (import.meta.env.VITE_API_URL ?? "").trim();
  const normalizedPath = `/${path.replace(/^\/+/, "")}`;

  if (!raw) return `/api${normalizedPath}`;

  const trimmedBase = raw.replace(/\/+$/, "");
  const apiUrl = trimmedBase.endsWith("/api")
    ? trimmedBase
    : `${trimmedBase}/api`;

  return `${apiUrl}${normalizedPath}`;
}
