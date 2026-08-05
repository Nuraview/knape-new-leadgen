/**
 * One-shot migration: copy every Vercel Blob asset into the self-hosted MinIO
 * bucket and rewrite the URLs stored in Postgres.
 *
 * Blob URLs live in a handful of columns (found by scanning every text/jsonb
 * column for "blob.vercel-storage.com"):
 *   crm_Proposals.pdfStorageKey, .signatureStorageKey, .sections (jsonb)
 *   crm_Proposal_Assets.storageKey
 * The scan runs again here rather than trusting that list — a column added
 * since would otherwise be silently skipped.
 *
 * Idempotent: an object already present in MinIO is not re-uploaded, and rows
 * whose URLs are already rewritten no longer match the scan.
 *
 * Usage (from apps/web, with a tunnel to the VPS Postgres + MinIO):
 *   DATABASE_URL=... MINIO_ENDPOINT=... MINIO_ACCESS_KEY=... MINIO_SECRET_KEY=... \
 *   MINIO_BUCKET=nuraview-crm NEXT_PUBLIC_FILES_URL=https://crmx1.nuraview.com/files \
 *   bun scripts/migrate-blob-to-minio.ts [--dry-run]
 */
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool } from "pg";

const DRY_RUN = process.argv.includes("--dry-run");

const BLOB_URL_RE =
  /https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/[^"'\s\\)]+/gi;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

const BUCKET = requireEnv("MINIO_BUCKET");
const FILES_BASE = requireEnv("NEXT_PUBLIC_FILES_URL").replace(/\/$/, "");

const s3 = new S3Client({
  endpoint: requireEnv("MINIO_ENDPOINT"),
  region: "us-east-1",
  credentials: {
    accessKeyId: requireEnv("MINIO_ACCESS_KEY"),
    secretAccessKey: requireEnv("MINIO_SECRET_KEY"),
  },
  forcePathStyle: true,
});

const pool = new Pool({ connectionString: requireEnv("DATABASE_URL") });

/** Blob path → the same key in our bucket, so URLs stay recognisable. */
function keyForBlobUrl(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

async function alreadyUploaded(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

const urlMap = new Map<string, string>();
let copied = 0;
let skipped = 0;
const failures: Array<{ url: string; reason: string }> = [];

async function migrateOne(blobUrl: string): Promise<string | null> {
  const cached = urlMap.get(blobUrl);
  if (cached) return cached;

  const key = keyForBlobUrl(blobUrl);
  const target = `${FILES_BASE}/${key}`;

  if (await alreadyUploaded(key)) {
    skipped++;
    urlMap.set(blobUrl, target);
    return target;
  }
  if (DRY_RUN) {
    urlMap.set(blobUrl, target);
    return target;
  }

  const res = await fetch(blobUrl);
  if (!res.ok) {
    failures.push({ url: blobUrl, reason: `download HTTP ${res.status}` });
    return null;
  }
  const body = Buffer.from(await res.arrayBuffer());
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: res.headers.get("content-type") ?? "application/octet-stream",
    }),
  );
  copied++;
  urlMap.set(blobUrl, target);
  return target;
}

type Target = { table: string; column: string; dataType: string };

async function columnsWithBlobUrls(): Promise<Target[]> {
  const { rows } = await pool.query<{
    table_name: string;
    column_name: string;
    data_type: string;
  }>(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND data_type IN ('text','character varying','jsonb','json')`,
  );
  const hits: Target[] = [];
  for (const r of rows) {
    const { rows: cnt } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${r.table_name}" WHERE "${r.column_name}"::text LIKE $1`,
      ["%blob.vercel-storage.com%"],
    );
    if (Number(cnt[0].n) > 0) {
      hits.push({ table: r.table_name, column: r.column_name, dataType: r.data_type });
    }
  }
  return hits;
}

/** Primary key column for a table (all of ours are single-column). */
async function primaryKey(table: string): Promise<string> {
  const { rows } = await pool.query<{ attname: string }>(
    `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary`,
    [`"${table}"`],
  );
  if (!rows[0]) throw new Error(`no primary key on ${table}`);
  return rows[0].attname;
}

async function main() {
  console.log(DRY_RUN ? "DRY RUN — nothing will be written\n" : "");
  const targets = await columnsWithBlobUrls();
  if (targets.length === 0) {
    console.log("No Vercel Blob URLs left in the database.");
    return;
  }

  let rowsUpdated = 0;
  for (const { table, column, dataType } of targets) {
    // jsonb columns must go back in as jsonb, not as a quoted string.
    const cast = dataType === "jsonb" || dataType === "json" ? `::${dataType}` : "";
    const pk = await primaryKey(table);
    const { rows } = await pool.query(
      `SELECT "${pk}" AS pk, "${column}"::text AS val
         FROM "${table}" WHERE "${column}"::text LIKE $1`,
      ["%blob.vercel-storage.com%"],
    );
    for (const row of rows) {
      const urls = Array.from(new Set((row.val as string).match(BLOB_URL_RE) ?? []));
      let next = row.val as string;
      let ok = true;
      for (const u of urls) {
        const replacement = await migrateOne(u);
        if (!replacement) {
          ok = false;
          continue;
        }
        next = next.split(u).join(replacement);
      }
      if (!ok) {
        console.warn(`  ! ${table}.${column} pk=${row.pk}: left as-is, some assets failed`);
        continue;
      }
      if (!DRY_RUN && next !== row.val) {
        await pool.query(
          `UPDATE "${table}" SET "${column}" = $1${cast} WHERE "${pk}" = $2`,
          [next, row.pk],
        );
      }
      rowsUpdated++;
    }
    console.log(`${table}.${column}: ${rows.length} row(s)`);
  }

  console.log(
    `\nobjects copied: ${copied}, already present: ${skipped}, rows rewritten: ${rowsUpdated}`,
  );
  if (failures.length) {
    console.log("\nFAILED:");
    for (const f of failures) console.log(`  ${f.url} — ${f.reason}`);
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
