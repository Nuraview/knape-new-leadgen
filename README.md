# nv-crm monorepo

Three apps in one repo, each with its own deploy path:

```
apps/
├── web/        Next.js CRM. Deploys to Vercel.
├── scraper/    Python Upwork scraper. Deploys to VPS via GitHub Actions.
└── whatsapp/   Baileys WhatsApp bridge. Deploys to VPS via GitHub Actions.
```

## Deploys are path-gated

| Change touches… | Pipeline | Trigger |
|---|---|---|
| `apps/web/**` | Vercel build of `nv-crm` project | Vercel GitHub integration + `apps/web/scripts/vercel-ignore.sh` skips backend-only pushes |
| `apps/scraper/**` | `.github/workflows/deploy-scraper.yml` → rsync to VPS `/root/nuraview-scraper/` | push to `main` |
| `apps/whatsapp/**` | `.github/workflows/deploy-whatsapp.yml` → rsync to VPS `/root/nuraview-whatsapp/` | push to `main` |

So a commit that only edits `apps/scraper/pusher.py` triggers the scraper deploy and nothing else; a commit that edits `apps/web/app/page.tsx` triggers Vercel and nothing else.

## Required GitHub Actions secrets

Set at the repo level (Settings → Secrets and variables → Actions):

- `VPS_SSH_KEY` — private SSH key with access to `root@185.245.182.175`
- `VPS_HOST` — `185.245.182.175`

These are consumed by both `deploy-scraper.yml` and `deploy-whatsapp.yml`.

## Required Vercel project setting

The `nv-crm` Vercel project's **Root Directory** must be `apps/web`. Set this once in the Vercel dashboard (Project → Settings → General → Root Directory).

## Local development

```sh
# Web
cd apps/web && bun install && bun run dev

# Scraper
cd apps/scraper && docker compose up

# Whatsapp
cd apps/whatsapp && pnpm install && pnpm dev
```

## History

The pre-monorepo state of each repo is tagged `pre-monorepo-2026-05-21` in the original repos.

Scraper and whatsapp were merged in via `git subtree add` (full history preserved). The original `nuraview-scraper` and `nuraview-whatsapp` GitHub repos can be archived once VPS deploys from the monorepo are confirmed green.

---
*Last deploy trigger: 2026-06-12*
