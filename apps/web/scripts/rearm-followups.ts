// Re-arms future follow-up steps by emitting `marketing/followup` events to the
// self-hosted Inngest server (which sleeps until scheduled_at then sends). Use
// after any incident where the delayed jobs were lost. Scope: active sequences,
// status='scheduled', scheduled_at>now. No emails sent here — Inngest fires them
// at their scheduled time.
//
//   INNGEST_EVENT_URL=http://185.245.182.175:8288/e/<EVENT_KEY> \
//   DATABASE_URL=postgres://... bun run scripts/rearm-followups.ts [minId] [maxId]
//
// INNGEST_EVENT_URL defaults to the local dev server. EVENT_KEY is whatever the
// self-hosted instance expects (INNGEST_EVENT_KEY on the VPS).

import { Pool } from "pg";

const EVENT_URL =
  process.env.INNGEST_EVENT_URL || "http://127.0.0.1:8288/e/local";
const MIN_ID = Number(process.argv[2] ?? 1);
const MAX_ID = Number(process.argv[3] ?? Number.MAX_SAFE_INTEGER);

async function main() {
  const p = new Pool({
    connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  });
  const { rows } = await p.query(
    `SELECT id, step_number, scheduled_at
     FROM mkt_sequence_items i
     WHERE i.status='scheduled' AND i.scheduled_at>now()
       AND i.id BETWEEN $1 AND $2
       AND i.sequence_id IN (SELECT id FROM mkt_sequences WHERE status='active')
     ORDER BY i.scheduled_at`,
    [MIN_ID, MAX_ID],
  );
  await p.end();

  let armed = 0;
  for (const it of rows) {
    const res = await fetch(EVENT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "marketing/followup",
        data: {
          step: it.step_number,
          sequenceItemId: it.id,
          scheduledAt: new Date(it.scheduled_at).toISOString(),
        },
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      armed++;
      console.log(`#${it.id} step${it.step_number} armed for ${it.scheduled_at} ids=${JSON.stringify(j.ids ?? j)}`);
    } else {
      console.log(`#${it.id} FAIL ${res.status} ${JSON.stringify(j).slice(0, 120)}`);
    }
  }
  console.log(`\nRe-armed ${armed}/${rows.length} via ${EVENT_URL}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
