// Cleans the CRM's stale "0/3 overdue" rows: marks the MIGRATED active
// sequences (owned by the old nvMarketter app, all items id <= 870) as
// cancelled, so they leave the Active Follow-ups view. Leaves the CRM's own
// sequences (any item id >= 871) untouched so their steps 2/3 still fire.
// NO emails are sent. Idempotent.
//   cd apps/web && bun run scripts/cleanup-migrated-followups.ts

import { Pool } from "pg";

async function main() {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL_UNPOOLED!,
    ssl: { rejectUnauthorized: false },
  });
  const client = await p.connect();
  try {
    await client.query("BEGIN");

    // Migrated active sequences = active sequences whose newest item id <= 870.
    const seq = await client.query(
      `UPDATE mkt_sequences SET status='cancelled', updated_at=now()
       WHERE status='active'
         AND id IN (
           SELECT sequence_id FROM mkt_sequence_items
           GROUP BY sequence_id HAVING max(id) <= 870)
       RETURNING id`,
    );

    // Their still-pending items.
    const items = await client.query(
      `UPDATE mkt_sequence_items SET status='cancelled', updated_at=now()
       WHERE status IN ('scheduled','pending') AND id <= 870
         AND sequence_id = ANY($1::int[])`,
      [seq.rows.map((r) => r.id)],
    );

    await client.query("COMMIT");
    console.log(`Cancelled ${seq.rowCount} migrated sequences, ${items.rowCount} pending items.`);

    const left = await client.query(
      `SELECT count(*) FROM mkt_sequences WHERE status='active'`,
    );
    console.log(`CRM active sequences remaining (the real CRM-owned ones): ${left.rows[0].count}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await p.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
