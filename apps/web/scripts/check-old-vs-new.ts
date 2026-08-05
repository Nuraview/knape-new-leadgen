// READ-ONLY reconciliation: is the OLD nvMarketter app still actively sending
// the in-flight sequences, and how does its truth compare to the CRM's stale
// (migrated) copy? No writes, no emails.
//   cd apps/web && bun run scripts/check-old-vs-new.ts

import { Pool } from "pg";

const OLD = process.env.OLD_DATABASE_URL!; // nvMarketter source
const NEW = process.env.DATABASE_URL_UNPOOLED!; // CRM target

async function main() {
  const old = new Pool({ connectionString: OLD, ssl: { rejectUnauthorized: false } });
  const neu = new Pool({ connectionString: NEW, ssl: { rejectUnauthorized: false } });

  console.log("=== OLD nvMarketter: is it still sending? ===");
  const recency = await old.query(
    `SELECT count(*) FILTER (WHERE status='sent') sent,
            count(*) FILTER (WHERE status IN ('scheduled','pending')) pending,
            max(sent_at) AS last_sent_at, now() AS now
     FROM sequence_items
     WHERE sequence_id IN (SELECT id FROM sequences WHERE status='active')`,
  );
  console.log(recency.rows[0]);

  console.log("\n=== OLD: 8 most recent sends (recency => old app alive) ===");
  const recent = await old.query(
    `SELECT contact_email, step_number, sent_at
     FROM sequence_items WHERE status='sent' ORDER BY sent_at DESC NULLS LAST LIMIT 8`,
  );
  for (const r of recent.rows)
    console.log(`  ${r.sent_at} step${r.step_number} ${r.contact_email}`);

  console.log("\n=== Divergence: same emails, OLD sent-count vs CRM sent-count ===");
  const cmp = await neu.query(
    `SELECT s.id, max(i.contact_email) email,
            sum((i.status='sent')::int) crm_sent, count(*) steps, max(s.status) seq
     FROM mkt_sequences s JOIN mkt_sequence_items i ON i.sequence_id=s.id
     WHERE s.status='active'
     GROUP BY s.id ORDER BY s.id LIMIT 8`,
  );
  for (const r of cmp.rows) {
    const o = await old.query(
      `SELECT sum((i.status='sent')::int) old_sent
       FROM sequence_items i WHERE i.contact_email=$1
         AND i.sequence_id IN (SELECT id FROM sequences WHERE status='active')`,
      [r.email],
    );
    console.log(
      `  ${String(r.email).padEnd(34)} CRM ${r.crm_sent}/${r.steps}  |  OLD ${o.rows[0].old_sent ?? "-"} sent`,
    );
  }

  await old.end();
  await neu.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
