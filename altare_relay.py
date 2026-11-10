"""Westminster Dash HTTPS relay backend for the Altare web route."""

import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import BoundedSemaphore
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

GAME_ORIGIN = "https://risoekppoo-cyber.github.io"
CATALOG = "https://raw.githubusercontent.com/FlafyDev/auto-nong-indexes/v2/sfh-index.min.json"
LEVEL_ENDPOINTS = {
    "getGJLevels21.php", "downloadGJLevel22.php", "getGJSongInfo.php",
    "getGJDailyLevel.php", "getGJGauntlets21.php", "getGJMapPacks21.php",
}
MAX_RESPONSE = 32 * 1024 * 1024
MAX_FORM = 64 * 1024


class UpstreamRedirects(HTTPRedirectHandler):
    def __init__(self, allow_song_bucket=False):
        self.allow_song_bucket = allow_song_bucket

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        if (self.allow_song_bucket and target.scheme == "https"
                and target.netloc == "bucket.gdmobilewrlist.com"
                and re.fullmatch(r"/api/bucket/file/[0-9a-f]+", target.path)):
            return super().redirect_request(req, fp, code, msg, headers, newurl)
        return None


class RelayServer(ThreadingHTTPServer):
    slots = BoundedSemaphore(12)

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        request.settimeout(15)
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()


class RelayHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        if self.headers.get("Origin") == GAME_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", GAME_ORIGIN)
        self.send_header("Vary", "Origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_request(self, code="-", size="-"):
        # Keep request parameters and search terms out of application logs.
        self.log_message("%s %s %s", self.command, self.path.split("?", 1)[0], code)

    def reply(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def allowed_origin(self):
        if self.headers.get("Origin") not in {None, GAME_ORIGIN}:
            self.reply(403, b"Origin not allowed")
            return False
        return True

    def do_OPTIONS(self):
        if not self.allowed_origin():
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if not self.allowed_origin():
            return
        target = urlsplit(self.path)
        if target.path in {"/", "/health"}:
            self.reply(200, b"Westminster relay ready\n")
            return
        if target.path == "/catalog":
            self.forward(CATALOG, "application/json")
            return
        song = re.fullmatch(r"/song/([0-9a-f]{24})", target.path)
        if song:
            name = parse_qs(target.query).get("name", [""])[0]
            params = {"download": "true"}
            if re.fullmatch(r"[0-9]{1,10}", name):
                params["name"] = name
            url = f"https://api.songfilehub.com/song/{song[1]}?{urlencode(params)}"
            self.forward(url, "audio/mpeg")
            return
        self.reply(404, b"Unknown relay route")

    def do_POST(self):
        if not self.allowed_origin():
            return
        path = urlsplit(self.path).path
        endpoint = path.removeprefix("/level/")
        if path != "/level/" + endpoint or endpoint not in LEVEL_ENDPOINTS:
            self.reply(404, b"Unknown level endpoint")
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_FORM:
                self.reply(413, b"Invalid request size")
                return
            data = self.rfile.read(size)
            form = parse_qs(data.decode("ascii"), keep_blank_values=True, max_num_fields=128)
        except (UnicodeError, ValueError, TimeoutError):
            self.reply(400, b"Invalid level request")
            return
        if any(key.lower() in {"gjp", "gjp2", "password", "token"} for key in form):
            self.reply(400, b"Only public level requests are supported")
            return
        self.forward("https://www.boomlings.com/database/" + endpoint, "text/plain", data)

    def forward(self, url, content_type, data=None):
        headers = {"User-Agent": ""}
        if data is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        request = Request(url, data=data, headers=headers)
        try:
            response = build_opener(UpstreamRedirects(content_type == "audio/mpeg")).open(request, timeout=12)
        except HTTPError as error:
            self.reply(502, f"Upstream returned HTTP {error.code}".encode())
            error.close()
            return
        except (URLError, TimeoutError, OSError):
            self.reply(502, b"Upstream connection failed")
            return

        with response:
            length = response.headers.get("Content-Length")
            if length and (not length.isdecimal() or int(length) > MAX_RESPONSE):
                self.reply(502, b"Upstream response exceeds size limit")
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            if length is not None:
                self.send_header("Content-Length", length)
            self.end_headers()
            remaining = MAX_RESPONSE
            try:
                while chunk := response.read1(min(65536, remaining + 1)):
                    if len(chunk) > remaining:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
            except OSError:
                # The browser may cancel a download, or the upstream may time out.
                self.close_connection = True


if __name__ == "__main__":
    port = int(os.environ.get("SERVER_PORT") or os.environ.get("PORT") or "25502")
    with RelayServer(("0.0.0.0", port), RelayHandler) as server:
        print(f"Westminster relay listening on port {port}", flush=True)
        server.serve_forever()
