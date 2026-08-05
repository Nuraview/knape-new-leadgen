import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type { Session, User } from "better-auth/types";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import {
  describeRoute,
  openAPIRouteHandler,
  resolver,
  validator,
} from "hono-openapi";
import * as v from "valibot";
import activity from "./activity";
import activityCrm from "./activity-crm";
import { auth } from "./auth";
import column from "./column";
import comment from "./comment";
import config from "./config";
import db, { getDatabase, schema } from "./database";
import { prepareDatabaseStartup } from "./database/prepare-database-startup";
import { waitForDatabase } from "./database/wait-for-database";
import dialer from "./dialer";
import discordIntegration from "./discord-integration";
import { eventContext } from "./events";
import externalLink from "./external-link";
import genericWebhookIntegration from "./generic-webhook-integration";
import giteaIntegration, { handleGiteaWebhookRoute } from "./gitea-integration";
import githubIntegration, {
  handleGithubWebhookRoute,
} from "./github-integration";
import getInstanceStatus from "./instance/controllers/get-instance-status";
import invitation from "./invitation";
import label from "./label";
import marketing from "./marketing";
import lead from "./lead";
import nvprojects from "./nvprojects";
import { sharedProjectPassthrough } from "./nvprojects/passthrough";
import order from "./order";
import linkedin from "./linkedin";
import linkedinPublic from "./linkedin/public";
import portal, { portalPublic } from "./portal";
import leadgen from "./leadgen";
import assistant from "./assistant";
import mcpRoutes, { mcpWellKnownRoutes } from "./mcp";
import { migrateColumns } from "./migrations/column-migration";
import notification from "./notification";
import notificationPreferences from "./notification-preferences";
import oauth from "./oauth";
import { initializePlugins } from "./plugins";
import { migrateGitHubIntegration } from "./plugins/github/migration";
import project from "./project";
import publicEndpoints from "./public-endpoints";
import proposal from "./proposal";
import cron from "./cron";
import stripeWebhook from "./payments/stripe-webhook";
import publicProposal from "./proposal/public";
import invoice from "./invoice";
import publicInvoice from "./invoice/public";
import proposalUploads from "./proposal/uploads";
import ingest from "./ingest";
import {
  CRM_FULL,
  canAccessProjects,
  getCrmLevel,
  getUserWorkspaceRole,
  requireProjectAccess,
} from "./utils/require-crm-access";
import { initializeScheduler, shutdownScheduler } from "./scheduler";
import scraper from "./scraper";
import search from "./search";
import slackIntegration from "./slack-integration";
import { getPrivateObject } from "./storage/s3";
import task from "./task";
import taskRelation from "./task-relation";
import telegramIntegration from "./telegram-integration";
import timeEntry from "./time-entry";
import timeTracking from "./time-tracking";
import twilioApi from "./twilio";
import {
  authenticateApiRequest,
  resolveAssetBearerOrCookie,
} from "./utils/authenticate-api-request";
import { getInvitationDetails } from "./utils/check-registration-allowed";
import { migrateApiKeyReferenceId } from "./utils/migrate-apikey-reference-id";
import { migrateCrmLeadEmailColumns } from "./utils/migrate-crm-lead-email-columns";
import { migrateCrmProposalColumns } from "./utils/migrate-crm-proposal-columns";
import { migrateCrmLeadViews } from "./utils/migrate-crm-lead-views";
import { migrateNotificationPreferencesSchema } from "./utils/migrate-notification-preferences-schema";
import { migrateSessionColumn } from "./utils/migrate-session-column";
import { migrateWorkspaceUserEmail } from "./utils/migrate-workspace-user-email";
import {
  dedupeOperationIds,
  ensureOperationSummaries,
  markOptionalSchemaFieldsNullable,
  mergeOpenApiSpecs,
  normalizeApiServerUrl,
  normalizeEmptyAndEnumSchemas,
  normalizeEmptyRequiredArrays,
  normalizeMalformedPropertySchemas,
  normalizeNullableSchemasForOpenApi30,
  normalizeOrganizationAuthOperations,
} from "./utils/openapi-spec";
import { seedDefaultWorkspaceRoles } from "./utils/seed-default-workspace-roles";
import { validateWorkspaceAccess } from "./utils/validate-workspace-access";
import whatsapp from "./whatsapp";
import workflowRule from "./workflow-rule";
import workspace from "./workspace";
import {
  addConnection,
  addUserConnection,
  initializeWebSocketAdapter,
  removeConnection,
  removeUserConnection,
  shutdownWebSocketAdapter,
} from "./ws";

type ApiKey = {
  id: string;
  userId: string;
  enabled: boolean;
  permissions: Record<string, string[]> | null;
};

type AppVariables = {
  Variables: {
    user: User | null;
    session: Session | null;
    userId: string;
    apiKey?: ApiKey;
  };
};

type ApiVariables = {
  Variables: {
    user: User | null;
    session: Session | null;
    userId: string;
    userEmail: string;
    apiKey?: ApiKey;
  };
};

const SAFE_INLINE_ASSET_TYPES = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function buildContentDisposition(filename: string, inline: boolean) {
  const normalized = filename
    .normalize("NFC")
    .replace(/[\r\n"]/g, "")
    .trim();
  const safeFilename = normalized || "file";
  const asciiFallback =
    safeFilename
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\\/]/g, "-")
      // \x7E, not \u7E. `\u` needs four hex digits, so `\u7E` was parsed as a
      // literal `u` and the range silently became \x20-u (0x20–0x75) — every
      // v, w, x, y and z in a download filename came out as an underscore
      // ("review-v2.pdf" -> "re_ie_-_2.pdf"). tsc flagged it as TS1125 the
      // whole time; nothing was running tsc against a real file list.
      .replace(/[^\x20-\x7E]+/g, "_")
      .replace(/\s+/g, " ")
      .trim() || "file";
  const encodedFilename = encodeURIComponent(safeFilename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  const disposition = inline ? "inline" : "attachment";
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}

export function createApp() {
  const app = new Hono<AppVariables>();
  const nodeWs = createNodeWebSocket({ app });
  const { upgradeWebSocket, injectWebSocket } = nodeWs;
  const corsOriginSource = [
    process.env.CORS_ORIGINS,
    process.env.NURAVIEW_CLIENT_URL,
  ].find((value) => value?.trim());
  const corsOrigins = corsOriginSource
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(
    "*",
    cors({
      credentials: true,
      origin: (origin) => {
        if (!corsOrigins) {
          return origin || "*";
        }

        if (!origin) {
          return null;
        }

        return corsOrigins.includes(origin) ? origin : null;
      },
    }),
  );

  const api = new Hono<ApiVariables>();

  api.get("/health", (c) => {
    return c.json({ status: "ok" });
  });

  api.get(
    "/instance/status",
    describeRoute({
      operationId: "getInstanceStatus",
      tags: ["Instance"],
      description:
        "Public instance setup status. When hasUsers is false the next signup becomes the instance admin.",
      security: [],
      responses: {
        200: {
          description: "Instance status",
          content: {
            "application/json": {
              schema: resolver(
                v.object({
                  hasUsers: v.boolean(),
                  hasAdmin: v.boolean(),
                }),
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const status = await getInstanceStatus();
      return c.json(status);
    },
  );

  /*
   * Nothing about a board is served before the auth middleware, and nothing
   * should be added here that is.
   *
   * Two routes used to sit at this spot, both ahead of authentication:
   * /public-task/:shareId (a card by share token) and /public-project/:id (a
   * whole board flagged is_public). Boards are internal — clients, scope,
   * team comments — and an employee only sees the projects they are assigned
   * to. Neither route asked who was calling.
   *
   * Both are gone. A card is GET /task/:id/card, behind auth, and only for
   * someone assigned to that card's project (task/card-link.ts). A board is
   * reachable only through the authenticated project routes.
   */
  api.post("/github-integration/webhook", handleGithubWebhookRoute);

  api.post(
    "/gitea-integration/webhook/:integrationId",
    handleGiteaWebhookRoute,
  );

  const invitationPublicApi = api.get("/invitation/public/:id", async (c) => {
    const { id } = c.req.param();
    const result = await getInvitationDetails(id);
    return c.json(result);
  });

  /**
   * Machine ingest — the Upwork scraper and the WhatsApp bridge.
   *
   * MOUNTED HERE, ahead of the session middleware, because the callers are
   * containers holding a bearer token, not browsers holding a cookie. Each
   * route applies its own SCRAPER_API_KEY / WHATSAPP_API_KEY check.
   *
   * These paths are load-bearing for the business: `nuraview-scraper` POSTs
   * leads to /api/ingest/upwork against a hard-coded crmx1 URL, so the moment
   * crmx1 points at this stack, lead ingestion depends on this mount existing.
   */
  const ingestApi = api.route("/ingest", ingest);

  /**
   * Scheduled jobs. Also pre-session: the VPS crontab calls
   * /api/cron/reminders?secret=… every 10 minutes. Each route requires
   * CRON_SECRET (fail-closed — see utils/cron-auth.ts).
   */
  const cronApi = api.route("/cron", cron);

  /**
   * Public endpoints whose URLs are already in delivered email and sent
   * WhatsApp messages — the reminder stop link and the open/click trackers.
   * Pre-session by necessity: the person clicking is a prospect, not a user.
   */
  const publicApi = api.route("/", publicEndpoints);

  /**
   * Twilio webhooks. Also pre-session — Twilio holds no cookie; the request
   * signature is the authentication and each route checks it first.
   */
  const twilioWebhookApi = api.route("/twilio", twilioApi);

  /**
   * Stripe webhooks. Pre-session for the same reason as Twilio's — Stripe holds
   * no cookie, and the request signature IS the authentication.
   *
   * Mounted at "/webhooks" so the path is /api/webhooks/stripe, identical to
   * the legacy app's. That URL is registered in the Stripe dashboard and is not
   * ours to change: repointing it means editing the endpoint in Stripe, and any
   * event in flight during the change is lost.
   *
   * NOTE: nginx currently proxies /api/webhooks/ to the legacy container, so
   * this route is dark until that prefix is removed from crmx1.cutover.conf.
   * It is here first so the switch is one nginx line, not a deploy.
   */
  const stripeWebhookApi = api.route("/webhooks", stripeWebhook);

  /**
   * The client-facing proposal. Pre-session like the Twilio and Stripe hooks —
   * the recipient is a prospect, and the share token is the credential.
   *
   * This is what lets the legacy Next app be switched off: /proposal/ and
   * /api/proposals/public/ were the last routes nginx still had to send there.
   */
  const publicProposalApi = api.route("/proposal-public", publicProposal);
  /*
   * SAME router, LEGACY path. The SPA's public proposal page still posts to
   * /api/proposals/public/:token/approve|reject|paypal and loads assets from
   * .../asset/:id — the URLs nginx used to forward to the old Next app. When
   * that forward was removed, only /proposal-public was mounted here, so every
   * one of those calls 404'd: signing showed "Approval failed", images broke.
   * Mounted BEFORE /proposals (uploads) so the longer prefix wins.
   */
  api.route("/proposals/public", publicProposal);

  /*
   * The client-facing INVOICE, pre-session for the same reason as the proposal:
   * the recipient is a client and the HMAC in the link is the credential. This
   * is the non-signer path — someone who pays without signing anything.
   */
  api.route("/invoice-public", publicInvoice);
  /*
   * The portal claim page. Unauthenticated by necessity — it is opened from an
   * email by someone who does not have an account yet — so it mounts here with
   * the other public routes, before the session gate. It reveals only the
   * invited email and the customer's name, never orders.
   */
  api.route("/portal-public", portalPublic);
  // Scheduler share links. Pre-auth on purpose: the token IS the credential,
  // and a recipient with no CRM account must not meet a sign-in wall.
  api.route("/linkedin-public", linkedinPublic);

  /*
   * Proposal asset uploads. Mounted at the LEGACY path on purpose —
   * /api/proposals/upload-url and /api/proposals/ckeditor-upload are hard-coded
   * in the ported sections editor and the CKEditor adapter, so keeping the URLs
   * identical meant neither had to change.
   */
  const proposalUploadsApi = api.route("/proposals", proposalUploads);

  api.get(
    "/auth/get-session",
    describeRoute({
      operationId: "getSession",
      tags: ["Authentication"],
      description: "Get the current authenticated session",
      security: [],
      responses: {
        200: {
          description: "Current session details or null when unauthenticated",
          content: {
            "application/json": { schema: resolver(v.any()) },
          },
        },
      },
    }),
    async (c) => {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      return c.json(session ?? null);
    },
  );

  api.get(
    "/asset/:id",
    describeRoute({
      operationId: "getAsset",
      tags: ["Assets"],
      description: "Download an uploaded asset by ID",
      security: [],
      responses: {
        200: {
          description: "The requested asset binary stream",
          content: {
            "*/*": { schema: { type: "string", format: "binary" } },
          },
        },
      },
    }),
    validator("param", v.object({ id: v.string() })),
    async (c) => {
      const { id } = c.req.param();
      const [asset] = await db
        .select({
          id: schema.assetTable.id,
          objectKey: schema.assetTable.objectKey,
          mimeType: schema.assetTable.mimeType,
          filename: schema.assetTable.filename,
          workspaceId: schema.assetTable.workspaceId,
        })
        .from(schema.assetTable)
        .where(eq(schema.assetTable.id, id))
        .limit(1);

      if (!asset) {
        throw new HTTPException(404, { message: "Asset not found" });
      }

      // Attachments follow the board, and the board is internal. This used to
      // let an anonymous caller through whenever the owning project had
      // is_public set — the flag that published a board also published every
      // file on it. There is no such flag any more: a session (or an API key)
      // is required, always.
      const { userId, apiKeyId } = await resolveAssetBearerOrCookie(c);

      if (!userId) {
        throw new HTTPException(401, { message: "Unauthorized" });
      }

      await validateWorkspaceAccess(userId, asset.workspaceId, apiKeyId);

      try {
        const object = await getPrivateObject(asset.objectKey);
        const storedContentType =
          (object.contentType || asset.mimeType)
            .toLowerCase()
            .split(";")[0]
            ?.trim() ?? "";
        const inline = SAFE_INLINE_ASSET_TYPES.has(storedContentType);

        return new Response(object.body as BodyInit, {
          headers: {
            "Cache-Control": "private, max-age=120",
            "Content-Disposition": buildContentDisposition(
              asset.filename,
              inline,
            ),
            "Content-Length": object.contentLength?.toString() || "",
            "Content-Type": inline
              ? storedContentType
              : "application/octet-stream",
            "X-Content-Type-Options": "nosniff",
            ETag: object.etag || "",
            "Last-Modified": object.lastModified?.toUTCString() || "",
          },
        });
      } catch (error) {
        console.error("Failed to stream asset:", error);
        throw new HTTPException(404, { message: "Asset object not found" });
      }
    },
  );

  const configApi = api.route("/config", config);

  const honoOpenApiHandler = openAPIRouteHandler(api, {
    documentation: {
      openapi: "3.0.3",
      info: {
        title: "NuraView API",
        version: "1.0.0",
        description:
          "NuraView Project Management API - Manage projects, tasks, labels, and more",
      },
      servers: [
        {
          url: normalizeApiServerUrl(
            process.env.NURAVIEW_API_URL || "https://cloud.nuraview.app",
          ),
          description: "NuraView API Server",
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description: "API key or session token (Bearer)",
          },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  });

  api.get("/openapi", async (c) => {
    const maybeResponse = await honoOpenApiHandler(c, async () => {});
    const honoSpecResponse = maybeResponse ?? c.res;
    const honoSpec = (await honoSpecResponse.json()) as Record<string, unknown>;

    let authSpec: Record<string, unknown> = {};
    try {
      authSpec = (await auth.api.generateOpenAPISchema()) as Record<
        string,
        unknown
      >;
    } catch (error) {
      console.error("Failed to generate Better Auth OpenAPI schema:", error);
    }

    const normalizedAuthSpec = normalizeOrganizationAuthOperations(authSpec);
    return c.json(
      ensureOperationSummaries(
        dedupeOperationIds(
          markOptionalSchemaFieldsNullable(
            normalizeNullableSchemasForOpenApi30(
              normalizeEmptyAndEnumSchemas(
                normalizeEmptyRequiredArrays(
                  normalizeMalformedPropertySchemas(
                    mergeOpenApiSpecs(honoSpec, normalizedAuthSpec),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  });

  // Better Auth serves GET /auth/device as JSON. Browsers that open the API URL
  // directly expect a page — redirect full document navigations to the web app.
  const authDeviceQuerySchema = v.object({
    user_code: v.optional(v.string()),
    ui: v.optional(v.picklist(["1"])),
  });

  api.get(
    "/auth/device",
    describeRoute({
      operationId: "getDeviceAuthorizationPage",
      tags: ["Authentication"],
      description:
        "Redirect browser-based device authorization requests to the web UI",
      security: [],
      parameters: [
        {
          name: "user_code",
          in: "query",
          required: false,
          schema: {
            type: "string",
          },
          description: "The device authorization user code.",
        },
        {
          name: "ui",
          in: "query",
          required: false,
          schema: {
            type: "string",
            enum: ["1"],
          },
          description: "Force a redirect to the web UI.",
        },
      ],
      responses: {
        302: {
          description: "Redirects the browser to the web app device screen",
        },
        200: {
          description: "Device authorization payload from Better Auth",
          content: {
            "application/json": { schema: resolver(v.any()) },
          },
        },
      },
    }),
    validator("query", authDeviceQuerySchema),
    async (c) => {
      const { user_code: userCode, ui } = c.req.valid("query");
      const secFetchDest = c.req.header("Sec-Fetch-Dest");
      const forceUiRedirect = ui === "1";
      // Top-level browser tab / address bar (not `fetch()` / XHR from the SPA).
      // Optional `ui=1` forces redirect when Sec-Fetch-* headers are missing (e.g. some clients).
      if (forceUiRedirect || secFetchDest === "document") {
        const clientUrl = (
          process.env.NURAVIEW_CLIENT_URL || "http://localhost:5173"
        ).replace(/\/$/, "");
        const deviceUrl = new URL(`${clientUrl}/device`);
        if (userCode) {
          deviceUrl.searchParams.set("user_code", userCode);
        }
        return c.redirect(deviceUrl.toString(), 302);
      }
      return auth.handler(c.req.raw);
    },
  );

  /*
   * Members of the SHARED workspace come from crmx1, not from here.
   *
   * The board's assignee filter and avatars load
   * /api/auth/organization/list-members?organizationId=<workspace>. That
   * workspace is NuraView's, so this instance's better-auth answered 403
   * "You are not a member of this organization" on every board render.
   *
   * Registered before the better-auth catch-all below, and scoped to this ONE
   * endpoint rather than /auth/*: forwarding the whole auth surface would hand
   * sign-in, session and organization management to another deployment. The
   * middleware still only forwards when the organization id is the shared one,
   * so any other workspace stays local.
   */
  api.use("/auth/organization/list-members", sharedProjectPassthrough);

  api.on(["POST", "GET", "PUT", "DELETE"], "/auth/*", async (c) => {
    const authHeader = c.req.header("Authorization");
    const apiKeyHeader = c.req.header("x-api-key");
    const bearerMatch = authHeader?.match(/^Bearer\s+(\S+)$/i);

    if (bearerMatch && !apiKeyHeader) {
      const session = await auth.api.getSession({
        headers: c.req.raw.headers,
      });

      // Preserve Better Auth bearer session tokens on auth routes.
      if (session?.session && session.user) {
        return auth.handler(c.req.raw);
      }

      const headers = new Headers(c.req.raw.headers);

      // Better Auth API key plugin validates from x-api-key by default.
      headers.set("x-api-key", bearerMatch[1]);

      return auth.handler(
        new Request(c.req.raw, {
          headers,
        }),
      );
    }

    return auth.handler(c.req.raw);
  });

  api.route("/", mcpRoutes);

  api.use("*", async (c, next) => {
    const path = c.req.path;
    if (path.startsWith("/api/mcp") || path.startsWith("/api/.well-known/")) {
      return next();
    }
    try {
      await authenticateApiRequest(c);
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      console.error("API authentication failed:", error);
      throw new HTTPException(500, { message: "Internal Server Error" });
    }

    const windowId = c.req.header("X-NuraView-Window-Id");
    const userId = c.get("userId");
    const initiatorId = windowId ? `${userId}:${windowId}` : userId;

    return eventContext.run({ initiatorId }, next);
  });

  const oauthApi = api.route("/oauth", oauth);

  /**
   * Project-board surface. A lead-gen account (leads kanban only) must not
   * reach any of it — not the boards, not the task detail behind a guessed id,
   * not the workspace member list, not global search over task titles.
   *
   * Gated here by prefix rather than inside each router: one list, covering
   * every PM domain at once, and adding a domain later is a line here instead
   * of an edit to that domain. Registered BEFORE the routes below, because Hono
   * runs middleware in registration order.
   *
   * Deliberately NOT gated: /notification and /notification-preferences (user
   * scoped, and the shell's bell renders for everyone), /me/access, /config.
   */
  const PROJECT_SCOPED_PREFIXES = [
    "/project",
    "/task",
    "/column",
    "/comment",
    "/time-entry",
    "/label",
    "/task-relation",
    "/workflow-rule",
    "/external-link",
    "/activity",
    "/invitation",
    "/search",
    "/workspace",
    "/github-integration",
    "/gitea-integration",
    "/slack-integration",
  ];

  for (const prefix of PROJECT_SCOPED_PREFIXES) {
    // Both forms: "/project" alone does not match the "/project/*" pattern.
    api.use(prefix, requireProjectAccess);
    api.use(`${prefix}/*`, requireProjectAccess);

    /*
     * NuraView's shared project answers on these same endpoints.
     *
     * Registered after the access gate and before the routers, so a request
     * naming the shared project is authorised exactly like a local one and then
     * forwarded to crmx1 instead of hitting this database. Everything else
     * falls straight through. This is what lets the real board UI — backlog,
     * gantt, list view, labels, assignees, task detail — work against a project
     * that does not live here, without a second implementation of any of it.
     */
    api.use(prefix, sharedProjectPassthrough);
    api.use(`${prefix}/*`, sharedProjectPassthrough);
  }

  const projectApi = api.route("/project", project);
  const taskApi = api.route("/task", task);
  const columnApi = api.route("/column", column);
  const activityApi = api.route("/activity", activity);
  // CRM outreach scoreboard. Separate mount from Kaneo's task-activity domain
  // above — same word, unrelated data.
  const activityCrmApi = api.route("/activity-crm", activityCrm);
  const commentApi = api.route("/comment", comment);
  const timeEntryApi = api.route("/time-entry", timeEntry);
  // Voluntary work-clock + the Employees summary (meeting 2026-07-28).
  const timeTrackingApi = api.route("/work-time", timeTracking);
  // What this account is allowed to see. The SPA uses it to decide which nav
  // to render; the server enforces the same rule independently.
  const meAccessApi = api.get("/me/access", async (c) => {
    const userId = c.get("userId");
    const [role, crmLevel, projects, rows] = await Promise.all([
      getUserWorkspaceRole(userId),
      getCrmLevel(userId),
      canAccessProjects(userId),
      db
        .select({
          mustChangePassword: schema.userTable.mustChangePassword,
          twoFactorEnabled: schema.userTable.twoFactorEnabled,
          email: schema.userTable.email,
        })
        .from(schema.userTable)
        .where(eq(schema.userTable.id, userId))
        .limit(1),
    ]);
    return c.json({
      role,
      crmLevel,
      email: rows[0]?.email ?? null,
      // Operator handed out a temporary password; the holder has not replaced
      // it yet. The SPA blocks on this so the temporary one never becomes the
      // real one.
      mustChangePassword: rows[0]?.mustChangePassword ?? false,
      twoFactorEnabled: rows[0]?.twoFactorEnabled ?? false,
      // Full CRM. Kept as its own field so existing callers keep working and
      // so "can see leads at all" is never confused with "can see everything".
      canAccessCrm: crmLevel === CRM_FULL,
      canReadLeads: crmLevel !== "none",
      /*
       * May edit the fields on a lead — name, company, email, phone.
       *
       * This exists because the UI and the API disagreed. lead/index.ts opens
       * PATCH /lead/:id to the kanban role (KANBAN_WRITE_PATHS), but the drawer
       * gated its inputs on canAccessCrm, so a lead-gen employee saw every
       * field greyed out and no Save button. Entering the client details he
       * finds IS the job, and for the second time it looked like he was not
       * doing it.
       *
       * Mirrors the API rule exactly: anyone who can read leads can edit these
       * fields. If that rule moves, both sides move together.
       */
      canEditLeads: crmLevel !== "none",
      canAccessProjects: projects,
    });
  });

  const labelApi = api.route("/label", label);
  // NuraView CRM domains, ported off the Next app. Backed by the separate
  // CRM connection (see database/crm.ts), not the PM database.
  const leadApi = api.route("/lead", lead);
  /*
   * This instance's lead pipeline, proxied from the Python cockpit on the VPS.
   * Separate from /lead, which reads NuraView's own crm_Leads table — these
   * are two different lead sources for two different instances, and merging
   * them behind one prefix would make it impossible to tell which is answering.
   * Inert unless LEADGEN_API_BASE is set, so NuraView's instance is unaffected.
   */
  api.route("/leadgen", leadgen);
  api.route("/assistant", assistant);
  /*
   * Orders & purchases, and the customer portal.
   *
   * /portal-public is mounted with the other unauthenticated routes because the
   * claim page is opened from an email by someone who has no account yet.
   * /portal itself needs a session but NOT CRM access — a customer is not a CRM
   * user, and requireCrmAccess would lock them out of their own order.
   */
  /*
   * The shared project board. Dan's dashboard and NuraView's read and write the
   * SAME project on crmx1 through this proxy, so "sync both ways" needs no sync
   * — there is one source of truth. Pinned to a single project id; NuraView's
   * internal boards are not reachable from here.
   */
  api.route("/nvprojects", nvprojects);
  api.route("/order", order);
  api.route("/linkedin", linkedin);
  api.route("/portal", portal);
  /*
   * Invoices, staff side. Admin-gated inside the router (this is money), and
   * mounted here rather than under the project-scoped prefixes because it is
   * a CRM surface, not a board one.
   */
  api.route("/invoice", invoice);
  const notificationApi = api.route("/notification", notification);
  const notificationPreferencesApi = api.route(
    "/notification-preferences",
    notificationPreferences,
  );
  // Scraper health + Upwork cookie upload — the System Health tab. Session
  // authed, unlike the bearer-authed /api/ingest routes the scraper calls.
  // Proposals — read surface. Authoring, PDF and the public share page stay on
  // the legacy app until cutover; see apps/api/src/proposal/index.ts.
  // Dialer — Voice token, call log, SMS/WhatsApp history, presence.
  const dialerApi = api.route("/dialer", dialer);
  // Marketing mailbox — read surface. Sending, follow-ups, bounce polling and
  // the /track pixels stay on legacy until Inngest + the IMAP sidecar land.
  const marketingApi = api.route("/marketing", marketing);
  const proposalApi = api.route("/proposal", proposal);
  const scraperApi = api.route("/scraper", scraper);
  const searchApi = api.route("/search", search);
  const githubIntegrationApi = api.route(
    "/github-integration",
    githubIntegration,
  );
  const giteaIntegrationApi = api.route("/gitea-integration", giteaIntegration);
  const genericWebhookIntegrationApi = api.route(
    "/generic-webhook-integration",
    genericWebhookIntegration,
  );
  const discordIntegrationApi = api.route(
    "/discord-integration",
    discordIntegration,
  );
  const slackIntegrationApi = api.route("/slack-integration", slackIntegration);
  const telegramIntegrationApi = api.route(
    "/telegram-integration",
    telegramIntegration,
  );
  const taskRelationApi = api.route("/task-relation", taskRelation);
  const externalLinkApi = api.route("/external-link", externalLink);
  const workflowRuleApi = api.route("/workflow-rule", workflowRule);
  const invitationApi = api.route("/invitation", invitation);
  // WhatsApp bridge status / recipients / send — the Administration panel and
  // the lead drawer's reminder dropdown.
  const whatsappApi = api.route("/whatsapp", whatsapp);
  const workspaceApi = api.route("/workspace", workspace);

  app.route(
    "/",
    mcpWellKnownRoutes(
      (process.env.NURAVIEW_API_URL || "http://localhost:1337").replace(
        /\/api\/?$/,
        "",
      ),
    ),
  );

  // User-scoped WebSocket endpoint — MUST be registered before /ws/:projectId
  // so the literal path "user" isn't consumed by the param route.
  api.get(
    "/ws/user",
    upgradeWebSocket(async (c) => {
      try {
        await authenticateApiRequest(c);
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        console.error("API authentication failed:", error);
        throw new HTTPException(500, { message: "Internal Server Error" });
      }

      const userId = c.get("userId");
      let conn: ReturnType<typeof addUserConnection> | null = null;

      return {
        onOpen(_evt, ws) {
          if (userId) {
            conn = addUserConnection(userId, ws);
          }
        },
        onMessage(evt) {
          try {
            const raw =
              typeof evt.data === "string"
                ? evt.data
                : Buffer.isBuffer(evt.data)
                  ? evt.data.toString()
                  : null;
            if (raw) {
              const msg = JSON.parse(raw) as { type?: string };
              if (msg?.type === "ping") {
                // keepalive — no-op
              }
            }
          } catch {
            // Ignore malformed messages
          }
        },
        onClose() {
          if (conn && userId) {
            removeUserConnection(userId, conn);
          }
        },
      };
    }),
  );

  api.get(
    "/ws/:projectId",
    upgradeWebSocket(async (c) => {
      const projectId = c.req.param("projectId");

      try {
        await authenticateApiRequest(c);
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        console.error("API authentication failed:", error);
        throw new HTTPException(500, { message: "Internal Server Error" });
      }

      const userId = c.get("userId");

      if (projectId) {
        const [project] = await db
          .select({ workspaceId: schema.projectTable.workspaceId })
          .from(schema.projectTable)
          .where(eq(schema.projectTable.id, projectId))
          .limit(1);

        if (!project) {
          throw new HTTPException(401, { message: "Unauthorized" });
        }

        await validateWorkspaceAccess(userId, project.workspaceId);
      }

      const windowId = c.req.query("windowId");
      const initiatorId = windowId ? `${userId}:${windowId}` : userId;
      let conn: ReturnType<typeof addConnection> | null = null;

      return {
        onOpen(_evt, ws) {
          if (projectId) {
            conn = addConnection(projectId, ws, userId, initiatorId);
          }
        },
        onMessage(evt) {
          // Respond to client keepalive pings (sent every 30s to prevent
          // Cloudflare from closing idle connections at 100s timeout)
          try {
            const raw =
              typeof evt.data === "string"
                ? evt.data
                : Buffer.isBuffer(evt.data)
                  ? evt.data.toString()
                  : null;
            if (raw) {
              const msg = JSON.parse(raw) as { type?: string };
              if (msg?.type === "ping") {
                // No-op: receiving the ping is enough to satisfy Cloudflare.
                // A pong response is optional but helps confirm liveness.
              }
            }
          } catch {
            // Ignore malformed messages
          }
        },
        onClose() {
          if (conn && projectId) {
            removeConnection(projectId, conn);
          }
        },
      };
    }),
  );

  app.route("/api", api);

  return {
    app,
    api,
    injectWebSocket,
    activityApi,
    columnApi,
    commentApi,
    configApi,
    discordIntegrationApi,
    externalLinkApi,
    genericWebhookIntegrationApi,
    githubIntegrationApi,
    giteaIntegrationApi,
    invitationApi,
    invitationPublicApi,
    labelApi,
    notificationApi,
    notificationPreferencesApi,
    projectApi,
    searchApi,
    slackIntegrationApi,
    taskApi,
    taskRelationApi,
    telegramIntegrationApi,
    timeEntryApi,
    workflowRuleApi,
    workspaceApi,
    oauthApi,
  };
}

/**
 * Everything that mutates the database on boot.
 *
 * Split out of runStartupTasks() because the serverless deployment has no boot
 * — a Vercel Function is created per request, and running 10 migrations plus a
 * role seed on each cold start would be both slow and a concurrent-DDL hazard.
 * There, this runs once from CI (`bun run db:deploy`) and the function only
 * ever serves traffic. On the VPS nothing changes: startServer() still calls
 * runStartupTasks(), which still calls this first.
 */
export async function runDatabaseMigrations() {
  const currentDir = dirname(fileURLToPath(import.meta.url));

  await prepareDatabaseStartup({
    waitForDatabase: async () => {
      await waitForDatabase({
        query: async () => {
          await getDatabase().execute(sql`SELECT 1`);
        },
      });
    },
    runStartupMigrations: async () => {
      await migrateWorkspaceUserEmail();
      await migrateSessionColumn();

      console.log("🔄 Migrating database...");
      await migrate(getDatabase(), {
        migrationsFolder: `${currentDir}/../drizzle`,
      });
      console.log("✅ Database migrated successfully!");
    },
  });

  // After Drizzle migrations: apikey table must exist so we can align columns
  // with Better Auth (reference_id + nullable user_id).
  await migrateApiKeyReferenceId();

  await migrateNotificationPreferencesSchema();
  // CRM database (separate connection): the outreach-email columns the lead
  // drawer reads and the send route writes.
  await migrateCrmLeadEmailColumns();
  await migrateCrmProposalColumns();
  await migrateCrmLeadViews();
  await migrateGitHubIntegration();
  await migrateColumns();
  await seedDefaultWorkspaceRoles();
}

/**
 * Long-lived background machinery: the plugin registry, the croner scheduler
 * and the Redis WebSocket fan-out. All three assume a process that outlives a
 * request, so the serverless entrypoint deliberately never calls this — cron
 * work is driven by Vercel Cron hitting /api/cron/* instead, and the SPA falls
 * back to polling when no socket is available.
 */
export async function initializeRuntimeServices() {
  initializePlugins();
  initializeScheduler();
  await initializeWebSocketAdapter();
}

export async function runStartupTasks() {
  await runDatabaseMigrations();
  await initializeRuntimeServices();
}

export async function startServer(
  injectWebSocket: ReturnType<typeof createNodeWebSocket>["injectWebSocket"],
  port = 1337,
) {
  try {
    await runStartupTasks();
  } catch (error) {
    console.error("❌ Database migration failed!", error);
    process.exit(1);
  }

  let shuttingDown = false;

  const server = serve(
    {
      fetch: app.fetch,
      port,
    },
    () => {
      console.log(
        `⚡ API is running at ${process.env.NURAVIEW_API_URL || "http://localhost:1337"}`,
      );
    },
  );

  injectWebSocket(server);

  const gracefulShutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log("🛑 Shutting down gracefully...");
    shutdownScheduler();
    await shutdownWebSocketAdapter();
    server.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void gracefulShutdown();
  });

  process.on("SIGINT", () => {
    void gracefulShutdown();
  });

  // Node's default policy is to terminate on an unhandled rejection. For an API
  // server that is the wrong trade: a rejected promise in background work (a
  // scheduled job, a webhook delivery, a plugin event) should not stop the
  // process from serving requests. This already happened once — a transient
  // "Connection terminated due to connection timeout" inside a 5-minute cron
  // took the whole API down.
  //
  // Rejections are logged loudly rather than swallowed silently, so they still
  // get fixed. uncaughtException is NOT made non-fatal: at that point process
  // state is genuinely unreliable, so we shut down cleanly and let the
  // container restart us.
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection] (continuing):", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("[uncaughtException] shutting down:", error);
    void gracefulShutdown();
  });
}

const createdApp = createApp();
const {
  app,
  injectWebSocket,
  activityApi,
  columnApi,
  commentApi,
  configApi,
  discordIntegrationApi,
  externalLinkApi,
  genericWebhookIntegrationApi,
  githubIntegrationApi,
  giteaIntegrationApi,
  invitationApi,
  invitationPublicApi,
  labelApi,
  notificationApi,
  notificationPreferencesApi,
  projectApi,
  searchApi,
  slackIntegrationApi,
  taskApi,
  taskRelationApi,
  telegramIntegrationApi,
  timeEntryApi,
  workflowRuleApi,
  workspaceApi,
  oauthApi,
} = createdApp;

const isMainModule =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  void startServer(injectWebSocket);
}

export type AppType =
  | typeof configApi
  | typeof projectApi
  | typeof taskApi
  | typeof columnApi
  | typeof activityApi
  | typeof commentApi
  | typeof timeEntryApi
  | typeof labelApi
  | typeof notificationApi
  | typeof notificationPreferencesApi
  | typeof searchApi
  | typeof githubIntegrationApi
  | typeof giteaIntegrationApi
  | typeof genericWebhookIntegrationApi
  | typeof discordIntegrationApi
  | typeof slackIntegrationApi
  | typeof telegramIntegrationApi
  | typeof taskRelationApi
  | typeof externalLinkApi
  | typeof workflowRuleApi
  | typeof invitationApi
  | typeof workspaceApi
  | typeof invitationPublicApi
  | typeof oauthApi;

export default app;
