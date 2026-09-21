#!/usr/bin/env bash
# 本地预览服务器（禁缓存）。
# 为什么需要它：python -m http.server 不发缓存头，Chrome 会按启发式缓存 JS，
# 于是改了 prototype/*.js 刷新页面却仍在跑旧代码 —— 排查方向会被彻底带偏。
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8099}"
python3 - "$PORT" <<'PY'
import sys, http.server, socketserver, functools

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *a):
        pass

port = int(sys.argv[1])
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', port), functools.partial(NoCache)) as httpd:
    print(f'✓ 预览服务器（禁缓存）：http://127.0.0.1:{port}/prototype/battlefield.html')
    print('  Ctrl+C 停止')
    httpd.serve_forever()
PY
