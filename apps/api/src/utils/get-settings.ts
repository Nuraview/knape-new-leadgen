import { config } from "dotenv-mono";
import { getBrand } from "./get-brand";
import { isGithubSsoConfigured } from "./github-sso-env";

config();

function getSettings() {
  return {
    // Instance identity. Defaults to NuraView's own values, so an instance with
    // no BRAND_* env set is unchanged. See get-brand.ts.
    brand: getBrand(),
    disableRegistration: process.env.DISABLE_REGISTRATION === "true",
    disablePasswordRegistration:
      process.env.DISABLE_PASSWORD_REGISTRATION === "true",
    disableEmailOtpSignIn: process.env.DISABLE_EMAIL_OTP_SIGN_IN === "true",
    isDemoMode: process.env.DEMO_MODE === "true",
    hasSmtp:
      Boolean(process.env.SMTP_HOST) &&
      Boolean(process.env.SMTP_PORT) &&
      Boolean(process.env.SMTP_SECURE) &&
      Boolean(process.env.SMTP_USER) &&
      Boolean(process.env.SMTP_PASSWORD),
    hasGithubSignIn: isGithubSsoConfigured(),
    hasGoogleSignIn:
      Boolean(process.env.GOOGLE_CLIENT_ID) &&
      Boolean(process.env.GOOGLE_CLIENT_SECRET),
    hasDiscordSignIn:
      Boolean(process.env.DISCORD_CLIENT_ID) &&
      Boolean(process.env.DISCORD_CLIENT_SECRET),
    hasCustomOAuth:
      Boolean(process.env.CUSTOM_OAUTH_CLIENT_ID) &&
      Boolean(process.env.CUSTOM_OAUTH_CLIENT_SECRET),
    // Guest access is gone: the anonymous() plugin was removed from auth.ts
    // because it minted real user rows without an invitation on an instance
    // whose whole point is that registration is closed. Reported as false so no
    // client offers a button whose endpoint no longer exists.
    hasGuestAccess: false,
    disableLoginForm: process.env.DISABLE_LOGIN_FORM === "true",
    customOAuthAutoLogin: process.env.CUSTOM_OAUTH_AUTO_LOGIN === "true",
    customOAuthLogoutUrl: process.env.CUSTOM_OAUTH_LOGOUT_URL || null,

    /*
     * Web Push. The PUBLIC key is public by definition — it ships to every
     * browser that subscribes — so serving it here is safe.
     *
     * Served at RUNTIME rather than baked in as VITE_VAPID_PUBLIC_KEY on
     * purpose. A build-time variable is exactly what broke the Projects page:
     * VITE_API_URL was a Docker build ARG, the SPA build moved out of Docker,
     * and the value silently vanished. Rotating this key or enabling push now
     * needs an API restart, not a rebuild and redeploy of the bundle.
     */
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,

    /*
     * Whether this instance has a lead-gen cockpit behind /api/leadgen.
     *
     * A client pipeline lives in a Python service on the VPS; NuraView's
     * lives in crm_Leads and has no cockpit at all. The Leads page renders a
     * different set of tabs depending on which, and it must not decide that by
     * firing a request and seeing whether it 503s — a spinner that resolves
     * into "this feature does not exist" is worse than never offering it.
     *
     * A base URL alone is not enough: it authenticates nothing, every proxied
     * call would 503, and reporting true would put six tabs on screen that
     * cannot load. So a base URL AND a way to authenticate are both required.
     *
     * There are two ways to authenticate, and this used to check only the one
     * the proxy no longer uses. src/leadgen/index.ts signs in with
     * LEADGEN_API_EMAIL / LEADGEN_API_PASSWORD (loginToCockpit) and caches the
     * bearer it gets back; LEADGEN_API_TOKEN is now read NOWHERE else in the
     * codebase. An instance configured the supported way therefore left it
     * empty, reported hasLeadgen:false, and the SPA fell back to NuraView's own
     * nav — Leads pointing at crm_Leads, which on a cockpit instance is a table
     * that does not exist. The cockpit was answering 200 the whole time.
     *
     * Either credential shape counts, because either one gets the proxy a token.
     */
    hasLeadgen: Boolean(
      process.env.LEADGEN_API_BASE?.trim() &&
        (process.env.LEADGEN_API_TOKEN?.trim() ||
          (process.env.LEADGEN_API_EMAIL?.trim() &&
            process.env.LEADGEN_API_PASSWORD?.trim())),
    ),

    /*
     * Whether this instance can place or receive calls.
     *
     * Same reasoning as hasLeadgen, and the same mistake it was written to
     * avoid: the dialer provider fired POST /api/dialer/token on EVERY page
     * load, and an instance without Twilio credentials answered 503 every time.
     * Swallowing that response silences the toast but still paints a failed
     * request in the console on every navigation, which reads as a broken app.
     *
     * All four are required because the access token cannot be minted without
     * them — reporting true on a partial set would just move the 503 later.
     */
    /*
     * The project this instance shares with another deployment, if any.
     *
     * Served so the client can tell "a project" from "somebody else's project".
     * Dan owns his own workspace, so every is-admin check in the UI says yes —
     * and the project access panel then asked crmx1 to list the members of
     * NuraView's project, which the service account is rightly not allowed to
     * manage. A 403 per board render, for a panel that should not have been
     * offered.
     */
    sharedProjectId: process.env.NV_PROJECTS_PROJECT_ID?.trim() || null,

    hasDialer: Boolean(
      process.env.TWILIO_ACCOUNT_SID?.trim() &&
        process.env.TWILIO_API_KEY?.trim() &&
        process.env.TWILIO_API_SECRET?.trim() &&
        process.env.TWIML_APP_SID?.trim(),
    ),

    /*
     * How the client should receive live updates.
     *
     * The VPS container holds a WebSocket per open tab and fans events out over
     * Redis. A Vercel Function cannot: it exists for the duration of one
     * request, so a socket opened inside it dies with the response. The client
     * would connect, fail, retry five times and then go permanently silent —
     * notifications and board updates simply stop arriving, with nothing on
     * screen to say so.
     *
     * Decided here rather than sniffed in the browser, because only the server
     * knows what it is running on. Auto-detected from Vercel's own env var so a
     * new deployment cannot forget to set it; REALTIME_TRANSPORT overrides for
     * the cases auto-detection cannot see (a WS-terminating proxy in front, or
     * forcing polling to reproduce a bug).
     */
    realtimeTransport: (process.env.REALTIME_TRANSPORT === "poll" ||
    process.env.REALTIME_TRANSPORT === "websocket"
      ? process.env.REALTIME_TRANSPORT
      : process.env.VERCEL
        ? "poll"
        : "websocket") as "websocket" | "poll",
  };
}

export default getSettings;
