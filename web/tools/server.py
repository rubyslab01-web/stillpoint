#!/usr/bin/env python3
"""Serves the Stillpoint web port to phones on the same Wi-Fi. Python 3 standard library only.

    python3 web/tools/server.py [--port 8000] [--https] [--diag]

Why not `python3 -m http.server`: Safari won't play <audio> from a server without HTTP Range
support, and the session files and narration live outside web/ (they are shared with the
native app and read in place, never copied). This server maps:

    /content/Sessions/...   -> Sessions/            (index.json is generated from the folder)
    /content/Narration/...  -> App/Resources/Narration/
    everything else         -> web/

--https creates a local certificate authority and a certificate for this Mac's LAN address
(with openssl, no accounts), so the phone gets a secure context: service worker, offline
shell, and full Home Screen install. See README ("Web port") for installing the CA on the phone.
--diag accepts POST /__diag and appends the JSON body to web/.diag.log (used by tests).
"""

import argparse
import datetime
import email.utils
import json
import mimetypes
import os
import re
import socket
import ssl
import subprocess
import sys
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(WEB)
MOUNTS = {
    "/content/Sessions/": os.path.join(ROOT, "Sessions"),
    "/content/Narration/": os.path.join(ROOT, "App", "Resources", "Narration"),
}
CERT_DIR = os.path.join(WEB, ".certs")
TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
    ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".wav": "audio/wav", ".png": "image/png",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
    ".crt": "application/x-x509-ca-cert", ".md": "text/plain; charset=utf-8",
}
CHUNK = 256 * 1024
_seen_clients = set()
_seen_lock = threading.Lock()


def resolve(url_path):
    """Map a URL path to a file on disk, refusing anything outside the allowed folders."""
    path = unquote(urlsplit(url_path).path)
    for prefix, base in MOUNTS.items():
        if path.startswith(prefix):
            rel = path[len(prefix):]
            break
    else:
        base, rel = WEB, path.lstrip("/")
        if rel == "" or rel.endswith("/"):
            rel += "index.html"
        top = rel.split("/", 1)[0]
        if top.startswith(".") or top in ("tools", "tests"):
            return None  # don't serve certificates' private keys, logs, or dev tooling
    full = os.path.realpath(os.path.join(base, rel))
    if not (full == os.path.realpath(base) or full.startswith(os.path.realpath(base) + os.sep)):
        return None
    return full


def session_index():
    names = sorted(f for f in os.listdir(MOUNTS["/content/Sessions/"]) if f.endswith(".json") and f != "modules.json")
    return json.dumps({"files": names}).encode()


class Handler(BaseHTTPRequestHandler):
    server_version = "Stillpoint"
    protocol_version = "HTTP/1.1"
    diag = False
    verbose = False

    def log_message(self, fmt, *args):
        if self.verbose:
            sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def note_client(self):
        ip = self.client_address[0]
        with _seen_lock:
            if ip not in _seen_clients:
                _seen_clients.add(ip)
                print(f"  Connected: {ip}", flush=True)

    def send_body(self, status, body, ctype, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        if self.diag and self.path.startswith("/__diag"):
            n = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(min(n, 1 << 20)).decode("utf-8", "replace")
            stamp = datetime.datetime.now().isoformat(timespec="milliseconds")
            with open(os.path.join(WEB, ".diag.log"), "a") as f:
                f.write(f"{stamp} {self.client_address[0]} {body}\n")
            self.send_body(204, b"", "text/plain")
            return
        if self.path.startswith("/__diag"):
            self.send_body(204, b"", "text/plain")  # accepted but not recorded without --diag
            return
        self.send_body(404, b"not found", "text/plain")

    def do_GET(self):
        self.note_client()
        path = urlsplit(self.path).path
        if path == "/content/Sessions/index.json":
            self.send_body(200, session_index(), TYPES[".json"])
            return
        if path == "/stillpoint-ca.crt":
            ca = os.path.join(CERT_DIR, "stillpoint-local-ca.crt")
            if os.path.exists(ca):
                with open(ca, "rb") as f:
                    self.send_body(200, f.read(), TYPES[".crt"], {"Content-Disposition": 'attachment; filename="stillpoint-local-ca.crt"'})
                return
        full = resolve(self.path)
        if not full or not os.path.isfile(full):
            self.send_body(404, b"not found", "text/plain")
            return
        st = os.stat(full)
        etag = '"%x-%x"' % (int(st.st_mtime), st.st_size)
        ctype = TYPES.get(os.path.splitext(full)[1].lower()) or mimetypes.guess_type(full)[0] or "application/octet-stream"
        headers = {
            "ETag": etag,
            "Last-Modified": email.utils.formatdate(st.st_mtime, usegmt=True),
            "Accept-Ranges": "bytes",
            # Revalidate every time so edited sessions and re-rendered audio show up at once.
            "Cache-Control": "no-cache",
        }
        if self.headers.get("If-None-Match") == etag and not self.headers.get("Range"):
            self.send_response(304)
            for k, v in headers.items():
                self.send_header(k, v)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        size = st.st_size
        start, end, status = 0, size - 1, 200
        rng = self.headers.get("Range")
        if_range = self.headers.get("If-Range")
        if rng and (not if_range or if_range == etag):
            m = re.fullmatch(r"bytes=(\d*)-(\d*)", rng.strip())
            if not m or (m.group(1) == "" and m.group(2) == ""):
                self.send_body(416, b"", "text/plain", {"Content-Range": f"bytes */{size}"})
                return
            if m.group(1) == "":
                n = int(m.group(2))
                start, end = max(0, size - n), size - 1
            else:
                start = int(m.group(1))
                end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
            if start >= size or start > end:
                self.send_body(416, b"", "text/plain", {"Content-Range": f"bytes */{size}"})
                return
            status = 206
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command == "HEAD":
            return
        try:
            with open(full, "rb") as f:
                f.seek(start)
                left = length
                while left > 0:
                    chunk = f.read(min(CHUNK, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
            pass  # Safari routinely abandons media range requests


def lan_addresses():
    ips = []
    for iface in ("en0", "en1", "en2", "en3", "en4", "en5"):
        try:
            ip = subprocess.run(["ipconfig", "getifaddr", iface], capture_output=True, text=True, timeout=2).stdout.strip()
        except Exception:
            ip = ""
        if ip and ip not in ips:
            ips.append(ip)
    if not ips:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("10.255.255.255", 1))
            ips.append(s.getsockname()[0])
            s.close()
        except Exception:
            pass
    return ips


def local_hostname():
    try:
        name = subprocess.run(["scutil", "--get", "LocalHostName"], capture_output=True, text=True, timeout=2).stdout.strip()
        return f"{name}.local" if name else None
    except Exception:
        return None


def ensure_certs(ips, host):
    """Local CA + server certificate for this Mac's current names. Regenerated if they change."""
    os.makedirs(CERT_DIR, exist_ok=True)
    ca_key, ca_crt = os.path.join(CERT_DIR, "stillpoint-local-ca.key"), os.path.join(CERT_DIR, "stillpoint-local-ca.crt")
    key, crt = os.path.join(CERT_DIR, "server.key"), os.path.join(CERT_DIR, "server.crt")
    names = sorted(set(["localhost"] + ([host] if host else [])))
    sans = ",".join([f"DNS:{n}" for n in names] + [f"IP:{ip}" for ip in sorted(set(ips + ["127.0.0.1"]))])
    stamp = os.path.join(CERT_DIR, "sans.txt")

    def openssl(*a):
        subprocess.run(["openssl", *a], check=True, capture_output=True)

    if not (os.path.exists(ca_key) and os.path.exists(ca_crt)):
        print("Creating a local certificate authority (only this Mac has its key)…")
        openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", ca_key, "-out", ca_crt, "-days", "825",
                "-subj", "/CN=Stillpoint local development CA",
                "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0", "-addext", "keyUsage=critical,keyCertSign,cRLSign",
                # Limit what this CA can vouch for to local names and private addresses, so even
                # if its key leaked it could not impersonate a public website to the phone.
                "-addext", "nameConstraints=critical,permitted;DNS:local,permitted;DNS:localhost,"
                           "permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,"
                           "permitted;IP:192.168.0.0/255.255.0.0,permitted;IP:127.0.0.0/255.0.0.0")
        os.chmod(ca_key, 0o600)
    current = open(stamp).read() if os.path.exists(stamp) else ""
    if current != sans or not os.path.exists(crt):
        csr = os.path.join(CERT_DIR, "server.csr")
        ext = os.path.join(CERT_DIR, "server.ext")
        with open(ext, "w") as f:
            f.write(f"subjectAltName={sans}\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\nbasicConstraints=CA:FALSE\n")
        openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", csr, "-subj", "/CN=Stillpoint on this Mac")
        # iOS rejects server certificates valid for more than 825 days.
        openssl("x509", "-req", "-in", csr, "-CA", ca_crt, "-CAkey", ca_key, "-CAcreateserial", "-out", crt, "-days", "397", "-extfile", ext)
        os.chmod(key, 0o600)
        with open(stamp, "w") as f:
            f.write(sans)
    return crt, key


def main():
    ap = argparse.ArgumentParser(description="Serve the Stillpoint web port on the local network.")
    ap.add_argument("--port", type=int, default=8000, help="plain HTTP port (default 8000)")
    ap.add_argument("--https", action="store_true", help="also serve over HTTPS with a local certificate")
    ap.add_argument("--https-port", type=int, default=8443)
    ap.add_argument("--diag", action="store_true", help="accept diagnostics posted to /__diag")
    ap.add_argument("--verbose", action="store_true", help="log every request")
    ap.add_argument("--bind", default="0.0.0.0")
    a = ap.parse_args()
    Handler.diag, Handler.verbose = a.diag, a.verbose
    ips, host = lan_addresses(), local_hostname()
    servers = []
    http_srv = ThreadingHTTPServer((a.bind, a.port), Handler)
    http_srv.daemon_threads = True
    servers.append(http_srv)
    if a.https:
        crt, key = ensure_certs(ips, host)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(crt, key)
        https_srv = ThreadingHTTPServer((a.bind, a.https_port), Handler)
        https_srv.daemon_threads = True
        https_srv.socket = ctx.wrap_socket(https_srv.socket, server_side=True)
        servers.append(https_srv)
    print("\nStillpoint web is running. On your iPhone (same Wi-Fi), open in Safari:\n")
    for ip in ips:
        print(f"    http://{ip}:{a.port}/")
    if host:
        print(f"    http://{host}:{a.port}/")
    if a.https:
        print("\n  HTTPS (Home Screen app with offline support):\n")
        for ip in ips:
            print(f"    https://{ip}:{a.https_port}/")
        if host:
            print(f"    https://{host}:{a.https_port}/")
        first = ips[0] if ips else host
        print(f"\n  First time on HTTPS: open http://{first}:{a.port}/https.html on the phone to install this Mac's certificate.")
    print(f"\n  On this Mac: http://localhost:{a.port}/")
    print("\n  Keep this window open; the Mac stays awake while it runs. Ctrl-C to stop.\n", flush=True)
    for srv in servers[1:]:
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
