// Full logical backup of the NV CRM database WITHOUT Docker / pg_dump.
//   bun run db:backup:pg
//
// Streams every table in the `public` schema in batches (ctid-ordered) and
// writes NDJSON — one JSON row per line — to backups/nvcrm_<ts>/<table>.ndjson,
// plus a backups/nvcrm_<ts>.json manifest with row counts. NDJSON keeps memory
// flat on huge tables. row_to_json round-trips jsonb/arrays/timestamps/bytea
// losslessly. Restore by reading the lines (JSON.parse each) and re-inserting;
// schema DDL lives in git (drizzle/*.ts).
//
// Reads DATABASE_URL_UNPOOLED (fallback DATABASE_URL) from .env / .env.local.
import { readFileSync, existsSync, mkdirSync, writeFileSync, createWriteStream } from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.resolve(import.meta.dirname, "..");
const BATCH = 2000;

function readEnv(name) {
  for (const f of [".env", ".env.local"]) {
    const p = path.join(root, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(new RegExp(`^${name}=(.*)$`));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
}

const url = readEnv("DATABASE_URL_UNPOOLED") || readEnv("DATABASE_URL");
if (!url) {
  console.error("No DATABASE_URL(_UNPOOLED) found in .env / .env.local");
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, "0");
const dt = new Date();
const ts = `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}_${pad(dt.getHours())}${pad(dt.getMinutes())}${pad(dt.getSeconds())}`;
const outDir = path.join(root, "backups", `nvcrm_${ts}`);
mkdirSync(outDir, { recursive: true });

const client = new pg.Client({ connectionString: url });

const dumpTable = async (table) => {
  const { rows: cnt } = await client.query(`select count(*)::int as n from "${table}"`);
  const total = cnt[0].n;
  const stream = createWriteStream(path.join(outDir, `${table}.ndjson`));
  for (let off = 0; off < total; off += BATCH) {
    const { rows } = await client.query(
      `select row_to_json(t) as r from "${table}" t order by t.ctid limit ${BATCH} offset ${off}`,
    );
    for (const row of rows) {
      if (!stream.write(JSON.stringify(row.r) + "\n")) {
        await new Promise((res) => stream.once("drain", res));
      }
    }
  }
  await new Promise((res) => stream.end(res));
  return total;
};

const main = async () => {
  await client.connect();
  const { rows: tables } = await client.query(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  );
  console.log(`Backing up ${tables.length} tables -> ${path.relative(root, outDir)}`);

  const manifest = { createdAt: dt.toISOString(), database: url.replace(/:[^:@/]+@/, ":***@"), tables: {} };
  let grand = 0;
  for (const { tablename } of tables) {
    const n = await dumpTable(tablename);
    manifest.tables[tablename] = n;
    grand += n;
    console.log(`  ${tablename.padEnd(40)} ${n} rows`);
  }
  manifest.totalRows = grand;
  writeFileSync(path.join(root, "backups", `nvcrm_${ts}.json`), JSON.stringify(manifest, null, 2));
  await client.end();
  console.log(`\nDone. ${tables.length} tables, ${grand} rows total.`);
  console.log(`Manifest: backups/nvcrm_${ts}.json   Data: backups/nvcrm_${ts}/`);
};

main().catch(async (e) => {
  console.error("Backup FAILED:", e.message);
  try { await client.end(); } catch {}
  process.exit(1);
});
