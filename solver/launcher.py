"""Legion Solver launcher.

When frozen by PyInstaller --onefile, the web/ folder is extracted to a temp
directory (sys._MEIPASS) at startup. This script:
  1. Picks a free local port (8765 by default, falls back if in use).
  2. Serves the extracted web/ assets with the right MIME types for .mjs / .wasm.
  3. Pops the default browser to the page.
  4. Runs until the console window is closed (or Ctrl-C).
"""
import sys
import os
import socket
import threading
import time
import webbrowser
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


def find_assets_dir():
    """Locate the web/ folder shipped alongside this script / executable."""
    if getattr(sys, 'frozen', False):
        base = sys._MEIPASS  # PyInstaller extraction dir
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    candidate = os.path.join(base, 'web')
    if os.path.isdir(candidate):
        return candidate
    # Fallback for --onedir: assets sit next to the .exe
    if getattr(sys, 'frozen', False):
        sibling = os.path.join(os.path.dirname(sys.executable), 'web')
        if os.path.isdir(sibling):
            return sibling
    raise FileNotFoundError('web/ assets not found')


def pick_port(preferred=8765):
    for port in (preferred, 8766, 8767, 8768, 8769, 8770):
        try:
            s = socket.socket()
            s.bind(('127.0.0.1', port))
            s.close()
            return port
        except OSError:
            continue
    # Last resort: ephemeral
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


def main():
    mimetypes.add_type('text/javascript', '.mjs')
    mimetypes.add_type('text/javascript', '.js')
    mimetypes.add_type('application/wasm', '.wasm')

    try:
        assets = find_assets_dir()
    except FileNotFoundError as e:
        print(f'ERROR: {e}')
        print('Press Enter to exit.')
        input()
        sys.exit(1)

    os.chdir(assets)
    port = pick_port()
    url = f'http://127.0.0.1:{port}/index.html'

    print('=' * 56)
    print('  Legion Solver')
    print('=' * 56)
    print(f'  Serving: {assets}')
    print(f'  URL:     {url}')
    print()
    print('  Close this window to stop the server.')
    print('=' * 56)

    def open_browser():
        time.sleep(0.5)  # give the server a moment to be ready
        try:
            webbrowser.open(url)
        except Exception as e:
            print(f'(could not auto-open browser: {e})')
            print(f'(open {url} manually)')

    threading.Thread(target=open_browser, daemon=True).start()

    server = ThreadingHTTPServer(('127.0.0.1', port), SimpleHTTPRequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
