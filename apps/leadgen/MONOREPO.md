# apps/leadgen — the Python lead-gen cockpit

The FastAPI service behind Dan's lead pipeline. It runs on the Contabo VPS as
systemd unit `winday-api` (port 8788, `main.py cockpit-api`), reverse-proxied as
`https://dan.nuraview.com`, with its own Postgres in the `winday-pg` container.

It is **not** deployed to Vercel and is not a Bun workspace. `crm.winthedayplanner.net`
reaches it server-side through `apps/api/src/leadgen/`, so the browser only ever
talks to one origin and the API keys stay off the client.

## Where it came from

Filtered import of `github.com/Nuraview/winplanner-leadgen` at `4d715e6c`
(branch `winday`). What was left behind, and why:

| Left behind | Why |
|---|---|
| `frontend/` | Superseded by the SPA tabs in `apps/app` |
| `landing/`, `landing-v2/`, `landing-v3/` | Deploy to `winthedayplanner.com`, not the CRM. ~860MB between them |
| `wintheday_email_creatives/`, `outreach/static/email/creatives/` | ~46MB of campaign GIFs; server-side assets |
| `data/nces/` | ~80MB school dataset, re-downloadable per `sources/nces_schools.py` |
| `outreach_data/` | Live working state |
| Zips, PDFs, docx, screenshots | Litter |

`git subtree` was rejected on purpose: the old repo's `.git` is 803MB against
this monorepo's 42MB, nearly all of it those binaries. History stays one clone
away in the old repo rather than permanently inflating this one.

Two credentials that were committed in the old repo's `DASHBOARD_REVIEW.md` and
`winday_call_script.md` were scrubbed during the import. **They are still live
and still in the old repo's history** — rotate `admin@winday.local` there.

## Drift found during the import

Four modules exist on the production box but were never committed upstream.
All four are dead — nothing imports them — and all four are superseded:

| On the box | Superseded by |
|---|---|
| `cockpit_api.py` (66KB) | `outreach/cockpit_api.py` (105KB, byte-identical to this copy) |
| `icp.py` | `scoring/icp.py` |
| `pipeline/usaspending.py` | `sources/usaspending.py` |
| `scripts/run_org_email_sitescan.py` | standalone, unreferenced |

This is why `.github/workflows/deploy-leadgen.yml` rsyncs **without `--delete`**:
this tree is a filtered subset, so a delete pass would take the live NCES data
and creatives with it.

## Deploying

Push to `winday` touching `apps/leadgen/**`, or run the workflow by hand. It
rsyncs, reinstalls dependencies only when `requirements.txt` changes, restarts
`winday-api`, and fails the run if `http://127.0.0.1:8788/api/health` is not 200.

Needs repo secrets `VPS_SSH_KEY` and `VPS_HOST`.

## Known hazards in this code

Carried over as-is rather than fixed silently during a move:

- `outreach/cockpit_api.py` uses a **static PBKDF2 salt** for its own logins.
- `outreach_inboxes.smtp_password` is stored **in plaintext**.
- `accounts.phone`, `.email` and `.linkedin_url` exist in the live database but
  not in the `CREATE TABLE` — schema drift; a fresh database will not match
  production.
- `POST /api/sync` starts with `DELETE FROM accounts`. It is deliberately absent
  from the proxy allow-list in `apps/api/src/leadgen/index.ts`.
