"""Whole-video preview GIF generator (Loom-style) for the Cap stack.

Cap's own animated preview covers only the first ~4s of a recording, which
looks static for screen captures. This sidecar samples ~24 frames across the
ENTIRE video and plays them back fast (8 fps, ~3s loop), so any on-screen
activity is visible in the email thumbnail.

GET /gif?videoId=<id>  (header X-Gifmaker-Secret: $GIFMAKER_SECRET)
  -> image/gif  (raw, no badge — CRM-internal)

GET /thumb/<id>.gif  (PUBLIC — email <img> source, served via cap.nuraview.com)
  -> image/gif with a play badge baked onto every frame. Public on purpose:
     Gmail blocks images when an email pulls from multiple random third-party
     hosts; serving from the branded cap domain keeps images loading. The
     preview is already public through Cap's own share/preview endpoints.

Reads result.mp4 straight from the stack's MinIO via mc. Cap itself is not
modified (AGPL stays clean) — this is an independent consumer of the bucket.
"""

import json
import os
import re
import subprocess
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

MINIO_URL = os.environ.get("MINIO_URL", "http://minio:9000")
MINIO_USER = os.environ["MINIO_ROOT_USER"]
MINIO_PASSWORD = os.environ["MINIO_ROOT_PASSWORD"]
SECRET = os.environ["GIFMAKER_SECRET"]
BUCKET = os.environ.get("CAP_BUCKET", "cap")
CACHE_DIR = "/tmp/gifcache"

VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{5,32}$")

os.makedirs(CACHE_DIR, exist_ok=True)
subprocess.run(
    ["mc", "alias", "set", "m", MINIO_URL, MINIO_USER, MINIO_PASSWORD],
    check=True, capture_output=True,
)


def find_video_key(video_id: str) -> str | None:
    out = subprocess.run(
        ["mc", "find", f"m/{BUCKET}", "--path", f"*/{video_id}/result.mp4"],
        capture_output=True, text=True, timeout=30,
    )
    lines = [l.strip() for l in out.stdout.splitlines() if l.strip()]
    return lines[0] if lines else None


def build_gif(video_id: str, badge: bool = False) -> str | None:
    """Returns path to cached GIF, generating it if needed.

    badge=True composites the play-button PNG onto every frame (email thumb).
    """
    suffix = "-badge" if badge else ""
    gif_path = os.path.join(CACHE_DIR, f"{video_id}{suffix}.gif")
    if os.path.exists(gif_path):
        return gif_path

    key = find_video_key(video_id)
    if not key:
        return None
    mp4_path = os.path.join(CACHE_DIR, f"{video_id}-{suffix or 'raw'}.mp4")
    subprocess.run(["mc", "cp", "-q", key, mp4_path], check=True,
                   capture_output=True, timeout=300)
    try:
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "csv=p=0", mp4_path],
            capture_output=True, text=True, timeout=60,
        )
        duration = max(float(probe.stdout.strip() or "1"), 0.5)
        # ~24 frames spread over the whole video, replayed at 8 fps.
        # settb=AVTB gives fine-grained timestamps (the fps filter's coarse
        # timebase makes later stages quantize/drop frames); the trailing
        # fps=8 stamps the sped-up rate into stream metadata so the GIF
        # encoder keeps every frame instead of syncing to the sample rate.
        sample_fps = min(10.0, 24.0 / duration)
        sample = (
            f"fps={sample_fps:.5f},settb=AVTB,setpts=N/(8*TB),fps=8,scale=480:-2"
        )
        palette = (
            "split[a][b];[a]palettegen=max_colors=128[p];"
            "[b][p]paletteuse=dither=bayer:bayer_scale=5"
        )
        if badge:
            cmd = [
                "ffmpeg", "-y", "-v", "error", "-i", mp4_path, "-i", "/badge.png",
                "-filter_complex",
                f"[0:v]{sample}[v];[v][1:v]overlay=(W-w)/2:(H-h)/2[o];[o]{palette}",
                "-loop", "0", gif_path,
            ]
        else:
            cmd = [
                "ffmpeg", "-y", "-v", "error", "-i", mp4_path,
                "-vf", f"{sample},{palette}", "-loop", "0", gif_path,
            ]
        subprocess.run(cmd, check=True, capture_output=True, timeout=240)
        return gif_path
    finally:
        if os.path.exists(mp4_path):
            os.remove(mp4_path)


class Handler(BaseHTTPRequestHandler):
    def _serve_gif(self, video_id: str, badge: bool, cache_control: str):
        if not VIDEO_ID_RE.match(video_id):
            self.send_response(400); self.end_headers(); return
        try:
            gif_path = build_gif(video_id, badge=badge)
        except Exception as exc:  # noqa: BLE001
            print(f"[gifmaker] {video_id} failed: {exc}", flush=True)
            self.send_response(500); self.end_headers(); return
        if not gif_path:
            self.send_response(404); self.end_headers(); return
        with open(gif_path, "rb") as fh:
            data = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", "image/gif")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        self.wfile.write(data)

    def _serve_download(self, video_id: str):
        """Stream result.mp4 straight from MinIO as an attachment. Reliable
        cross-browser download — Cap's own button uses a WebCodecs browser
        conversion that needs latest Chrome/Edge and often fails."""
        if not VIDEO_ID_RE.match(video_id):
            self.send_response(400); self.end_headers(); return
        key = find_video_key(video_id)
        if not key:
            self.send_response(404); self.end_headers(); return
        try:
            size = subprocess.run(
                ["mc", "stat", "--json", key],
                capture_output=True, text=True, timeout=30,
            )
            content_len = str(json.loads(size.stdout).get("size", "")) if size.stdout else ""
        except Exception:  # noqa: BLE001
            content_len = ""
        self.send_response(200)
        self.send_header("Content-Type", "video/mp4")
        self.send_header("Content-Disposition", f'attachment; filename="{video_id}.mp4"')
        if content_len:
            self.send_header("Content-Length", content_len)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        # `mc cat` streams the object; pipe it to the socket in chunks so we
        # never buffer a 30MB video in memory.
        proc = subprocess.Popen(["mc", "cat", key], stdout=subprocess.PIPE)
        try:
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)
        finally:
            proc.stdout.close()
            proc.wait()

    def do_GET(self):  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/health":
            self.send_response(200); self.end_headers()
            self.wfile.write(b"ok"); return

        # PUBLIC email thumbnail (badge baked in). Served through the branded
        # cap domain so Gmail's image proxy sees one reputable host.
        thumb = re.match(r"^/thumb/([A-Za-z0-9_-]{5,32})\.gif$", parsed.path)
        if thumb:
            # Immutable-ish: same videoId always yields the same preview.
            self._serve_gif(thumb.group(1), badge=True,
                            cache_control="public, max-age=31536000, immutable")
            return

        # PUBLIC direct MP4 download (the video is already shareable).
        dl = re.match(r"^/dl/([A-Za-z0-9_-]{5,32})\.mp4$", parsed.path)
        if dl:
            self._serve_download(dl.group(1))
            return

        if self.headers.get("X-Gifmaker-Secret") != SECRET:
            self.send_response(403); self.end_headers(); return
        if parsed.path != "/gif":
            self.send_response(404); self.end_headers(); return
        video_id = urllib.parse.parse_qs(parsed.query).get("videoId", [""])[0]
        # no-store: CRM-internal; intermediary caches (aaPanel nginx) must
        # never serve stale builds after sidecar updates.
        self._serve_gif(video_id, badge=False, cache_control="no-store")

    def log_message(self, fmt, *args):  # quieter logs
        print(f"[gifmaker] {self.address_string()} {fmt % args}", flush=True)


if __name__ == "__main__":
    print("[gifmaker] listening on :8080", flush=True)
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
