// Back-compat shim for the ~20 call sites that do
//   auth.api.getSession({ headers: await headers() })
// (the canonical better-auth pattern). The `headers` arg is ignored; jose reads
// the cookie directly via next/headers. Returned shape is the same subset used
// across the codebase: `{ user: { id, email, name, role } }` or null.
import { getSession } from "./auth/session";

export const auth = {
  api: {
    async getSession(_opts?: { headers?: Headers }) {
      return getSession();
    },
  },
};

export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;
