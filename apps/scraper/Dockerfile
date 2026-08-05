FROM python:3.11-slim

# System deps for Camoufox (Firefox-based automation). Copied verbatim from
# /root/upwork-scraper/Dockerfile — this image is a fork of that base.
RUN apt-get update && \
    apt-get install -y \
    curl \
    tini \
    ca-certificates \
    tzdata \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libwayland-client0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    libdbus-glib-1-2 \
    libxt6 \
    procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps: same as base + requests for the pusher loop.
# Pinned because unpinned `camoufox[geoip]` pulled 0.4.11 + Playwright 1.60.0
# on 2026-05-21, which has a Firefox page-error handler bug that crashes the
# browser on most Upwork pages (TypeError: reading 'url' of undefined in
# coreBundle.js pageError.location). 0.4.8 + 1.50.0 was the last known-stable
# combo. Bump only after testing.
RUN pip install --no-cache-dir \
    flask \
    flask-cors \
    "camoufox[geoip]==0.4.8" \
    "playwright==1.50.0" \
    psutil \
    requests

RUN python3 -m camoufox fetch

# App code: the base scraper + our pusher + entrypoint that runs both.
COPY upwork_scraper_service.py .
COPY pusher.py .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

ENV PYTHONUNBUFFERED=1
ENV HEADLESS=true
ENV DEFAULT_LIMIT=50
ENV MAX_RETRIES=2

# Flask binds to 5007 inside the container but we don't publish the port —
# only the pusher (in the same container) talks to it.
EXPOSE 5007

ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["/app/entrypoint.sh"]
