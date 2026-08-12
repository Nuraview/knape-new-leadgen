import { getApiUrl } from "@/fetchers/get-api-url";

/**
 * Talks to the lead-gen cockpit through the CRM's own API.
 *
 * Every call goes to /api/leadgen/<the cockpit's own path>, which the Hono
 * proxy forwards server-side with a service token. The browser never sees the
 * cockpit's hostname or its credentials, and there is no second origin — the
 * session cookie the CRM already has is the only auth involved.
 *
 * The old cockpit UI called the Python service directly from the browser and
 * broke the day it moved to a custom domain, because that domain was not in
 * the service's CORS allow-list. The UI reported "backend is down" while the
 * backend was answering 200. Routing through /api removes the whole class.
 */
const PREFIX = "/leadgen";

export class LeadgenError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LeadgenError";
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { query?: Record<string, string | number | undefined | null> },
): Promise<T> {
  const { query, ...rest } = init ?? {};
  /*
   * getApiUrl returns either a same-origin "/api/…" or an absolute base (local
   * dev against a remote API). `new URL(value, origin)` handles both: an
   * absolute first argument ignores the base.
   */
  const url = new URL(
    getApiUrl(`${PREFIX}${path}`),
    window.location.origin,
  );

  for (const [key, value] of Object.entries(query ?? {})) {
    // Skip empties rather than sending `?industry=`: the cockpit treats a
    // present-but-blank filter as a real one and returns nothing.
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    credentials: "include",
    ...rest,
    headers: { Accept: "application/json", ...(rest.headers ?? {}) },
  });

  if (!response.ok) {
    /*
     * Surface the server's message rather than a generic failure. The proxy
     * distinguishes cases the user can act on — 503 "not configured", 504 "the
     * cockpit did not respond", 403 "not proxied" — and collapsing them into
     * "Request failed" throws that away. Falls back to the status text when
     * the body is not JSON, which is what a gateway error page looks like.
     */
    let message = response.statusText || `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.message === "string") message = body.message;
      else if (typeof body?.error === "string") message = body.error;
      else if (typeof body?.detail === "string") message = body.detail;
    } catch {
      // Non-JSON body; keep the status text.
    }
    throw new LeadgenError(message, response.status);
  }

  return (await response.json()) as T;
}

export const leadgen = {
  get: <T>(path: string, query?: Record<string, string | number | undefined | null>) =>
    request<T>(path, { method: "GET", query }),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),

  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),

  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
