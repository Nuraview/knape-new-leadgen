import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { env } from "./env";
import * as schema from "./schema";

// Plain TCP Postgres (self-hosted on the VPS, same docker network). The former
// Neon WebSocket driver is gone with the Vercel/Neon migration — node-postgres
// talks to the local server directly, so no WS shim and no serverless pooler.

declare global {
  // eslint-disable-next-line no-var
  var __drizzlePool: Pool | undefined;
}

const pool =
  globalThis.__drizzlePool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10_000,
  });

// An idle client can still die (server restart, connection reaped by a proxy).
// Without a listener, pg re-emits that as an `error` event on the Pool, which
// EventEmitter turns into an uncaught throw and kills the whole process. Log it
// instead — the pool discards the dead client and the next query opens a fresh
// one.
pool.on("error", (err: unknown) => {
  const detail =
    err instanceof Error
      ? err.stack ?? err.message
      : ((err as { error?: unknown; reason?: unknown })?.error ??
        (err as { reason?: unknown })?.reason ??
        err);
  console.error("[db] idle pool client error:", detail);
});

if (env.NODE_ENV !== "production") {
  globalThis.__drizzlePool = pool;
}

export const db = drizzle(pool, { schema });
export { schema };
export type DB = typeof db;

// Re-export table/enum/relation symbols so app code can import them directly
// from "@/lib/db" (as the schema.ts header documents) instead of reaching into
// drizzle/. Includes the mkt* Marketer tables.
export * from "./schema";
