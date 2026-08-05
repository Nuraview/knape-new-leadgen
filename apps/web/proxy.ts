import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { jwtVerify } from "jose";

// jose works at the Edge; bcrypt does not — we only verify the JWT here,
// we don't touch passwords in middleware.
// Lazy — reuse whatever value is in env per-request so a missing secret during
// build doesn't explode. In production NODE_ENV the verify call will fail
// safely (returns null session → redirect to /sign-in).
let _key: Uint8Array | null = null;
function getKey(): Uint8Array {
  if (_key) return _key;
  const secret = process.env.AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET;
  _key = new TextEncoder().encode(secret ?? "dev-only-insecure-fallback");
  return _key;
}

const PUBLIC_PATHS = ["/sign-in"];

// Paths that bypass middleware entirely. These routes do their own auth
// (Bearer tokens on /api/ingest and /api/cron, session login on /api/auth,
// Resend/Svix signatures on the webhook endpoints). Webhooks come from
// external senders with no session cookie, so they must skip the session gate.
function isPassthrough(path: string) {
  return (
    path.startsWith("/api/auth") ||
    // Container HEALTHCHECK and the deploy health gate call this with no
    // session; it only reports liveness + a `select 1`.
    path === "/api/health" ||
    path.startsWith("/api/ingest") ||
    path.startsWith("/api/cron") ||
    path.startsWith("/api/inngest") ||
    path.startsWith("/api/webhooks") ||
    path.startsWith("/api/marketing/webhooks") ||
    // Tracking pixels/links are hit by recipients' email clients with no
    // session cookie, so they must skip the gate.
    path.startsWith("/api/marketing/track") ||
    path.startsWith("/api/campaigns/webhooks") ||
    // Public client-facing proposal: the viewer page and its token-gated API
    // (view/approve/reject/asset) are opened by clients with no CRM session —
    // each validates the proposal shareToken itself. The authenticated owner
    // upload route (/api/proposals/upload-url) is NOT here, so it stays gated.
    path === "/proposal" ||
    path.startsWith("/proposal/") ||
    path.startsWith("/api/proposals/public") ||
    // Twilio voice/SMS webhooks — no session cookie; every route validates
    // X-Twilio-Signature itself (see lib/dialer/twilio-webhook.ts).
    path.startsWith("/api/twilio") ||
    // Legacy webhook paths the TwiML App may still reference; next.config.js
    // rewrites them to /api/twilio/*, but middleware runs first.
    path === "/api/voice" ||
    path === "/api/voice-fallback" ||
    path === "/api/call-status" ||
    path === "/api/sms-webhook" ||
    path.startsWith("/_next") ||
    path.startsWith("/_vercel") ||
    path === "/favicon.ico" ||
    path === "/opengraph-image.png" ||
    /\.[a-zA-Z0-9]+$/.test(path.split("/").pop() ?? "")
  );
}

async function verify(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getKey(), { algorithms: ["HS256"] });
    return payload as { user?: { id: string; email: string; role: string } };
  } catch {
    return null;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPassthrough(pathname)) return NextResponse.next();

  const token = req.cookies.get("session")?.value;
  const session = await verify(token);

  // Public auth pages: if already signed in, bounce to home.
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    if (session?.user) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // API routes: return JSON 401 instead of HTML redirect.
  if (pathname.startsWith("/api")) {
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Everything else: require a session.
  if (!session?.user) {
    const url = new URL("/sign-in", req.url);
    if (pathname !== "/") {
      url.searchParams.set("returnUrl", pathname);
    }
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
