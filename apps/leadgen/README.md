# Win the Day Planner — lead pipeline + landing page

> This repo began as an HVAC lead pipeline for another client and was repurposed
> for Win the Day Planner. Most of the text below still describes the generic
> pipeline; read **Win the Day specifics** first, and mind the CI warning there.

Collects leads from configured sources (LinkedIn jobs/profiles, ThomasNet via Apify, Dodge/ConstructConnect, etc.), scores them, writes **`1.xlsx`**, then optional Milestone 2 steps (AI research columns, email drafts, Instantly).

## Win the Day specifics

### Inherited-fork hazards (mostly defused)

This repo was forked from another client's (Knape/Peter) live pipeline, which
runs on the *same* VPS under `/root/knape/knape-leadgen` with its own
`cockpit-api` service. Two booby traps came with the fork and have been removed:

- `.github/workflows/deploy-backend.yml` — fired on push to `main` and
  `rsync -az --delete`d this repo over `/root/knape/knape-leadgen/`, then
  restarted their service. **Deleted**; there is no CI in this repo now.
- The `vps` git remote (`ssh://root@…/root/knape/knape-leadgen`) — **removed**.

Still live on individual machines, so check yours: a root-level `.vercel/`
linked to their `knape-leadgen` Vercel project. It is gitignored, so it does not
travel with a clone, but running `vercel` from the repo root on a machine that
has it would deploy to their project. Win the Day's own link is the correct one
inside `frontend/` (`winplanner-leadgen`).

**Work on `winday`** — it is the default branch and the only branch on GitHub.

### Landing page — `landing/`

Static page (plain HTML/CSS/JS, no build step) live at
**https://winthedayplanner.net**, whose job is to hand out the free sample
planner and capture the visitor as a lead. The `.net` domain is the Mailu
*sending* domain for cold outreach, so recipients clicking the sender domain
land here rather than on a dead host.

Deploy:

```bash
rsync -az --delete landing/ root@185.245.182.175:/www/wwwroot/winthedayplanner.net/
```

Two placeholders are waiting on client artwork; both swap by replacing the file,
no code change: `landing/assets/mockup.png` (3D mockup) and
`landing/files/win-the-day-sample.pdf` (final sample). The download path is the
`SAMPLE_FILE` constant at the top of `landing/app.js`.

Brand + source material live in the two zips at the repo root: charcoal
`#3c4048`, gold `#e2c470`, navy `#27385b`, laurel mark, and the sample planner
PDFs the on-page previews were rendered from.

### Lead capture

- `POST /api/public/sample-request` — **unauthenticated** (every other cockpit
  route requires a bearer token). Honeypot field `website`, 5 submissions per IP
  per hour, writes to the `sample_leads` Postgres table, returns the download URL.
- `GET /api/sample-leads` — authenticated, newest first. No cockpit UI yet.
- Storage: `outreach/sample_leads.py`, table created at API startup.
- nginx vhost `/www/server/panel/vhost/nginx/winthedayplanner.net.conf` serves
  the static root and proxies `/api/` to `127.0.0.1:8788`, so the form is
  same-origin and there is no CORS surface. Reload nginx with the aaPanel binary
  (`/www/server/nginx/sbin/nginx -c /www/server/nginx/conf/nginx.conf`), not
  `/usr/sbin/nginx`.

Reading leads directly:

```bash
ssh root@185.245.182.175 \
  'docker exec winday-pg psql -U winday -d winday -c "SELECT * FROM sample_leads ORDER BY created_at DESC;"'
```

### Win the Day backend on the VPS

Service `winday-api`, working dir `/root/winday/winday-leadgen`, Postgres in the
`winday-pg` container on `127.0.0.1:5555`. Deploy is a manual `scp` of changed
files plus `systemctl restart winday-api` — there is no CI for it, deliberately.

Do not confuse it with the neighbouring `/root/knape/knape-leadgen` +
`cockpit-api` service on the same box; they are different clients.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # fill secrets — never commit .env
```

The cockpit API + Milestone 2 store data in **Postgres** (not SQLite). Set
`DATABASE_URL` in `.env`, e.g. a local container:

```bash
docker run -d --name leadgen-pg -p 127.0.0.1:5432:5432 \
  -e POSTGRES_DB=leadgen -e POSTGRES_USER=leadgen -e POSTGRES_PASSWORD=leadgen \
  postgres:16-alpine
# .env: DATABASE_URL=postgresql://leadgen:leadgen@127.0.0.1:5432/leadgen
```

Tables auto-create on first API boot. To import existing SQLite data, see
`scripts/sqlite_to_pg.py` below.

## Commands

| Command                                         | What it does                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `python main.py status`                         | Shows whether a pipeline command is running (uses `outreach_data/.pipeline_run.json`)                                       |
| `python main.py` or `python main.py milestone1` | Fetch → ICP → **`1.xlsx`**                                                                                                  |
| `python main.py milestone2-research`            | Fills `company_profile`, `active_projects`, `equipment_needs` (needs `GEMINI_API_KEY` or `GOOGLE_API_KEY` for real AI)      |
| `python main.py milestone2-enrich`              | Hunter.io finder + verifier → fills `email`, `email_verification_status`, scores; writes `email_verification_report.json`   |
| `python main.py milestone2`                     | Gemini research prep (optional), drafts, Instantly gate (`MILESTONE2_CLIENT_APPROVED` + optional Hunter gate before upload) |
| `python main.py milestone2-dashboard`           | Local metrics HTTP UI                                                                                                       |
| `python main.py cockpit-api`                    | Postgres-backed API for React cockpit UI (`/api/auth/login`, `/api/sync`, `/api/accounts`, `/api/accounts/{id}`)            |

Configuration is **`config.py`** (reads **`.env`** next to it). Variable names and vendors are listed in **`.env.example`**.

## Layout

| Path        | Role                                                                         |
| ----------- | ---------------------------------------------------------------------------- |
| `pipeline/` | `milestone1`, `milestone2` (outreach + `milestone2-research` in same module) |
| `sources/`  | Data pulls (Apify, APIs, CSV/JSON)                                           |
| `scoring/`  | Signal classification + ICP scoring (`icp.py`)                               |
| `storage/`  | `1.xlsx` read/write (minimal OOXML, no openpyxl)                             |
| `outreach/` | Sequences, Instantly, Postgres store (`db.py` psycopg shim), dashboard       |
| `utils/`    | Shared helpers                                                               |
| `deploy/`   | `postgres-compose.yml` (the `leadgen-pg` container)                          |
| `scripts/`  | `sqlite_to_pg.py` one-time SQLite → Postgres importer                        |

## Output

- **`1.xlsx`** — lead rows; column order is **`LEAD_FIELD_ORDER`** in `storage/xlsx_output.py`.

## React Cockpit UI (Postgres + API)

1. Start API (needs `DATABASE_URL` set — see Setup):

```bash
python3 -m pip install -r requirements.txt
python3 main.py cockpit-api
```

2. Start frontend (new terminal):

```bash
cd frontend
npm install
npm run dev
```

3. Open `http://127.0.0.1:5173`, then login with:

- Email: `COCKPIT_ADMIN_EMAIL` (default `admin@local`)
- Password: `COCKPIT_ADMIN_PASSWORD` (default `changeme123`)

4. Click **Sync XLSX → DB** to load `1.xlsx` into the `accounts`/`contacts` tables.

## Database (Postgres)

All cockpit + Milestone 2 data lives in one Postgres database (`DATABASE_URL`):
`users`, `sessions`, `accounts`, `contacts`, `evidence`, `sweeps`,
`email_sequences`, `email_steps`, `email_send_log`, `outbox_messages`,
`runs`, `leads`, `sequence_steps`, `events`.

- `outreach/db.py` is a thin sqlite3-compatible shim over **psycopg 3**
  (dict rows, `?`→`%s`, `executescript`); the store modules call it.
- Schema auto-creates on first boot via the `init_db` / `_init_db` functions.
- One-time import from the old SQLite files:

```bash
DATABASE_URL=postgresql://... python3 scripts/sqlite_to_pg.py \
  --cockpit outreach_data/cockpit.sqlite \
  --milestone2 outreach_data/milestone2.sqlite   # add --truncate to re-run
```

## Deployment

- **Frontend**: Vercel — `frontend/` (build `vite build`), live at
  `https://knape-leadgen.vercel.app`. API base defaults to `https://peter.auxcgen.com`
  (override with `VITE_API_BASE`).
- **Backend + DB**: VPS, dir `/root/knape/knape-leadgen`, run via systemd
  (`cockpit-api.service`, `:8787`) behind nginx (`peter.auxcgen.com`). Postgres
  runs in the `leadgen-pg` Docker container on `127.0.0.1:5544`
  (`deploy/postgres-compose.yml` + a gitignored `deploy/postgres.env`).
- **CI**: `.github/workflows/deploy-backend.yml` rsyncs the Python backend to the
  VPS on push to `main` (runtime files — `.env`, `outreach_data/`, `1.xlsx`,
  `deploy/postgres.env` — are excluded/protected), then restarts the service.
  Needs repo secrets `VPS_SSH_KEY`, `VPS_HOST`, `VPS_USER`.
