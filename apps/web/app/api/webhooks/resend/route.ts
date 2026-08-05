// Resend (via Svix) is configured to POST delivery/open/click/bounce events to
// /api/webhooks/resend. The actual handler lives under the marketing module
// (Drizzle, updates mktEmails). Re-export its POST here so the externally-
// configured URL works without duplicating logic. Keep in sync if the
// canonical handler moves. (runtime/dynamic must be declared literally —
// Next.js can't statically parse re-exported route segment config.)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export { POST } from "@/app/api/marketing/webhooks/resend/route";
