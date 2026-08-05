import type { Config } from "drizzle-kit";

import { env } from "./lib/db/env";

// Drizzle CLI (generate/push/migrate/pull/studio) uses this config.
// We point it at the unpooled Neon URL — migrations and introspection want
// direct connections, not the pgbouncer pool.
export default {
  // ALL schema modules — drizzle-kit must see every table, or it treats the
  // unlisted ones (mkt_*, dialer_*) as orphans in the DB and DROPs them.
  schema: [
    "./drizzle/schema.ts",
    "./drizzle/marketing-schema.ts",
    "./drizzle/dialer-schema.ts",
  ],
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL_UNPOOLED,
  },
  verbose: true,
  strict: true,
} satisfies Config;
