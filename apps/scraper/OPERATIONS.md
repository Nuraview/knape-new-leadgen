# Nuraview System — Architecture & Operations

> **Private doc.** `afhm/nextcrm-app` is a PUBLIC OSS fork — never copy this
> content (VPS IP, infra, env names) into that repo's README or comments.
> `nuraview-scraper` and `nuraview-whatsapp` are private; this lives here.

Last updated: 2026-05-18.

---

## 1. Components

| Component | What | Where | Repo |
|---|---|---|---|
| **NuraviewCRM** | Next.js 16 CRM app | Vercel project `nv-crm` (team `alifsense`), https://nv-crm.vercel.app | `afhm/nextcrm-app` (**public** fork) |
| **Neon Postgres** | Primary database | Neon project `steep-firefly-56658731`, host `ep-weathered-frost-aomodlig` (ap-southeast-1), db `neondb` | — |
| **nuraview-scraper** | Upwork scraper (Python + Camoufox) + pusher | VPS Docker container `nuraview-scraper` @ `/root/nuraview-scraper` | `afhm/nuraview-scraper` (private) |
| **nuraview-whatsapp** | WhatsApp Web bridge (Node + Baileys) | VPS Docker container `nuraview-whatsapp` @ `/root/nuraview-whatsapp` | `afhm/nuraview-whatsapp` (private) |
| **VPS** | Docker host + cron | `185.245.182.175` (root) | — |

The CRM is the hub. Both VPS services talk to it **over HTTP only** (never
direct DB) — so the database the system uses is whatever the CRM's
`DATABASE_URL` points at.

---

## 2. Data flow

1. **Scrape** — `nuraview-scraper` (`pusher.py` rotates keywords →
   `upwork_scraper_service.py` scrapes Upwork) POSTs to the CRM:
   `/api/ingest/scraper-event`, `/api/ingest/upwork`,
   `/api/ingest/scraper-heartbeat`, cookies via `/api/ingest/scraper-cookies`.
2. **Persist** — CRM writes to Neon (`crm_Leads`, `scrape_runs`,
   `scraper_heartbeat`, …). Drizzle ORM; schema authority `drizzle/schema.ts`.
3. **Reminders** — VPS cron → `GET /api/cron/reminders` → inserts rows into
   the `whatsapp_outbox` table.
4. **WhatsApp out** — `nuraview-whatsapp` polls `/api/ingest/whatsapp-outbox`
   (adaptive backoff: ~5s while draining, backs off to 60s idle), sends via
   WhatsApp, POSTs `/api/ingest/whatsapp-outbox/result`. Heartbeat to
   `/api/ingest/whatsapp-heartbeat` ~30s; inbound → `/api/ingest/whatsapp-inbound`.
5. **Dashboard** — `/leads` polls `/api/scraper/health`,
   `/api/leads/scrape-status`, `/api/leads/stats` on **adaptive** intervals
   (fast only while a scrape is running; idle otherwise).

---

## 3. Deploy

| Target | How |
|---|---|
| **CRM** | `git push origin main` → Vercel auto-deploys. `vercel.json` ignoreCommand cancels all non-`main` builds (Preview never builds). |
| **scraper / whatsapp** | `git push origin main` → GitHub Actions `.github/workflows/deploy.yml` → rsync to `/root/<svc>/` → `docker compose up -d --build`. Manual fallback: `./deploy.sh` (needs a clean git tree). |

- **Rule: local git is the source of truth. Never edit `/root/<svc>/` on the
  VPS in place** — it has no history and is wiped on container rebuild.
- Verify VPS == local anytime: `~/alifsense/projects/check-vps-sync.sh`
  (checks working tree clean, in sync with origin, and VPS files == local).
- CI auth: keys `github-actions-deploy-nuraview-{scraper,whatsapp}` in VPS
  `/root/.ssh/authorized_keys`; private halves only in each repo's
  `VPS_SSH_KEY` GitHub secret (+ `VPS_HOST`). Revoke = delete that
  authorized_keys line. (CI silently failed 2026-04-29 → 2026-05-18; fixed.)

---

## 4. Database (Neon)

- Runtime uses **pooled** `DATABASE_URL`; migrations/long tx use
  **unpooled** `DATABASE_URL_UNPOOLED`. App reads these two only
  (`lib/db/env.ts`) — NOT the Neon-integration `nv_*`-prefixed Vercel vars.
- Set in Vercel for **Production + Development** (Preview N/A — never builds)
  and in local `.env`.
- **Migrated 2026-05-18** off the old project (`sparkling-dew-15355108` /
  `ep-solitary-art-ao2jkmbw`, now deleted) to the current one.
- Schema changes: edit `drizzle/schema.ts` → `drizzle-kit generate` →
  `drizzle-kit push`. Never raw SQL, never `pnpm db:push` against prod
  (introspection storms).

### Cost control (important)
Neon bills by compute-active-time and auto-suspends after idle. **Any
sub-5-minute poller or cron pins compute 24/7.** Keep dashboard SWR
adaptive, the reminder cron at `*/10`, and never reintroduce few-second
polling. The CRM also caches `/api/scraper/health` for 10s.

---

## 5. Cron

VPS crontab (NOT Vercel cron — Hobby plan can't do sub-daily Vercel cron and
sub-daily `vercel.json` crons silently break Hobby deploys):

```
*/10 * * * * /usr/local/bin/nuraview-reminder-cron.sh
```

Drives `GET /api/cron/reminders?secret=…` (secret at `/root/.crm-cron-secret`).

---

## 6. Backups

`pg_dump -Fc` run via a `postgres:17` Docker container on the VPS (no local
pg client needed):

- Latest: `nvcrm-OLD-20260518-054038Z.dump` — in `~/db-backups/` (local)
  **and** `/root/db-backups/` (VPS). This is the only pre-migration copy
  (old Neon endpoint is deleted). **Do not delete.**

---

## 7. Runbook

```bash
# CI deploy status
cd ~/alifsense/projects/<repo> && gh run list --workflow="Deploy to VPS" -L 5

# Is the VPS in sync with git?
~/alifsense/projects/check-vps-sync.sh                 # all services
~/alifsense/projects/check-vps-sync.sh nuraview-scraper

# Manual deploy (fallback to CI)
cd ~/alifsense/projects/<repo> && ./deploy.sh

# Tail a service
ssh root@185.245.182.175 'docker logs nuraview-scraper --since 5m --tail 100'
ssh root@185.245.182.175 'docker ps'

# DB backup (custom format) — replace <UNPOOLED_URL>
ssh root@185.245.182.175 "docker run --rm -e U='<UNPOOLED_URL>' \
  -v /root/db-backups:/bak postgres:17 \
  sh -c 'pg_dump \"\$U\" -Fc --no-owner --no-acl -f /bak/nvcrm-\$(date -u +%Y%m%d-%H%M%SZ).dump'"
```

---

## 8. Security / open items

- `nextcrm-app` is **public** — keep all infra/secrets out of its README,
  code, and commit messages.
- **Rotate the Neon DB password** — it was pasted in plaintext during the
  2026-05-18 migration. After rotating: update Vercel (`DATABASE_URL` +
  `DATABASE_URL_UNPOOLED`, Production + Development) and local `.env`.
- Stale leftover Vercel vars (`POSTGRES_URL`, `PGHOST`, … from the old Neon
  integration) point at the dead endpoint — harmless (app doesn't read them)
  but worth removing the old Neon integration to avoid confusion.
