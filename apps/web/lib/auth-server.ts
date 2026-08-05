// Back-compat shim. The 100+ server-side call sites import `getSession` from
// here — keep the export name so nothing else needs to change. Implementation
// now lives in `lib/auth/session.ts`.
export { getSession } from "./auth/session";
export type { SessionData, SessionUser } from "./auth/session";
