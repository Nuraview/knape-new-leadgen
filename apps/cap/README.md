# apps/cap — Self-hosted Cap (Loom replacement)

Deployment config for [Cap](https://github.com/CapSoftware/Cap), run **unmodified**
from upstream prebuilt images (AGPL compliance depends on that — never patch or
fork the images; the CRM only talks to Cap over HTTP).

Replaces the 2000 INR/mo Loom subscription. Gives: in-browser screen+camera
recording (OBS virtual camera shows up as a normal camera), server-side trim,
share pages, view analytics, and an auto-generated animated GIF preview per
video — which `apps/web` re-hosts on Vercel Blob to embed in outreach emails
(see `apps/web/lib/videos/cap-embed.ts`).

## Topology

| URL | Container | Port (loopback) |
|---|---|---|
| https://cap.nuraview.com | cap-web | 127.0.0.1:3000 |
| https://capstore.nuraview.com | cap-minio (S3) | 127.0.0.1:9000 |

- VPS: root@185.245.182.175, stack at `/root/nuraview-cap/`
- TLS terminated by the host's aaPanel nginx (`/www/server/nginx`), vhosts in
  `/www/server/panel/vhost/nginx/` (installed by `deploy.sh`).
- MinIO gets its **own subdomain** because S3 SigV4 signatures cover host+path —
  an nginx path-rewrite would break every presigned URL.
- Internal: mysql:8.0 + media-server (FFmpeg, `mem_limit: 3g`) on the compose
  network, unpublished.

## Deploy

```bash
# one-time: DNS A records cap + capstore -> 185.245.182.175
# one-time: create /root/nuraview-cap/.env from .env.example (openssl rand -hex 32 per secret)
./deploy.sh
```

`deploy.sh` bootstraps certs automatically (HTTP-only vhost → certbot webroot →
full vhost) for any domain without one; renewal rides the existing certbot cron.

## Email contract with apps/web

`GET https://cap.nuraview.com/api/video/preview?videoId=<id>` → **302** to a
~1h-signed `capstore.nuraview.com/cap/...` GIF URL. Signed URLs must NEVER be
hotlinked in emails — `apps/web/lib/videos/cap-embed.ts` downloads the GIF once
and re-hosts it publicly on Vercel Blob. Share pages: `https://cap.nuraview.com/s/<id>`.

## Auth

Magic-link login via the CRM's Resend key (`RESEND_FROM_DOMAIN=hello.nuraview.com`).
If Resend is misconfigured, links are printed to `docker logs cap-web`.

## Ops notes

- Disk: root FS was at 65% before install; videos cost ~10–50MB per minute.
  Watch `docker system df` and the `cap-minio-data` volume; prune old videos
  from the Cap UI when space gets tight.
- RAM: steady-state ~1GB for the stack; media-server spikes during transcodes
  (fenced at 3g).
- Logs: `ssh root@185.245.182.175 'cd /root/nuraview-cap && docker compose logs -f cap-web'`
- Pin images to a release tag once the stack is validated (`:latest` at bootstrap).
