#!/usr/bin/env python3
"""
Nexus Demo Server
A minimal HTTP server bundled with the Electron app.
Usage: python3 server.py [port]
"""

import json
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
import psutil


class NexusHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default access log noise; errors still go to stderr
        pass

    def _send_json(self, status: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/ping":
            self._send_json(200, {
                "status": "ok",
                "message": "Nexus Python server is running!",
                "timestamp": int(time.time() * 1000),
                "port": self.server.server_address[1],
            })
        elif self.path == "/info":
            mem = psutil.virtual_memory()
            self._send_json(200, {
                "name": "nexus",
                "version": "0.1.0",
                "python": sys.version,
                "platform": sys.platform,
                "cpu_percent": psutil.cpu_percent(interval=0.1),
                "memory": {
                    "total_mb": round(mem.total / 1024 / 1024),
                    "used_mb": round(mem.used / 1024 / 1024),
                    "percent": mem.percent,
                },
            })
        else:
            self._send_json(404, {"error": "Not found", "path": self.path})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = HTTPServer(("127.0.0.1", port), NexusHandler)
    print(f"[Nexus] Server started on http://127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[Nexus] Server stopped", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
