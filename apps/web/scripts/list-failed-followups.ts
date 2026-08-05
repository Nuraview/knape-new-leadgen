// READ-ONLY. Lists exactly who the 16 failed follow-ups would go to, so the
// recipients can be reviewed before any send. No emails, no DB writes.
//   cd apps/web && bun run scripts/list-failed-followups.ts

import { Pool } from "pg";

const FAILED_ITEM_IDS = [
  872, 875, 878, 881, 884, 887, 890, 893, 896, 899, 902, 905, 908, 911, 914,
  917,
];

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL_UNPOOLED!,
    ssl: { rejectUnauthorized: false },
  });

  const { rows } = await pool.query(
    `SELECT i.id, i.contact_email, i.step_number AS step, i.status,
            s.status AS seq_status, left(coalesce(i.subject,''),48) AS subject
     FROM mkt_sequence_items i
     JOIN mkt_sequences s ON s.id = i.sequence_id
     WHERE i.id = ANY($1::int[])
     ORDER BY i.id`,
    [FAILED_ITEM_IDS],
  );

  console.log(`Found ${rows.length}/${FAILED_ITEM_IDS.length} items\n`);
  console.log("id    step status    seq      recipient");
  for (const r of rows) {
    console.log(
      `${String(r.id).padEnd(5)} ${String(r.step).padEnd(4)} ${String(
        r.status,
      ).padEnd(9)} ${String(r.seq_status).padEnd(8)} ${r.contact_email}  | ${r.subject}`,
    );
  }
  const sendable = rows.filter(
    (r) => r.status !== "sent" && r.seq_status === "active",
  ).length;
  console.log(`\nWould send: ${sendable} (rest skipped: already sent / inactive)`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
