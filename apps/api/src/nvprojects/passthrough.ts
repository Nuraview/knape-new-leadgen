/**
 * Serve NuraView's shared project through THIS instance's normal endpoints.
 *
 * The first cut of the shared board was a hand-rolled page against a bespoke
 * /nvprojects surface. It rendered four columns and a card title, next to
 * crmx1's real board with backlog/gantt tabs, filter and sort, list view, card
 * keys, labels, assignee avatars, priority, due dates, comment counts and a
 * task detail sheet. Rewriting all of that against a second API would have been
 * a second implementation to keep in step with the first, forever.
 *
 * Both deployments run the SAME code, so the board UI already exists here. What
 * it needs is for `GET /api/task/tasks/<shared project>` to answer — and every
 * mutation alongside it. That is what this does: requests that name the shared
 * project, the shared workspace, or a task inside them are forwarded verbatim
 * to crmx1 under a service session; everything else falls through to the local
 * database untouched.
 *
 * The result is that Dan's board IS crmx1's board, pixel for pixel and feature
 * for feature, because it is the same component tree over the same rows.
 *
 * WHAT IS AND IS NOT FORWARDED
 *
 * Forwarding is decided by identifier, never by path alone. NuraView's
 * workspace also holds Habib's Tasks, Afham's Tasks and Nuraview-Javed; a
 * request naming one of those is not forwarded, so it simply misses locally
 * rather than reaching an internal board. The workspace-scoped calls the board
 * needs (labels, members) are forwarded only when they name the shared
 * workspace.
 *
 * Task ids cannot be checked against a project without a lookup, so ids seen in
 * a forwarded task list are remembered and that set is what authorises later
 * task-scoped calls. It is populated by the board's own polling before any card
 * can be clicked.
 */
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";

function sharedProjectId(): string | null {
  return process.env.NV_PROJECTS_PROJECT_ID?.trim() || null;
}

function sharedWorkspaceId(): string | null {
  return process.env.NV_PROJECTS_WORKSPACE_ID?.trim() || null;
}

function baseUrl(): string | null {
  const raw = process.env.NV_PROJECTS_BASE_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

function apiKey(): string | null {
  return process.env.NV_PROJECTS_API_KEY?.trim() || null;
}

export function sharedBoardConfigured(): boolean {
  return Boolean(
    baseUrl() &&
      sharedProjectId() &&
      (apiKey() ||
        (process.env.NV_PROJECTS_EMAIL?.trim() &&
          process.env.NV_PROJECTS_PASSWORD)),
  );
}

/* ------------------------------------------------------------------ auth -- */

let cachedCookie: string | null = null;
let inFlightLogin: Promise<string> | null = null;

async function login(): Promise<string> {
  const base = baseUrl();
  const email = process.env.NV_PROJECTS_EMAIL?.trim();
  const password = process.env.NV_PROJECTS_PASSWORD;
  if (!base || !email || !password) {
    throw new HTTPException(503, {
      message: "The shared project board is not configured",
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(`${base}/api/auth/sign-in/email`, {
      method: "POST",
      // Node's fetch sends `Origin: null` on a server-to-server call and
      // better-auth answers that with 403 MISSING_OR_NULL_ORIGIN. crmx1's own
      // base URL is trusted by definition.
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new HTTPException(504, {
      message:
        (error as Error)?.name === "AbortError"
          ? "crmx1 did not answer the service login within 15s"
          : `crmx1 login failed: ${(error as Error)?.message ?? "unknown"}`,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new HTTPException(502, {
      message: `crmx1 rejected the service login (${res.status})`,
    });
  }

  const cookie = (res.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) {
    throw new HTTPException(502, {
      message: "crmx1 login returned no session cookie",
    });
  }
  cachedCookie = cookie;
  return cookie;
}

function getCookie(force = false): Promise<string> {
  if (!force && cachedCookie) return Promise.resolve(cachedCookie);
  if (!inFlightLogin) {
    inFlightLogin = login().finally(() => {
      inFlightLogin = null;
    });
  }
  return inFlightLogin;
}

/* ------------------------------------------------------- task id registry -- */

/**
 * Task ids known to live in the shared project.
 *
 * Bounded so a long-lived instance cannot grow this without limit; the board
 * refills it every poll, so eviction costs at most one extra round trip.
 */
const MAX_KNOWN_TASKS = 5_000;
const knownTaskIds = new Set<string>();

function rememberTaskIds(payload: unknown) {
  const walk = (node: unknown, depth = 0) => {
    if (depth > 6 || !node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    // A task is recognised by carrying both an id and a title; columns and the
    // project envelope have names, not titles.
    if (typeof obj.id === "string" && typeof obj.title === "string") {
      if (knownTaskIds.size >= MAX_KNOWN_TASKS) knownTaskIds.clear();
      knownTaskIds.add(obj.id);
    }
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };
  walk(payload);
}

/* ---------------------------------------------------------------- routing -- */

/**
 * Decide whether a request belongs to the shared board.
 *
 * Returns true only when an identifier in the path — or a task id already known
 * to be in the shared project — matches. Nothing is forwarded on a path prefix
 * alone.
 */
function urlNamesSharedThing(url: URL): boolean {
  const project = sharedProjectId();
  const workspace = sharedWorkspaceId();

  const matches = (value: string | null | undefined) =>
    Boolean(
      value &&
        ((project && value === project) ||
          (workspace && value === workspace) ||
          knownTaskIds.has(value)),
    );

  for (const segment of url.pathname.split("/")) {
    if (matches(segment)) return true;
  }

  /*
   * Query parameters count too. GET /api/project?workspaceId=<shared> is the
   * project list the board's own layout loads, and it carries the workspace id
   * in the query rather than the path — so a path-only check left it on the
   * local database, where it 403'd with "You don't have access to this
   * workspace" on every page load of the board.
   *
   * Named parameters only. Scanning every value would forward on an unrelated
   * search string that happened to contain the id.
   */
  for (const key of [
    "workspaceId",
    "organizationId",
    "projectId",
    "taskId",
    "id",
  ]) {
    if (matches(url.searchParams.get(key))) return true;
  }

  return false;
}

function bodyNamesSharedThing(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const obj = body as Record<string, unknown>;
  const project = sharedProjectId();
  const workspace = sharedWorkspaceId();
  if (project && obj.projectId === project) return true;
  if (workspace && obj.workspaceId === workspace) return true;
  if (typeof obj.taskId === "string" && knownTaskIds.has(obj.taskId)) {
    return true;
  }
  // A cross-project move must not be able to drag a card OUT of the shared
  // board into a local project, or vice versa — the two live in different
  // databases and the row cannot exist in both.
  if (project && obj.destinationProjectId === project) return true;
  return false;
}

/**
 * Forward one request to crmx1 and return its response.
 *
 * The body is read once and replayed, because Hono may already have consumed it
 * and a Request body cannot be read twice.
 */
async function forward(c: Context, rawBody: string | null): Promise<Response> {
  const base = baseUrl();
  if (!base) {
    throw new HTTPException(503, {
      message: "NV_PROJECTS_BASE_URL is not configured",
    });
  }

  const url = new URL(c.req.url);
  const target = `${base}/api${url.pathname.replace(/^\/api/, "")}${url.search}`;
  const method = c.req.method;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  const send = (auth: Record<string, string>) =>
    fetch(target, {
      method,
      headers: {
        Accept: "application/json",
        Origin: base,
        ...(rawBody !== null ? { "Content-Type": "application/json" } : {}),
        ...auth,
      },
      body: rawBody ?? undefined,
      signal: controller.signal,
    });

  try {
    const key = apiKey();
    let res: Response;
    if (key) {
      res = await send({ "x-api-key": key });
    } else {
      res = await send({ cookie: await getCookie() });
      // Sessions expire. One forced re-login turns that into a retry rather
      // than an error the user sees.
      if (res.status === 401) res = await send({ cookie: await getCookie(true) });
    }

    const text = await res.text();
    if (res.ok) {
      try {
        rememberTaskIds(JSON.parse(text));
      } catch {
        // Not JSON, or not a shape with tasks in it. Nothing to remember.
      }
    }
    return new Response(text, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    const aborted = (error as Error)?.name === "AbortError";
    throw new HTTPException(504, {
      message: aborted
        ? "The shared project board did not respond within 20s"
        : `The shared project board is unreachable: ${(error as Error)?.message ?? "unknown"}`,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Middleware. Register on the project-board prefixes BEFORE their routers.
 *
 * Falls through on anything it does not recognise, so a local project keeps
 * behaving exactly as it did.
 */
export async function sharedProjectPassthrough(c: Context, next: Next) {
  if (!sharedBoardConfigured()) return next();

  const method = c.req.method;
  const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";

  let rawBody: string | null = null;
  let parsed: unknown = null;
  if (hasBody) {
    // Read once here; the local handlers downstream re-read from the cloned
    // request Hono keeps, so this is safe on the fall-through path too.
    rawBody = await c.req.raw.clone().text();
    if (rawBody) {
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        // Not JSON — a file upload, say. It cannot name the shared project in a
        // way we can check, so it stays local.
        return next();
      }
    }
  }

  const shared =
    urlNamesSharedThing(new URL(c.req.url)) || bodyNamesSharedThing(parsed);

  if (!shared) return next();

  return forward(c, rawBody);
}

export default sharedProjectPassthrough;
