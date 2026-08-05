/**
 * Serverless entrypoint for the Hono API.
 *
 * Follows Vercel's Hono guide (vercel.com/docs/frameworks/backend/hono): a
 * single `api/index.ts` that default-exports the Hono app, with a rewrite in
 * vercel.json funnelling every /api/* path into it. Vercel detects the app's
 * `fetch` property and drives it with a Web Request, so there is no adapter in
 * the way.
 *
 * Two earlier shapes failed, both worth not repeating:
 *
 *   1. `export default handle(app)` from hono/vercel. A default-exported plain
 *      FUNCTION is read as the legacy `(req, res) => void` signature, so Hono
 *      received an IncomingMessage and threw on the first header read —
 *      "TypeError: this.raw.headers.get is not a function" inside cors.
 *
 *   2. `api/[[...route]].ts`, then `api/[...route].ts`. Filesystem catch-alls
 *      in a bare `api/` directory did not match nested paths here: /api/health
 *      and /api/config resolved while /api/auth/get-session, /api/me/access
 *      and /api/instance/status all 404'd. The app rendered but nobody could
 *      sign in. Routing is an explicit rewrite now, so path depth is
 *      irrelevant.
 *
 * A client instance serves the SPA and the API from ONE Vercel project, so the
 * browser only ever talks to one origin. Not cosmetic: better-auth sets a
 * session cookie, and splitting them across hostnames would drag in CORS
 * credentials, SameSite=None and a COOKIE_DOMAIN — all ways to get logged out
 * in Safari.
 *
 * The API module is imported for its default export only. `createApp()` builds
 * the Hono tree with no side effects, and `startServer()` — migrations, the
 * croner scheduler, the WebSocket upgrade — sits behind an `isMainModule`
 * guard in apps/api/src/index.ts, so none of it runs here. That guard is what
 * lets one file serve both the VPS container and this function.
 *
 * What is deliberately NOT available here, and where it went:
 *   WebSockets  A function cannot hold a socket. The SPA polls instead; the
 *               server advertises which via config.realtimeTransport.
 *   Cron        Needs a process that outlives the request. Driven from the VPS
 *               crontab — see deploy/cron/.
 *   Migrations  Run once per release via `bun run --filter @nuraview/api
 *               db:deploy`, never per request.
 */
import app from "@nuraview/api";

export default app;
