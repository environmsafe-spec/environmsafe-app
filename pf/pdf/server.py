"""Tiny HTTP service around the renderer.

POST /render   body: document JSON   header: X-PDF-Key: <PDF_SERVICE_KEY>   ->  application/pdf
GET  /health   -> ok

Only the Supabase Edge Function `generate-pdf` calls this; it holds the shared key. The service
never sees the database or the storage bucket.
"""
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from es_pdf import render_document

KEY = os.environ.get('PDF_SERVICE_KEY', '')
MAX_BODY = 2 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    server_version = 'es-pdf/1'

    def _send(self, code: int, body: bytes, ctype: str = 'text/plain'):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            return self._send(200, b'ok')
        return self._send(404, b'not found')

    def do_POST(self):
        if self.path != '/render':
            return self._send(404, b'not found')
        if not KEY or not hmac.compare_digest(self.headers.get('X-PDF-Key', ''), KEY):
            return self._send(401, b'unauthorized')
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0 or length > MAX_BODY:
            return self._send(413, b'bad size')
        try:
            doc = json.loads(self.rfile.read(length))
            pdf = render_document(doc)
        except Exception as e:  # report the reason to the caller, never a stack trace
            return self._send(422, f'cannot render: {type(e).__name__}: {e}'.encode())
        return self._send(200, pdf, 'application/pdf')

    def log_message(self, fmt, *args):  # keep document contents out of logs
        print(f'{self.address_string()} {fmt % args}')


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8080'))
    print(f'es-pdf listening on {port}')
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
