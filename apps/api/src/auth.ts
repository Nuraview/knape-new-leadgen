import { apiKey } from "@better-auth/api-key";
import {
  sendMagicLinkEmail,
  sendOtpEmail,
  sendWorkspaceInvitationEmail,
} from "@nuraview/email";
import {
  ac,
  DEFAULT_ROLE_NAMES,
  defaultRolePayloads,
  owner,
} from "@nuraview/permissions";
import bcrypt from "bcryptjs";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";
import {
  admin as adminPlugin,
  bearer,
  deviceAuthorization,
  emailOTP,
  genericOAuth,
  lastLoginMethod,
  magicLink,
  openAPI,
  organization,
  twoFactor,
} from "better-auth/plugins";
import type { AccessControl } from "better-auth/plugins/access";
import { config } from "dotenv-mono";
import { count, eq, sql } from "drizzle-orm";
import db, { schema } from "./database";
import { publishEvent } from "./events";
import { checkRegistrationAllowed } from "./utils/check-registration-allowed";
import { checkWorkspaceName } from "./utils/check-workspace-name";
import { mapCustomOAuthProfileToUser } from "./utils/custom-oauth-profile";
import { getInvitationEmailSubject } from "./utils/get-invitation-email-subject";
import { getWorkspaceInvitationEmailCopy } from "./utils/get-workspace-invitation-email-copy";
import { getGithubSsoOAuthCredentials } from "./utils/github-sso-env";
import { isCloud } from "./utils/is-cloud";
import { isDisposableEmail } from "./utils/is-disposable-email";
import { isLocalSignInPath } from "./utils/is-local-sign-in-path";
import { verifyTurnstile } from "./utils/verify-turnstile";

config();

const githubSso = getGithubSsoOAuthCredentials();

const isRegistrationDisabled = process.env.DISABLE_REGISTRATION === "true";
const isPasswordRegistrationDisabled =
  process.env.DISABLE_PASSWORD_REGISTRATION === "true";
const isLoginFormDisabled = process.env.DISABLE_LOGIN_FORM === "true";
const isEmailOtpSignInDisabled =
  process.env.DISABLE_EMAIL_OTP_SIGN_IN === "true";

function normalizeInvitationId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!/^[a-z0-9_-]{1,128}$/i.test(normalized)) return undefined;
  return normalized;
}

const apiUrl = process.env.NURAVIEW_API_URL || "http://localhost:1337";
const clientUrl = process.env.NURAVIEW_CLIENT_URL || "http://localhost:5173";
const isHttps = apiUrl.startsWith("https://");
const isCrossSubdomain = (() => {
  try {
    const apiHost = new URL(apiUrl).hostname;
    const clientHost = new URL(clientUrl).hostname;
    return (
      apiHost !== clientHost &&
      apiHost !== "localhost" &&
      clientHost !== "localhost"
    );
  } catch {
    return false;
  }
})();

const trustedOrigins = [clientUrl];
try {
  const apiOrigin = new URL(apiUrl);
  const apiOriginString = `${apiOrigin.protocol}//${apiOrigin.host}`;
  if (!trustedOrigins.includes(apiOriginString)) {
    trustedOrigins.push(apiOriginString);
  }
} catch {}

const baseURLWithoutPath = (() => {
  try {
    const url = new URL(apiUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return apiUrl.split("/").slice(0, 3).join("/"); // Get protocol://host
  }
})();

if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length < 32) {
  console.error(
    "AUTH_SECRET is less than 32 characters, please generate a new one.",
  );
  process.exit(1);
}

async function getUserLocale(email: string) {
  const [user] = await db
    .select({ locale: schema.userTable.locale })
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email))
    .limit(1);

  return user?.locale ?? null;
}

function getLocaleKey(locale?: string | null) {
  return locale?.toLowerCase().startsWith("de") ? "de" : "en";
}

function getAuthEmailCopy(locale?: string | null) {
  return getLocaleKey(locale) === "de"
    ? {
        magicLinkSubject: "Anmeldelink fuer NuraView",
        otpSubject: "Bestaetigungscode fuer NuraView",
      }
    : {
        magicLinkSubject: "Login for NuraView",
        otpSubject: "Authentication code for NuraView",
      };
}

function getDeviceAuthClientIds(): Set<string> {
  const raw = process.env.DEVICE_AUTH_CLIENT_IDS?.trim();
  if (raw) {
    return new Set(
      raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return new Set(["nuraview-cli", "nuraview-mcp"]);
}

function getDeviceAuthVerificationUri(): string {
  const base = clientUrl.replace(/\/$/, "");
  return `${base}/device`;
}

export const auth = betterAuth({
  baseURL: baseURLWithoutPath,
  trustedOrigins,
  secret: process.env.AUTH_SECRET || "",
  basePath: "/api/auth",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      ...schema,
      user: schema.userTable,
      account: schema.accountTable,
      session: schema.sessionTable,
      verification: schema.verificationTable,
      workspace: schema.workspaceTable,
      workspace_member: schema.workspaceUserTable,
      invitation: schema.invitationTable,
      workspace_role: schema.workspaceRoleTable,
      team: schema.teamTable,
      teamMember: schema.teamMemberTable,
      apikey: schema.apikeyTable,
      deviceCode: schema.deviceCodeTable,
      // The twoFactor plugin looks up the model by this exact name. The map is
      // explicit — a table merely existing in ./schema is not enough, which is
      // why enrolment 500'd with "model twoFactor was not found in the schema
      // object" while the table itself was live in production.
      twoFactor: schema.twoFactorTable,
    },
  }),
  user: {
    additionalFields: {
      locale: {
        type: "string",
        input: true,
        required: false,
      },
    },
  },
  account: {
    accountLinking: {
      // Link an OAuth/OIDC sign-in to an existing account that shares the same
      // email instead of failing with error=account_not_linked. The listed
      // providers verify the email on their side, so they are trusted to link.
      enabled: true,
      trustedProviders: ["github", "google", "discord", "custom"],
      // Only link to an existing local account after its email has been
      // verified. Without this check, an attacker could pre-register a victim's
      // email with a password account and retain access after the victim signs
      // in through a trusted OAuth/OIDC provider.
      requireLocalEmailVerified: true,
    },
  },
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    password: {
      hash: async (password) => {
        return await bcrypt.hash(password, 10);
      },
      verify: async ({ hash, password }) => {
        return await bcrypt.compare(password, hash);
      },
    },
  },
  socialProviders: {
    github: {
      clientId: githubSso.clientId,
      clientSecret: githubSso.clientSecret,
      scope: ["user:email"],
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
    discord: {
      clientId: process.env.DISCORD_CLIENT_ID || "",
      clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
    },
  },
  plugins: [
    // Upstream ships better-auth's anonymous() plugin so a SaaS visitor can try
    // the product without an account. NuraView is an internal CRM behind a
    // fixed team with public registration disabled, so a "Continue as guest"
    // button is a way to mint a real user row without an invitation — the exact
    // thing DISABLE_REGISTRATION exists to prevent. The plugin is removed
    // outright rather than env-gated: the old gate was
    // `DISABLE_GUEST_ACCESS !== "true"`, i.e. guest access was ON unless an env
    // var said otherwise, which fails OPEN on a missing variable.
    //
    // The isAnonymous guards further down are deliberately kept — any
    // `is_anonymous = true` row left over from before this change stays locked
    // out instead of quietly becoming an ordinary account.
    /*
     * TOTP two-factor.
     *
     * VK 2026-07-28: "for the admin access I would like a 2FA to be added
     * over there... let me use authenticator app", and explicitly "only for
     * me, not for everyone". So this is a capability, not a policy: the
     * endpoints exist for every account, but only users who actually enrol are
     * ever challenged. Nothing here forces enrolment on anyone else.
     *
     * `issuer` is what shows up as the account label inside Google
     * Authenticator / Authy, so it has to be the product name rather than a
     * hostname — a row reading "crmx2.nuraview.com" next to a dozen others is
     * how people delete the wrong entry.
     */
    twoFactor({
      issuer: "NuraView",
      skipVerificationOnEnable: false,
    }),
    lastLoginMethod(),
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        try {
          const locale = await getUserLocale(email);
          const copy = getAuthEmailCopy(locale);
          await sendMagicLinkEmail(email, copy.magicLinkSubject, {
            magicLink: url,
            locale,
          });
        } catch (error) {
          console.error(error);
        }
      },
    }),
    ...(isEmailOtpSignInDisabled
      ? []
      : [
          emailOTP({
            async sendVerificationOTP({ email, otp, type }) {
              if (type === "sign-in") {
                const locale = await getUserLocale(email);
                const copy = getAuthEmailCopy(locale);
                await sendOtpEmail(email, copy.otpSubject, {
                  otp,
                  locale,
                });
              }
            },
          }),
        ]),
    organization({
      // `ac` is created with a narrow `statement` shape (project/task/label/
      // workspace + the default org statements), which makes its inferred
      // `newRole` generic incompatible with better-auth's looser
      // `AccessControl` type. Widen via an explicit cast so the plugin
      // accepts our custom statement.
      ac: ac as unknown as AccessControl,
      // Only `owner` stays static so its permissions can never be edited away
      // from the workspace creator. `viewer`, `member`, and `admin` are
      // seeded into `workspace_role` per workspace and resolved via
      // dynamic access control, so admins can fully override (replace) their
      // permissions per workspace. See `seedDefaultWorkspaceRoles` + the
      // afterCreateOrganization hook.
      roles: { owner },
      dynamicAccessControl: {
        enabled: true,
        maximumRolesPerOrganization: 25,
      },
      teams: {
        enabled: true,
        maximumTeams: 10,
        allowRemovingAllTeams: false,
      },
      schema: {
        organization: {
          modelName: "workspace",
          additionalFields: {
            // in metadata
            description: {
              type: "string",
              input: true,
              required: false,
            },
          },
        },
        member: {
          modelName: "workspace_member",
          fields: {
            organizationId: "workspaceId",
            createdAt: "joinedAt",
          },
        },
        invitation: {
          modelName: "invitation",
          fields: {
            organizationId: "workspaceId",
          },
        },
        organizationRole: {
          modelName: "workspace_role",
          fields: {
            organizationId: "workspaceId",
          },
        },
        team: {
          modelName: "team",
          fields: {
            organizationId: "workspaceId",
          },
        },
      },
      // PRIVILEGE ESCALATION FIX. Upstream is multi-tenant SaaS where any user
      // may spin up their own organization; better-auth makes the creator its
      // OWNER. NuraView is single-tenant, and CRM access is derived from
      // workspace role — so a projects-only employee could click "Create
      // workspace", land an `owner` row, and requireCrmAccess would then let
      // them read all ~50k leads. Verified against production before the fix:
      // member -> POST /api/auth/organization/create -> /api/lead/view 200.
      //
      // The one NuraView workspace is provisioned by scripts/seed-instance.ts,
      // which writes rows directly. Nothing in the product should create one.
      allowUserToCreateOrganization: false,
      // Better Auth defaults this to `true`, which blocks any user whose email
      // is not verified from accepting/rejecting an invitation. NuraView does not
      // verify emails on signup (and guest/anonymous users are unverified by
      // design), so leaving the default on breaks invitation acceptance for
      // everyone. The invitation link id is the actual secret here, so gate on
      // that rather than on email verification.
      requireEmailVerificationOnInvitation: false,
      organizationHooks: {
        beforeCreateOrganization: async ({ organization }) => {
          const check = checkWorkspaceName(organization.name ?? "");
          if (!check.ok) {
            throw new APIError("BAD_REQUEST", { message: check.reason });
          }
        },
        afterCreateOrganization: async ({ organization, user }) => {
          // Seed the editable default roles for this workspace. Each
          // role's permissions are derived from the compiled-in defaults
          // in `@nuraview/permissions`; admins can later replace them in the
          // Roles UI. We skip names that somehow already exist (this hook
          // is best-effort idempotent — the boot-time backfill is the
          // belt-and-braces path).
          try {
            const existing = await db
              .select({ role: schema.workspaceRoleTable.role })
              .from(schema.workspaceRoleTable)
              .where(
                eq(schema.workspaceRoleTable.workspaceId, organization.id),
              );
            const taken = new Set(existing.map((r) => r.role));
            const now = new Date();
            const rows = DEFAULT_ROLE_NAMES.filter(
              (name) => !taken.has(name),
            ).map((name) => ({
              workspaceId: organization.id,
              role: name,
              permission: JSON.stringify(defaultRolePayloads[name]),
              createdAt: now,
              updatedAt: now,
            }));
            if (rows.length > 0) {
              await db.insert(schema.workspaceRoleTable).values(rows);
            }
          } catch (error) {
            console.error(
              "Failed to seed default workspace roles for workspace",
              organization.id,
              error,
            );
          }

          publishEvent("workspace.created", {
            workspaceId: organization.id,
            workspaceName: organization.name,
            ownerEmail: user.name,
            ownerId: user.id,
          });
        },
      },
      async sendInvitationEmail(data) {
        const inviteLink = `${process.env.NURAVIEW_CLIENT_URL}/invitation/accept/${data.id}`;
        const locale = await getUserLocale(data.email);
        const copy = getWorkspaceInvitationEmailCopy(locale);

        const result = await sendWorkspaceInvitationEmail(
          data.email,
          getInvitationEmailSubject(
            locale,
            data.inviter.user.name,
            data.organization.name,
          ),
          {
            inviterEmail: data.inviter.user.email,
            inviterName: data.inviter.user.name,
            locale,
            workspaceName: data.organization.name,
            invitationLink: inviteLink,
            to: data.email,
            copy,
          },
        );

        if (
          result?.success === false &&
          result.reason === "SMTP_NOT_CONFIGURED"
        ) {
          console.warn(
            "Invitation created but email not sent due to SMTP not being configured",
          );
          return;
        }
      },
    }),
    genericOAuth({
      config: [
        {
          providerId: "custom",
          clientId: process.env.CUSTOM_OAUTH_CLIENT_ID || "",
          clientSecret: process.env.CUSTOM_OAUTH_CLIENT_SECRET,
          authorizationUrl: process.env.CUSTOM_OAUTH_AUTHORIZATION_URL || "",
          tokenUrl: process.env.CUSTOM_OAUTH_TOKEN_URL || "",
          userInfoUrl: process.env.CUSTOM_OAUTH_USER_INFO_URL || "",
          scopes: process.env.CUSTOM_OAUTH_SCOPES?.split(",")
            .map((s) => s.trim())
            .filter(Boolean) || ["profile", "email"],
          responseType: process.env.CUSTOM_OAUTH_RESPONSE_TYPE || "code",
          discoveryUrl: process.env.CUSTOM_OAUTH_DISCOVERY_URL || "",
          pkce: process.env.CUSTOM_AUTH_PKCE !== "false",
          mapProfileToUser: mapCustomOAuthProfileToUser,
        },
      ],
    }),
    bearer(),
    apiKey({
      enableSessionForAPIKeys: true,
      apiKeyHeaders: "x-api-key",
      rateLimit: {
        enabled: true,
        maxRequests: 100,
        timeWindow: 60 * 1000,
      },
    }),
    deviceAuthorization({
      verificationUri: getDeviceAuthVerificationUri(),
      validateClient: async (clientId) =>
        getDeviceAuthClientIds().has(clientId),
    }),
    adminPlugin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
    openAPI(),
  ],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  rateLimit: {
    // Enable in cloud; self-hosted instances opt in by setting NURAVIEW_CLOUD.
    // Default better-auth rate-limit only kicks in for production; we keep the
    // global limits conservative and tighten signup/invite via customRules.
    enabled: isCloud(),
    window: 10,
    max: 100,
    customRules: {
      "/sign-up/email": { window: 60, max: 3 },
      "/organization/invite-member": { window: 60, max: 5 },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          // NOTE: this hook used to start with an `if (isAnonymous) return;`
          // that skipped every registration limit below. That was sound while
          // the anonymous() plugin owned the flag, but the plugin is gone, so
          // the branch survived only as a way to bypass DISABLE_REGISTRATION if
          // anything ever set `isAnonymous` on a signup payload. Removed.

          // Allow the very first signup through even when registration
          // is disabled — that's the instance-admin bootstrap flow.
          // Otherwise a fresh instance with DISABLE_REGISTRATION=true
          // could never be set up because `checkRegistrationAllowed`
          // would reject the first user (qodo bot #3).
          const [{ value: existingUserCount }] = await db
            .select({ value: count() })
            .from(schema.userTable);
          if (existingUserCount === 0) {
            return;
          }

          const invitationId = normalizeInvitationId(
            ctx?.body?.invitationId ||
              ctx?.query?.invitationId ||
              ctx?.headers?.get("x-invitation-id"),
          );
          const result = await checkRegistrationAllowed(
            user.email,
            invitationId,
          );
          if (!result.allowed) {
            throw new APIError("FORBIDDEN", {
              message: result.reason,
            });
          }
        },
        after: async (user) => {
          // Never promote a guest row to instance admin. The anonymous()
          // plugin that produced these is gone, but `is_anonymous` still
          // exists as a column, so any row left over from before keeps this
          // protection. Narrowed inline now that the plugin's type is no
          // longer imported.
          const guest = user as { isAnonymous?: boolean | null };
          if (guest.isAnonymous) {
            return;
          }

          // Promote the first user to instance admin atomically.
          //
          // A previous version of this code checked the user count in
          // the `before` hook and returned `role: "admin"`, but the
          // count and the eventual INSERT happened in separate
          // transactions, so two concurrent first-signups could both
          // see count=0 and both become admins (qodo bot #5).
          //
          // We now run the check + promote inside a single transaction
          // guarded by a Postgres advisory lock. Whichever transaction
          // wins the lock first promotes its user; any concurrent
          // transaction then sees totalUserCount > 1 and skips.
          //
          // Note: we count total users (not admins) so that upgrading
          // an existing instance — where every existing user has
          // role=NULL from the new column — doesn't promote the next
          // signup to admin (qodo bot #4).
          await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(2026)`);

            const totalRows = await tx
              .select({ value: count() })
              .from(schema.userTable);
            const totalUserCount = totalRows[0]?.value ?? 0;

            // This hook runs after the user row is inserted, so the
            // just-created user is included in the count. If they are
            // the only row in the table, this is a fresh-instance
            // bootstrap and they get promoted to admin.
            if (totalUserCount === 1) {
              await tx
                .update(schema.userTable)
                .set({ role: "admin" })
                .where(eq(schema.userTable.id, user.id));
            }
          });
        },
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (isLoginFormDisabled && isLocalSignInPath(ctx.path)) {
        throw new APIError("FORBIDDEN", {
          message:
            "Local sign-in is disabled. Please use a configured social or OIDC sign-in method.",
        });
      }

      // Block invite-member calls on cloud from anonymous users or to
      // disposable-email addresses. The 2026-05-28 incident saw ~14k phishing
      // invites sent from throwaway disposable-email signups; gating here
      // shuts that path off without affecting self-hosted instances.
      if (ctx.path === "/organization/invite-member" && isCloud()) {
        // `before` hooks don't auto-populate ctx.context.session; load it
        // explicitly. `disableRefresh` keeps this gate cheap — we only need
        // the user record, not a session refresh side-effect.
        const session = await getSessionFromCtx(ctx, {
          disableRefresh: true,
        }).catch(() => null);
        const sessionUser = session?.user as
          | { isAnonymous?: boolean | null }
          | undefined;
        if (sessionUser?.isAnonymous) {
          throw new APIError("FORBIDDEN", {
            message: "Guest accounts may not send workspace invitations.",
          });
        }
        const inviteeEmail = (ctx.body?.email as string | undefined) ?? "";
        if (inviteeEmail && isDisposableEmail(inviteeEmail)) {
          throw new APIError("BAD_REQUEST", {
            message:
              "Invitations to disposable-email addresses are not allowed.",
          });
        }
      }

      const isSignUpPath =
        ctx.path === "/sign-up/email" ||
        ctx.path.startsWith("/callback/") ||
        ctx.path.startsWith("/sign-in/social");

      if (!isSignUpPath) {
        return;
      }

      const userCountRows = await db
        .select({ value: count() })
        .from(schema.userTable);
      const existingUserCount = userCountRows[0]?.value ?? 0;
      const isInstanceAdminSetup = existingUserCount === 0;

      if (ctx.path === "/sign-up/email") {
        if (isPasswordRegistrationDisabled && !isInstanceAdminSetup) {
          throw new APIError("FORBIDDEN", {
            message:
              "Password registration is currently disabled. Please use a configured social or OIDC sign-in method.",
          });
        }

        // Cloud-only abuse gates on password signup. Self-hosted instances
        // leave NURAVIEW_CLOUD/TURNSTILE_SECRET_KEY unset and skip both.
        if (isCloud() && !isInstanceAdminSetup) {
          const signupEmail = (ctx.body?.email as string | undefined) ?? "";
          if (signupEmail && isDisposableEmail(signupEmail)) {
            throw new APIError("BAD_REQUEST", {
              message:
                "Sign-up with disposable email addresses is not allowed.",
            });
          }

          const turnstileToken =
            (ctx.body?.turnstileToken as string | undefined) ??
            ctx.headers?.get("x-turnstile-token") ??
            null;
          const remoteIp =
            ctx.headers?.get("cf-connecting-ip") ??
            ctx.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            null;
          const verdict = await verifyTurnstile(turnstileToken, remoteIp);
          if (!verdict.ok) {
            throw new APIError("FORBIDDEN", { message: verdict.reason });
          }
        }
      }

      if (!isRegistrationDisabled || isInstanceAdminSetup) {
        return;
      }

      const email =
        ctx.body?.email ||
        ctx.query?.email ||
        ctx.headers?.get("x-invitation-email");
      const invitationId = normalizeInvitationId(
        ctx.body?.invitationId ||
          ctx.query?.invitationId ||
          ctx.headers?.get("x-invitation-id"),
      );

      if (ctx.path === "/sign-up/email") {
        const result = await checkRegistrationAllowed(email, invitationId);
        if (!result.allowed) {
          throw new APIError("FORBIDDEN", {
            message: result.reason,
          });
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      /*
       * Clear the forced-rotation flag once the holder has actually chosen a
       * password. Done here rather than in the SPA so the flag cannot be
       * dropped by a client that simply stops asking — the only way it clears
       * is a change-password call that better-auth itself accepted.
       */
      if (ctx.path === "/change-password") {
        const userId = ctx.context.session?.user?.id ?? ctx.context.newSession?.user?.id;
        if (userId) {
          await db
            .update(schema.userTable)
            .set({ mustChangePassword: false })
            .where(eq(schema.userTable.id, userId));
        }
      }

      if (ctx.path.startsWith("/sign-up") || ctx.path.startsWith("/sign-in")) {
        const newSession = ctx.context.newSession;
        if (newSession) {
          const workspaceMember = await db
            .select({ workspaceId: schema.workspaceUserTable.workspaceId })
            .from(schema.workspaceUserTable)
            .where(eq(schema.workspaceUserTable.userId, newSession.user.id))
            .limit(1);

          const activeWorkspaceId = workspaceMember[0]?.workspaceId || null;

          if (activeWorkspaceId) {
            await db
              .update(schema.sessionTable)
              .set({ activeOrganizationId: activeWorkspaceId })
              .where(eq(schema.sessionTable.id, newSession.session.id));
          }
        }
      }
    }),
  },
  advanced: {
    defaultCookieAttributes: {
      // For cross-subdomain auth with HTTPS, use sameSite: "none" with secure: true
      // For same-domain or HTTP deployments, use sameSite: "lax" with secure: false
      sameSite: isCrossSubdomain && isHttps ? "none" : "lax",
      secure: isCrossSubdomain && isHttps, // must be true when sameSite is "none"
      partitioned: isCrossSubdomain && isHttps,
      domain: process.env.COOKIE_DOMAIN || undefined, // Optional: e.g., ".andrej.com" for explicit cross-subdomain cookies
    },
  },
});
