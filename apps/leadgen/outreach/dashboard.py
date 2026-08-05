"""Minimal HTTP dashboard + webhook ingest for Milestone 2 metrics (stdlib only)."""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

from config import MILESTONE2_DASHBOARD_BIND, MILESTONE2_DASHBOARD_PORT, resolved_milestone2_db_path
from outreach import campaign_store

_M2_SQLITE = str(resolved_milestone2_db_path())


def _classify_webhook(body: dict) -> tuple[str | None, str | None]:
    """Return (email, normalized_event) where normalized is open|reply|bounce|unknown."""
    email: str | None = None
    for key in ("lead_email", "email", "to_email", "recipient"):
        v = body.get(key)
        if isinstance(v, str) and "@" in v:
            email = v.strip()
            break
    if email is None:
        lead = body.get("lead")
        if isinstance(lead, dict):
            v = lead.get("email")
            if isinstance(v, str) and "@" in v:
                email = v.strip()
    raw = (
        str(body.get("event_type") or body.get("event") or body.get("type") or body.get("action") or "")
    ).lower()
    if not raw and isinstance(body.get("data"), dict):
        d = body["data"]
        raw = str(d.get("event_type") or d.get("type") or "").lower()
        if email is None:
            v = d.get("email")
            if isinstance(v, str):
                email = v.strip()
    if "bounce" in raw or "invalid" in raw:
        return email, "bounce"
    if "reply" in raw or "replied" in raw:
        return email, "reply"
    if "open" in raw:
        return email, "open"
    return email, "unknown"


_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Milestone 2 — outreach metrics</title>
  <style>
    :root { --bg:#0f1419; --card:#1a2332; --text:#e7ecf3; --muted:#8b9cb3; --accent:#3d9cf5; --ok:#5bd37a; }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--text);
      margin: 0; padding: 1.5rem; line-height: 1.5; }
    h1 { font-size: 1.25rem; font-weight: 600; margin: 0 0 0.25rem; }
    p.sub { color: var(--muted); margin: 0 0 1.25rem; font-size: 0.9rem; }
    .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); max-width: 720px; }
    .card { background: var(--card); border-radius: 10px; padding: 1rem 1.1rem; border: 1px solid #2a3545; }
    .card span { display: block; color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: .04em; }
    .card strong { font-size: 1.5rem; font-weight: 600; color: var(--accent); }
    .card strong.pct { color: var(--ok); }
    footer { margin-top: 2rem; color: var(--muted); font-size: 0.8rem; }
    code { background: #243044; padding: 0.15rem 0.4rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Milestone 2 dashboard</h1>
  <p class="sub">Open rate, reply rate, bounce rate — auto-refresh every 12s. POST webhooks to <code>/webhook/instantly</code>.</p>
  <div class="grid" id="g">Loading…</div>
  <footer>Configure Instantly (or other ESP) to forward engagement events to this server.</footer>
  <script>
    async function tick() {
      try {
        const u = new URL(window.location.href);
        const run = u.searchParams.get("run_id");
        const q = run ? ("?run_id=" + encodeURIComponent(run)) : "";
        const r = await fetch("/api/stats" + q);
        const j = await r.json();
        const pct = (v) => (v == null ? "—" : v + "%");
        document.getElementById("g").innerHTML = [
          ["Leads", j.leads_total],
          ["Drafts", j.drafts_recorded],
          ["Sent / pushed", j.sent_or_pushed],
          ["Opens", j.opens],
          ["Replies", j.replies],
          ["Bounces", j.bounces],
          ["Open rate", pct(j.open_rate_pct), true],
          ["Reply rate", pct(j.reply_rate_pct), true],
          ["Bounce rate", pct(j.bounce_rate_pct), true],
        ].map(([l,v,p]) => '<div class="card"><span>'+l+'</span><strong class="'+(p?"pct":"")+'">'+v+'</strong></div>').join("");
      } catch (e) {
        document.getElementById("g").textContent = "Could not load stats.";
      }
    }
    tick();
    setInterval(tick, 12000);
  </script>
</body>
</html>
"""


def _handler_factory():
    db = _M2_SQLITE

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: object) -> None:
            return

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            if parsed.path == "/":
                body = _HTML.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if parsed.path == "/api/stats":
                qs = parse_qs(parsed.query or "")
                run_id = (qs.get("run_id") or [None])[0]
                stats = campaign_store.aggregate_stats(db, run_id)
                raw = json.dumps(stats).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
                return
            self.send_error(404)

        def do_POST(self) -> None:
            if urlparse(self.path).path != "/webhook/instantly":
                self.send_error(404)
                return
            length = int(self.headers.get("Content-Length", "0") or 0)
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                body = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                body = {}
            email, ev = _classify_webhook(body if isinstance(body, dict) else {})
            lead_id = campaign_store.resolve_lead_id_by_email(db, email) if email else None
            if ev in ("open", "reply", "bounce"):
                campaign_store.record_event(
                    db,
                    ev if ev != "open" else "open",
                    {"raw_event": ev, "webhook": body},
                    lead_id=lead_id,
                )
            elif ev == "unknown" and email:
                campaign_store.record_event(
                    db,
                    "webhook_unknown",
                    {"webhook": body},
                    lead_id=lead_id,
                )
            out = json.dumps({"ok": True, "email": email, "mapped": ev}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

    return Handler


def run_dashboard() -> None:
    campaign_store.init_db(_M2_SQLITE)
    server = HTTPServer((MILESTONE2_DASHBOARD_BIND, MILESTONE2_DASHBOARD_PORT), _handler_factory())
    print(
        f"Milestone 2 dashboard: http://{MILESTONE2_DASHBOARD_BIND}:{MILESTONE2_DASHBOARD_PORT}/ "
        f"(webhook POST http://{MILESTONE2_DASHBOARD_BIND}:{MILESTONE2_DASHBOARD_PORT}/webhook/instantly)"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping dashboard.")
