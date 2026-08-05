/**
 * Resolves the Hono client base URL from `VITE_API_URL` (or default).
 * If the value already ends with `/api`, it is returned as-is; otherwise `/api` is appended.
 */
export function resolveApiBaseUrl(viteApiUrl: string | undefined): string {
  // An EMPTY value means same-origin: return a relative "/api" so one built
  // bundle can be served from any hostname. Vite inlines VITE_* at build time,
  // so a baked-in absolute host pins the image to one domain — serving the
  // crmx2 bundle from crmx1 sent every call cross-origin with the session
  // cookie on the wrong host.
  //
  // `undefined` still falls back to localhost, so local dev is unchanged; only
  // an explicitly empty string opts into same-origin.
  // UNDEFINED means same-origin too, not localhost.
  //
  // This helper used to fall back to http://localhost:1337 when the variable
  // was absent, while the app's other helper (fetchers/get-api-url.ts) treated
  // absent as same-origin via `?? ""`. Two helpers disagreeing about the same
  // missing value is not a style difference — it is a bug waiting for someone
  // to stop setting the variable.
  //
  // Someone did: VITE_API_URL used to be baked in as a Docker build ARG, and
  // when the SPA build moved out of Docker onto the CI runner the ARG went with
  // it. Every call through THIS helper then pointed at the viewer's own
  // machine. In production that is one module — projects — so the Projects page
  // fetched http://localhost:1337, failed, and rendered "No projects yet". The
  // data was never gone.
  //
  // Localhost now requires saying so. apps/app/.env.development and .env.local
  // both set it, and Vite loads those automatically in dev, so dev is unchanged.
  if (!viteApiUrl) return "/api";

  const raw = viteApiUrl.trim();
  if (!raw) return "/api";
  const baseUrl = raw.replace(/\/+$/, "");
  return baseUrl.endsWith("/api") ? baseUrl : `${baseUrl}/api`;
}
