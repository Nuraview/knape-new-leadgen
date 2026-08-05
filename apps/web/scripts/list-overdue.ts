import { Pool } from "pg";
const p = new Pool({ connectionString: process.env.DATABASE_URL_UNPOOLED!, ssl:{rejectUnauthorized:false} });
const { rows } = await p.query(`
  SELECT i.id, i.contact_email, i.step_number step, i.status, s.status seq,
         to_char(i.scheduled_at,'MM-DD HH24:MI') sched, left(coalesce(i.subject,''),40) subj
  FROM mkt_sequence_items i JOIN mkt_sequences s ON s.id=i.sequence_id
  WHERE s.status='active' AND i.status='scheduled' AND i.scheduled_at <= now() AND i.id>=871
  ORDER BY i.contact_email, i.step_number`);
console.log(`overdue sendable items: ${rows.length}\n`);
for (const r of rows) console.log(`#${String(r.id).padEnd(5)} step${r.step} ${String(r.contact_email).padEnd(36)} sched ${r.sched} | ${r.subj}`);
const emails=[...new Set(rows.map(r=>r.contact_email))];
console.log(`\nunique recipients: ${emails.length}`);
await p.end();
