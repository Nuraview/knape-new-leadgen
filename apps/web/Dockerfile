# NuraviewCRM production image.
#
# Built in GitHub Actions and pushed to GHCR — never built on the VPS, which
# runs the browser scrapers and has no headroom for a Next.js build.
#
# Two toolchains on purpose: bun installs + builds (it owns bun.lock and is
# what Vercel used), Node runs the standalone server (Next emits a Node
# server.js, and sharp/puppeteer are happiest on plain Node).

# ============================================
# Stage 1: install dependencies
# ============================================
FROM oven/bun:1 AS deps

WORKDIR /app

# Build context is the REPO ROOT (see deploy-crm.yml), because the root is a
# bun workspace: the lockfile, bunfig.toml and node_modules all live there.
# Only manifests are copied first so this layer caches on dependency changes.
COPY package.json bun.lock bunfig.toml ./
COPY apps/web/package.json ./apps/web/
RUN bun install --frozen-lockfile

# ============================================
# Stage 2: build
# ============================================
FROM oven/bun:1 AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next runs from the app package; outputFileTracingRoot in next.config.js is
# set to the repo root so the traced standalone bundle picks up the hoisted
# node_modules.
WORKDIR /app/apps/web

# NEXT_PUBLIC_* are INLINED into the client bundle at build time — a runtime
# .env cannot change them, so the real (public, non-secret) values must be here.
# Override per-build with --build-arg if the host ever changes.
ARG NEXT_PUBLIC_APP_NAME="NuraView"
ARG NEXT_PUBLIC_APP_URL="https://crmx1.nuraview.com"
ARG NEXT_PUBLIC_PROPOSAL_URL="https://crmx1.nuraview.com"
ARG NEXT_PUBLIC_FILES_URL="https://crmx1.nuraview.com/files"
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY="BADkqtLV0jDOtf4xWAS83uGRbuwRmVp5Wkpqxhtj_8FUg_rhRQxAsXm-Hq7zV1ZtGAH6GpoQ-FJJNPYzM44VsMM"
ENV NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_PUBLIC_PROPOSAL_URL=${NEXT_PUBLIC_PROPOSAL_URL}
ENV NEXT_PUBLIC_FILES_URL=${NEXT_PUBLIC_FILES_URL}
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=${NEXT_PUBLIC_VAPID_PUBLIC_KEY}

# Build-time placeholders for server-only vars. Next collects page data during
# the build, which imports modules that read env vars at load time
# (lib/db/env.ts throws without DATABASE_URL). Real values are injected at
# runtime from /root/nuraview-crm/.env.
ENV DATABASE_URL="postgresql://placeholder:placeholder@placeholder:5432/placeholder"
ENV DATABASE_URL_UNPOOLED="postgresql://placeholder:placeholder@placeholder:5432/placeholder"
ENV INNGEST_ID="nextcrm-build"
ENV INNGEST_APP_NAME="NuraviewCRM-Build"
ENV INNGEST_EVENT_KEY="build-placeholder"
ENV INNGEST_SIGNING_KEY="build-placeholder"
ENV AUTH_SECRET="build-time-placeholder-secret-replace-at-runtime"
ENV BETTER_AUTH_SECRET="build-time-placeholder-secret-replace-at-runtime"
ENV EMAIL_ENCRYPTION_KEY="0000000000000000000000000000000000000000000000000000000000000000"
ENV MINIO_ENDPOINT="http://placeholder:9000"
ENV MINIO_BUCKET="placeholder"
ENV MINIO_ACCESS_KEY="placeholder"
ENV MINIO_SECRET_KEY="placeholder"
ENV OPENAI_API_KEY="sk-placeholder-for-build"
ENV RESEND_API_KEY="re_placeholder_for_build"
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1

RUN bun run build

# ============================================
# Stage 3: runtime
# ============================================
FROM node:22-slim AS runner

# chromium: proposal PDFs are printed from the live public page by
#   puppeteer-core (lib/proposals/pdf/print.ts).
# fonts: without them the printed PDF renders boxes for unicode/emoji.
# curl: container HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-noto-color-emoji \
      ca-certificates \
      curl \
      tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs --home /app nextjs

# Standalone output ships its own minimal node_modules (sharp, puppeteer-core,
# and everything else Next traced).
# With a workspace root, `output: standalone` emits apps/web/server.js plus a
# hoisted node_modules at the bundle root — hence the nested static/public
# paths and `node apps/web/server.js` below.
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "apps/web/server.js"]
