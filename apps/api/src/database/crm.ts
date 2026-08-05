/**
 * Second Drizzle client, pointed at the NuraView CRM database.
 *
 * The PM tables (projects, tasks, comments) live in DATABASE_URL. The CRM
 * tables — 50k+ leads, enrichment, dialer, marketing — live in their own
 * database that the legacy Next app still serves from. Keeping two connections
 * rather than merging schemas means the CRM domains can be ported one at a
 * time, against real production data, without any migration having to land
 * first.
 *
 * Set CRM_DATABASE_URL. In development that is usually an SSH tunnel:
 *   ssh -f -N -L 15433:127.0.0.1:5433 root@<vps>
 *
 * If it is unset the API still boots — the CRM routes then return 503 rather
 * than taking the whole PM app down with them.
 */
import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { crmSchema } from "./crm-schema";

type CrmDatabase = NodePgDatabase<typeof crmSchema>;

let crmPool: Pool | undefined;
let crmDbInstance: CrmDatabase | undefined;

export function isCrmConfigured(): boolean {
  return Boolean(process.env.CRM_DATABASE_URL);
}

export function getCrmPool(): Pool {
  const connectionString = process.env.CRM_DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "CRM_DATABASE_URL is not set — the CRM domains (leads, enrichment, " +
        "dialer) cannot be served. See apps/api/.env.example.",
    );
  }

  if (!crmPool) {
    crmPool = new Pool({
      connectionString,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      // Deliberately small: this pool points at the database the production
      // Next app is also serving from, and must not compete with it.
      max: 5,
    });
  }

  return crmPool;
}

export function getCrmDatabase(): CrmDatabase {
  if (!crmDbInstance) {
    // The workspace currently resolves TWO copies of pg: 8.22.0 hoisted (this
    // app declares ^8.22.0) and 8.18.0 nested under drizzle-orm (apps/web
    // declares ^8.18.0). Their Pool types are structurally incompatible even
    // though the runtime behaviour is identical, so drizzle() rejects the Pool
    // on types alone. Verified working against production at runtime.
    //
    // The real fix is a single pg version, which happens for free when
    // apps/web is retired — ^8.18.0 already admits 8.22.0. Deliberately not
    // regenerating the lockfile to force it now: that re-resolved 715 packages
    // last time, and this app is not worth that risk.
    crmDbInstance = drizzle(getCrmPool() as never, { schema: crmSchema });
  }

  return crmDbInstance;
}

const crmDb = new Proxy({} as CrmDatabase, {
  get(_target, property, receiver) {
    const value = Reflect.get(getCrmDatabase(), property, receiver);
    return typeof value === "function" ? value.bind(getCrmDatabase()) : value;
  },
});

export default crmDb;
