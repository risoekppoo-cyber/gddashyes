"""Serve Westminster Dash with a same-origin relay for online levels."""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parent
HOSTS = {"www.boomlings.com", "boomlings.com"}
LEVEL_ENDPOINTS = {
    "getGJLevels21.php", "downloadGJLevel22.php", "getGJSongInfo.php",
    "getGJDailyLevel.php", "getGJGauntlets21.php", "getGJMapPacks21.php",
}
MAX_FORM = 64 * 1024
MAX_RESPONSE = 16 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GameHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/__gd_relay":
            self.relay()
        elif path in {"/", "/index.html"}:
            html = (ROOT / "index.html").read_bytes()
            html = html.replace(b"</script>", b'</script><script src="/mods/network-relay.js"></script>', 1)
            self.respond(200, html, "text/html; charset=utf-8")
        else:
            super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path == "/__gd_relay":
            self.relay()
        else:
            self.send_error(405)

    def respond(self, status, body, content_type="text/plain; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def relay(self):
        host = self.headers.get("Host", "")
        port = self.server.server_port
        if host not in {f"127.0.0.1:{port}", f"localhost:{port}"}:
            self.send_error(403)
            return
        origin = self.headers.get("Origin")
        if origin and origin != f"http://{host}":
            self.send_error(403)
            return
        try:
            target = urlsplit(parse_qs(urlsplit(self.path).query).get("url", [""])[0])
            endpoint = target.path.removeprefix("/database/")
            if (target.scheme not in {"http", "https"} or target.netloc not in HOSTS
                    or target.path != "/database/" + endpoint or endpoint not in LEVEL_ENDPOINTS
                    or target.fragment):
                self.send_error(403)
                return
            size = int(self.headers.get("Content-Length", "0"))
            if size < 0 or size > MAX_FORM:
                self.send_error(413)
                return
        except ValueError:
            self.send_error(400)
            return

        body = self.rfile.read(size) if self.command == "POST" else None
        upstream = "https://www.boomlings.com" + target.path
        if target.query:
            upstream += "?" + target.query
        request = Request(upstream, data=body, method=self.command, headers={
            "User-Agent": "",
            "Content-Type": "application/x-www-form-urlencoded",
        })
        try:
            with build_opener(NoRedirect()).open(request, timeout=20) as response:
                result = response.read(MAX_RESPONSE + 1)
                if len(result) > MAX_RESPONSE:
                    self.respond(502, b"The level server response was too large.")
                else:
                    self.respond(response.status, result)
        except HTTPError as error:
            self.respond(502, f"The level server returned HTTP {error.code}.".encode())
        except (URLError, TimeoutError, OSError):
            self.respond(502, b"Could not connect to the Geometry Dash level server.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=18765)
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1", args.port), GameHandler) as server:
        print(f"Open http://127.0.0.1:{server.server_port}/", flush=True)
        server.serve_forever()
