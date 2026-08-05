/**
 * The shared project board — a client's dashboard and NuraView's, on one dataset.
 *
 * VK, 2026-08-03: internally, projects assigned to a client's work should show
 * up on that client's dashboard automatically. And, later: updates must flow
 * BOTH ways.
 *
 * WHY A PROXY AND NOT A MIRROR
 *
 * The obvious build is to copy tasks into the client's database and reconcile. That
 * buys a permanent conflict problem: two writable copies, two clocks, and a
 * feedback loop where each side's write triggers the other's. Every mirror ends
 * up needing tombstones, last-writer-wins rules and a repair job.
 *
 * There is only one board here. NuraView already has the project, pinned by id
 * in NV_PROJECTS_PROJECT_ID, and both deployments run the SAME codebase, so the
 * client instance can read and write it directly over the API.
 * "Sync both ways" then needs no sync at all: there is one source of truth, and
 * a card moved on either dashboard is the same row.
 *
 * SCOPE
 *
 * Pinned to ONE project id. NuraView's workspace also holds Habib's Tasks,
 * Afham's Tasks and Nuraview-Javed — internal boards a client must never see.
 * Every request is checked against NV_PROJECTS_PROJECT_ID before it leaves this
 * process, so a crafted id cannot walk into another board.
 *
 * The hashtag remains supported as a FILTER (NV_PROJECTS_HASHTAG): when set,
 * only tasks carrying it are returned. Off by default, because the dedicated
 * project already answers "which items are Dan's" more reliably than a string
 * somebody has to remember to type.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireCrmAccess } from "../utils/require-crm-access";

function base(): string {
  const raw = process.env.NV_PROJECTS_BASE_URL?.trim();
  if (!raw) {
    throw new HTTPException(503, {
      message:
        "NV_PROJECTS_BASE_URL is not configured — the shared project board is not connected",
    });
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Two ways to authenticate to crmx1, because the two are available to different
 * people.
 *
 *   NV_PROJECTS_API_KEY   an API key created in crmx1's Settings -> Developer.
 *                         Preferred: scoped, revocable, no password anywhere.
 *   NV_PROJECTS_EMAIL +
 *   NV_PROJECTS_PASSWORD  a service account signing in the ordinary way. The
 *                         fallback for when nobody can reach the API-key screen
 *                         but a login exists.
 *
 * Supporting both means the board is never blocked on which credential someone
 * happens to have. The key wins when both are set.
 */
function apiKey(): string | null {
  return process.env.NV_PROJECTS_API_KEY?.trim() || null;
}

let cachedCookie: string | null = null;
let inFlightLogin: Promise<string> | null = null;

async function loginToCrmx1(): Promise<string> {
  const email = process.env.NV_PROJECTS_EMAIL?.trim();
  const password = process.env.NV_PROJECTS_PASSWORD;
  if (!email || !password) {
    throw new HTTPException(503, {
      message:
        "Set NV_PROJECTS_API_KEY, or NV_PROJECTS_EMAIL + NV_PROJECTS_PASSWORD, to connect the shared project board",
    });
  }

  // Bounded like every other upstream call. Without this the login could hang
  // until the platform's own gateway gave up, which surfaces as a bare 504 with
  // nothing to read — exactly the failure that made this hard to diagnose.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let res: Response;
  try {
    res = await fetch(`${base()}/api/auth/sign-in/email`, {
      method: "POST",
      // Origin is not decoration. Node's fetch sends `Origin: null` on a
      // server-to-server call, and better-auth answers that with 403
      // MISSING_OR_NULL_ORIGIN — which is exactly why the board came back
      // "unreachable" while the same login worked from curl, which sends no
      // Origin at all and skips the check. crmx1's own base URL is trusted by
      // definition, so it is the safe value to send.
      headers: { "Content-Type": "application/json", Origin: base() },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new HTTPException(504, {
      message:
        (error as Error)?.name === "AbortError"
          ? "crmx1 did not answer the service login within 15s"
          : `crmx1 login failed: ${(error as Error)?.message ?? "unknown error"}`,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new HTTPException(502, {
      message: `crmx1 rejected the service login (${res.status})`,
    });
  }

  // better-auth returns the session as a Set-Cookie; keep the whole header so
  // the cookie name cannot drift out from under this.
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) {
    throw new HTTPException(502, {
      message: "crmx1 login returned no session cookie",
    });
  }
  cachedCookie = cookie;
  return cookie;
}

/** Single-flight, cached for the life of a warm instance. */
function getCookie(force = false): Promise<string> {
  if (!force && cachedCookie) return Promise.resolve(cachedCookie);
  if (!inFlightLogin) {
    inFlightLogin = loginToCrmx1().finally(() => {
      inFlightLogin = null;
    });
  }
  return inFlightLogin;
}

function pinnedProjectId(): string {
  const id = process.env.NV_PROJECTS_PROJECT_ID?.trim();
  if (!id) {
    throw new HTTPException(503, {
      message: "NV_PROJECTS_PROJECT_ID is not configured",
    });
  }
  return id;
}

/** Optional hashtag filter, e.g. "#windadayplanner". */
function hashtag(): string | null {
  const raw = process.env.NV_PROJECTS_HASHTAG?.trim();
  return raw ? raw.toLowerCase() : null;
}

async function upstream(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  const send = async (auth: Record<string, string>) =>
    fetch(`${base()}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        // Same reason as the login: without this every write would 403.
        Origin: base(),
        ...auth,
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

  try {
    const key = apiKey();
    if (key) return await send({ "x-api-key": key });

    let res = await send({ cookie: await getCookie() });
    // Sessions expire; one forced re-login turns that into a retry rather than
    // an error the user sees.
    if (res.status === 401) res = await send({ cookie: await getCookie(true) });
    return res;
  } catch (error) {
    const aborted = (error as Error)?.name === "AbortError";
    throw new HTTPException(504, {
      message: aborted
        ? "The shared project board did not respond within 20s"
        : `The shared project board is unreachable: ${(error as Error)?.message ?? "unknown error"}`,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Refuse anything outside the pinned project.
 *
 * Belt and braces with the allow-list below: the id arrives in a URL the client
 * controls, and the upstream API key has access to NuraView's whole workspace.
 * Getting this wrong exposes internal boards to a client.
 */
function assertPinned(projectId: string) {
  if (projectId !== pinnedProjectId()) {
    throw new HTTPException(403, {
      message: "That board is not shared with this instance.",
    });
  }
}

function matchesHashtag(task: { title?: string; description?: string }): boolean {
  const tag = hashtag();
  if (!tag) return true;
  const haystack = `${task.title ?? ""} ${task.description ?? ""}`.toLowerCase();
  return haystack.includes(tag);
}

const nvprojects = new Hono<{ Variables: { userId: string } }>()
  .use("*", requireCrmAccess)

  /** Whether the board is wired up at all — the UI hides itself when not. */
  .get("/config", (c) =>
    c.json({
      connected: Boolean(
        process.env.NV_PROJECTS_BASE_URL?.trim() &&
          process.env.NV_PROJECTS_PROJECT_ID?.trim() &&
          (process.env.NV_PROJECTS_API_KEY?.trim() ||
            (process.env.NV_PROJECTS_EMAIL?.trim() &&
              process.env.NV_PROJECTS_PASSWORD)),
      ),
      projectId: process.env.NV_PROJECTS_PROJECT_ID?.trim() ?? null,
      // The SPA needs both ids to build the real board URL. Serving them here
      // rather than baking them into the client keeps the board a config
      // change, not a rebuild.
      workspaceId: process.env.NV_PROJECTS_WORKSPACE_ID?.trim() ?? null,
      hashtag: hashtag(),
    }),
  )

  /**
   * Columns of the shared board.
   *
   * The board UI no longer reads this — /tasks already returns the columns with
   * their cards, and these rows carry cuid ids that do not match the status
   * slugs the cards are grouped by. Kept for callers that want the real rows.
   */
  .get("/columns", async () => {
    const res = await upstream(`/api/column/${pinnedProjectId()}`);
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  })

  /** Tasks, optionally narrowed to the hashtag. */
  .get("/tasks", async (c) => {
    const res = await upstream(`/api/task/tasks/${pinnedProjectId()}`);
    if (!res.ok) {
      return new Response(await res.text(), { status: res.status });
    }

    const payload = (await res.json()) as unknown;

    if (!hashtag()) return c.json(payload);

    /*
     * Filtering happens HERE rather than upstream because the upstream has no
     * hashtag concept — it is a plain project board. Applied to whatever shape
     * comes back, defensively: this endpoint returns tasks grouped by column on
     * some versions and flat on others, and a mismatch should show fewer cards,
     * never leak unfiltered ones.
     */
    const filterList = (tasks: unknown) =>
      Array.isArray(tasks) ? tasks.filter((t) => matchesHashtag(t as never)) : tasks;

    if (Array.isArray(payload)) return c.json(filterList(payload));
    if (payload && typeof payload === "object") {
      // The live shape is { data: { columns: [{ tasks: [...] }] } }. Unwrap the
      // envelope before filtering, then hand the envelope back untouched — the
      // client reads other fields off it.
      const outer = payload as Record<string, unknown>;
      if (outer.data && typeof outer.data === "object") {
        const inner = outer.data as Record<string, unknown>;
        if (Array.isArray(inner.columns)) {
          return c.json({
            ...outer,
            data: {
              ...inner,
              columns: (inner.columns as Record<string, unknown>[]).map((col) => ({
                ...col,
                tasks: filterList(col.tasks),
              })),
            },
          });
        }
      }
      const obj = payload as Record<string, unknown>;
      if (Array.isArray(obj.tasks)) return c.json({ ...obj, tasks: filterList(obj.tasks) });
      if (Array.isArray(obj.columns)) {
        return c.json({
          ...obj,
          columns: (obj.columns as Record<string, unknown>[]).map((col) => ({
            ...col,
            tasks: filterList(col.tasks),
          })),
        });
      }
    }
    return c.json(payload);
  })

  /**
   * Create a task on the shared board.
   *
   * When a hashtag filter is configured it is appended to the title, so a card
   * Dan creates stays visible to him after a round trip — otherwise it would be
   * written upstream and then filtered straight back out, which reads as the
   * card vanishing on save.
   */
  .post("/tasks", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const tag = hashtag();
    const title = String(body.title ?? "");

    const res = await upstream("/api/task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        projectId: pinnedProjectId(),
        title:
          tag && !title.toLowerCase().includes(tag) ? `${title} ${tag}` : title,
      }),
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  })

  /**
   * Everything hanging off a task: comments, labels, activity, relations,
   * attachments.
   *
   * These are the same rows crmx1 writes, so a comment left on either dashboard
   * is one comment — but only if this proxy actually forwards the call. Cards
   * moving while comments silently did not was the gap: "both ways" has to mean
   * the whole card, not just its column.
   *
   * A generic passthrough rather than a route each, because these are all plain
   * task-scoped CRUD and enumerating them would go stale the first time the
   * upstream grows one. Confined to a fixed set of prefixes, and the task is
   * verified to belong to the pinned project before anything is forwarded —
   * without that check a task id from Habib's board would be writable.
   */
  .all("/task-scoped/:resource/*", async (c) => {
    const resource = c.req.param("resource");
    const ALLOWED_RESOURCES = new Set([
      "comment",
      "label",
      "activity",
      "task-relation",
      "external-link",
    ]);
    if (!ALLOWED_RESOURCES.has(resource)) {
      throw new HTTPException(403, {
        message: `Not proxied: ${resource}`,
      });
    }

    const url = new URL(c.req.url);
    const suffix = url.pathname.replace(/^.*?\/task-scoped\/[^/]+/, "");
    const method = c.req.method;

    const res = await upstream(`/api/${resource}${suffix}${url.search}`, {
      method,
      ...(method === "GET" || method === "HEAD"
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: await c.req.text(),
          }),
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  })

  /**
   * Notifications raised on the shared board.
   *
   * crmx1 notifies its OWN users; Dan's instance has a separate notification
   * table that knows nothing about them. So his bell would stay silent while a
   * colleague commented on his card.
   *
   * The service account is a workspace member, so crmx1 raises notifications
   * for it — this surfaces those, narrowed to the pinned project. Read-only:
   * marking one read on Dan's side must not clear it for NuraView's team.
   */
  .get("/notifications", async (c) => {
    const res = await upstream("/api/notification");
    if (!res.ok) return new Response(await res.text(), { status: res.status });

    const payload = (await res.json()) as unknown;
    const pinned = pinnedProjectId();
    const items = Array.isArray(payload)
      ? payload
      : ((payload as Record<string, unknown>)?.items as unknown[]) ?? [];

    const mine = (items as Record<string, unknown>[]).filter((n) => {
      const data = (n.eventData ?? {}) as Record<string, unknown>;
      // Keep anything we cannot attribute rather than dropping it: a missed
      // notification is worse than an extra one.
      const projectId = data.projectId ?? n.projectId;
      return !projectId || projectId === pinned;
    });

    return c.json({ items: mine });
  })

  /**
   * Drag a card to another column.
   *
   * The board's columns are workflow STATUSES upstream, not foreign keys: the
   * tasks payload groups by `status` ("to-do", "in-progress") and every task's
   * `columnId` comes back null. So a move is a status change, and the generic
   * PUT /api/task/:id — which expects the whole task — is the wrong instrument.
   */
  .put("/tasks/:taskId/status", async (c) => {
    const { status } = await c.req.json<{ status?: string }>();
    if (!status) {
      throw new HTTPException(400, { message: "status is required" });
    }
    const res = await upstream(`/api/task/status/${c.req.param("taskId")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  })

  /** Move / rename / retitle — the write half of "both ways". */
  .put("/tasks/:taskId", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    if (body.projectId) assertPinned(String(body.projectId));

    const res = await upstream(`/api/task/${c.req.param("taskId")}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  });

export default nvprojects;
