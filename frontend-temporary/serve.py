#!/usr/bin/env python3
"""Simple HTTP server for frontend development."""
import http.server
import socketserver

PORT = 3000

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # CORS headers for API requests
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def do_GET(self):
        # SPA fallback - serve index.html for all routes
        if '.' not in self.path.split('/')[-1]:
            self.path = '/index.html'
        return super().do_GET()

import socket
hostname = socket.gethostname()
local_ip = socket.gethostbyname(hostname)
print(f"Starting server at http://0.0.0.0:{PORT}")
print(f"Local network: http://{local_ip}:{PORT}")
with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    httpd.serve_forever()
