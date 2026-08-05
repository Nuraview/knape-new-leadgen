/**
 * One-shot data migration: standalone dialer Neon DB → CRM Neon DB.
 *
 *   bun run scripts/migrate-dialer.ts            # run from apps/web
 *
 * Reads OLD_DIALER_DATABASE_URL (source) and DATABASE_URL_UNPOOLED /
 * DATABASE_URL (target) from env or .env. Idempotent: unique keys
 * (call_sid, message_sid) use ON CONFLICT DO NOTHING; contacts dedupe
 * against crm_Leads by last-10-digit phone match before inserting.
 *
 * Order: templates → contacts→leads → calls → sms_messages.
 * client_sessions / push_subscriptions are intentionally NOT migrated
 * (stale presence; push endpoints are origin-bound to the old domain).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Pool } from "pg";

const fileEnv: Record<string, string> = {};
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) fileEnv[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const env = (key: string) => process.env[key] || fileEnv[key];

const sourceUrl = env("OLD_DIALER_DATABASE_URL");
const targetUrl = env("DATABASE_URL_UNPOOLED") || env("DATABASE_URL");
if (!sourceUrl || !targetUrl) {
  console.error("Need OLD_DIALER_DATABASE_URL and DATABASE_URL(_UNPOOLED)");
  process.exit(1);
}

const source = new Pool({ connectionString: sourceUrl });
const target = new Pool({ connectionString: targetUrl });

const digits = (phone: string | null) => (phone ?? "").replace(/\D/g, "");
const suffix10 = (phone: string | null) => {
  const d = digits(phone);
  return d.length >= 10 ? d.slice(-10) : d;
};

async function main() {
  // ── 1. Templates ─────────────────────────────────────────
  const { rows: oldTemplates } = await source.query(
    `SELECT * FROM message_templates ORDER BY id`,
  );
  const templateIdMap = new Map<number, number>();
  for (const t of oldTemplates) {
    const existing = await target.query(
      `SELECT id FROM dialer_message_templates WHERE name = $1 AND message_type = $2::dialer_message_type LIMIT 1`,
      [t.name, t.message_type],
    );
    if (existing.rows.length) {
      templateIdMap.set(t.id, existing.rows[0].id);
      continue;
    }
    const inserted = await target.query(
      `INSERT INTO dialer_message_templates (name, message_body, message_type, is_active, created_at, updated_at)
       VALUES ($1, $2, $3::dialer_message_type, $4, $5, $6) RETURNING id`,
      [t.name, t.message_body, t.message_type, t.is_active, t.created_at, t.updated_at],
    );
    templateIdMap.set(t.id, inserted.rows[0].id);
  }
  console.log(`✓ templates: ${oldTemplates.length} processed`);

  // ── 2. Contacts → crm_Leads ──────────────────────────────
  const { rows: oldContacts } = await source.query(`SELECT * FROM contacts ORDER BY id`);
  const contactToLead = new Map<number, string>();
  let reused = 0;
  let created = 0;
  for (const c of oldContacts) {
    const sfx = suffix10(c.phone);
    let leadId: string | null = null;
    if (sfx) {
      const match = await target.query(
        `SELECT id FROM "crm_Leads"
         WHERE regexp_replace(coalesce(phone, ''), '\\D', '', 'g') LIKE $1
            OR regexp_replace(coalesce(phone_secondary, ''), '\\D', '', 'g') LIKE $1
         ORDER BY "createdAt" DESC NULLS LAST LIMIT 1`,
        ["%" + sfx],
      );
      leadId = match.rows[0]?.id ?? null;
    }
    if (leadId) {
      reused++;
    } else {
      leadId = randomUUID();
      // lastName is NOT NULL on crm_Leads — fall back to the phone number.
      await target.query(
        `INSERT INTO "crm_Leads" (id, "lastName", phone, email, description, campaign, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'dialer-import', $6, $7)`,
        [
          leadId,
          c.name || c.phone,
          c.phone,
          c.email,
          c.requirement_tag ? `Dialer: ${c.requirement_tag}` : null,
          c.created_at,
          c.updated_at,
        ],
      );
      created++;
    }
    contactToLead.set(c.id, leadId);
  }
  console.log(`✓ contacts: ${oldContacts.length} → leads (${reused} matched existing, ${created} created)`);

  // ── 3. Calls ─────────────────────────────────────────────
  const { rows: oldCalls } = await source.query(`SELECT * FROM calls ORDER BY id`);
  const callIdMap = new Map<number, number>();
  let callsInserted = 0;
  for (const call of oldCalls) {
    const inserted = await target.query(
      `INSERT INTO dialer_calls (lead_id, phone_number, call_sid, status, direction, duration, agent_identity, created_at, updated_at)
       VALUES ($1, $2, $3, $4::dialer_call_status, $5::dialer_call_direction, $6, 'dialer-agent', $7, $8)
       ON CONFLICT (call_sid) DO NOTHING RETURNING id`,
      [
        call.contact_id ? contactToLead.get(call.contact_id) ?? null : null,
        call.phone_number,
        call.call_sid,
        call.status,
        call.direction,
        call.duration,
        call.created_at,
        call.updated_at,
      ],
    );
    if (inserted.rows.length) {
      callIdMap.set(call.id, inserted.rows[0].id);
      callsInserted++;
    } else {
      const existing = await target.query(
        `SELECT id FROM dialer_calls WHERE call_sid = $1`,
        [call.call_sid],
      );
      if (existing.rows.length) callIdMap.set(call.id, existing.rows[0].id);
    }
  }
  console.log(`✓ calls: ${oldCalls.length} processed (${callsInserted} inserted)`);

  // ── 4. SMS messages ──────────────────────────────────────
  const { rows: oldMessages } = await source.query(`SELECT * FROM sms_messages ORDER BY id`);
  let smsInserted = 0;
  for (const m of oldMessages) {
    const result = await target.query(
      `INSERT INTO dialer_sms_messages
         (lead_id, phone_number, message_sid, message_body, message_status, direction, message_type, call_id, template_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::dialer_message_direction, $7::dialer_message_type, $8, $9, $10, $11)
       ON CONFLICT (message_sid) DO NOTHING`,
      [
        m.contact_id ? contactToLead.get(m.contact_id) ?? null : null,
        m.phone_number,
        m.message_sid,
        m.message_body,
        m.message_status,
        m.direction,
        m.message_type,
        m.call_id ? callIdMap.get(m.call_id) ?? null : null,
        m.template_id ? templateIdMap.get(m.template_id) ?? null : null,
        m.created_at,
        m.updated_at,
      ],
    );
    if (result.rowCount) smsInserted++;
  }
  console.log(`✓ sms_messages: ${oldMessages.length} processed (${smsInserted} inserted)`);

  // ── Verify ───────────────────────────────────────────────
  const counts = await target.query(`
    SELECT
      (SELECT count(*) FROM dialer_calls) AS calls,
      (SELECT count(*) FROM dialer_sms_messages) AS sms,
      (SELECT count(*) FROM dialer_message_templates) AS templates,
      (SELECT count(*) FROM "crm_Leads" WHERE campaign = 'dialer-import') AS imported_leads
  `);
  console.log("Target counts:", counts.rows[0]);
}

main()
  .catch((e) => {
    console.error("MIGRATION FAILED:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await source.end();
    await target.end();
  });
