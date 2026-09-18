"""Tiny static server with the MIME types this app needs.

Python's stdlib http.server emits .mjs as text/plain, which Chromium browsers
refuse to execute as ES modules. This wrapper registers the right types.
"""
import os
import sys
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

mimetypes.add_type('text/javascript', '.mjs')
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('application/wasm', '.wasm')

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
os.chdir(os.path.dirname(os.path.abspath(__file__)))

with ThreadingHTTPServer(('127.0.0.1', port), SimpleHTTPRequestHandler) as srv:
    print(f"Serving {os.getcwd()} on http://127.0.0.1:{port}/", flush=True)
    print(f"Open:    http://127.0.0.1:{port}/index.html", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
