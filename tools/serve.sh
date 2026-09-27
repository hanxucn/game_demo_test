#!/usr/bin/env bash
# 本地启动（一条命令）：静态页面 + 卡组 API。
#
# 卡组存 `server/game.db` —— 关掉再开、换浏览器、换机器都还在。
#
# 用法：
#   bash tools/serve.sh              # 完整服务（推荐）
#   bash tools/serve.sh 9000         # 指定起始端口（被占会自动往后找）
#   bash tools/serve.sh --static     # 纯静态预览：不提供 /api，卡组退化为存浏览器
#   停止：Ctrl+C，或 pkill -f "server/index.mjs"
#
# 依赖只有 **Node**（≥22.18）：
#   · node:sqlite 是内置模块，不需要 npm install
#   · 服务端直接 import core 的 .ts 复用组卡规则，需要默认开启的类型剥离
#   · core/data/*.json 已入库，新 clone 下来就有，不用先跑 python
#
# 为什么不再自己写一套静态服务：原先这里是 python 的 http.server，它**不提供 /api**，
# 于是「只开 serve.sh」时卡组只能退化成存浏览器 localStorage（换端口/换浏览器就没了）。
# 为了「一条命令就有持久化」，改成委托给 node 服务 —— 它本来就是静态能力的超集。
# 而原本 python 那两个便利行为（端口被占自动往后找、重复启动直接给地址）已经搬进
# server/index.mjs，所以这里的体验不变。
set -euo pipefail
cd "$(dirname "$0")/.."

# ---------- 纯静态预览（逃生口）：用于验证「没有服务端时页面能不能用」 ----------
if [ "${1:-}" = "--static" ]; then
  shift
  PORT="${1:-8099}"
  exec python3 -u - "$PORT" dsh-serve-prototype <<'PY'
import sys, socket, http.server, socketserver, functools

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *a):
        pass

def probe(port):
    """→ (本项目服务已在跑, 端口空闲)。端口被别的程序占用时两者都是 False。"""
    with socket.socket() as s:
        s.settimeout(0.4)
        if s.connect_ex(('127.0.0.1', port)) != 0:
            return False, True
    try:
        import urllib.request
        with urllib.request.urlopen(
                f'http://127.0.0.1:{port}/prototype/battlefield.html', timeout=1) as r:
            body = r.read(4096).decode('utf-8', 'replace')
        return ('酒话三国' in body or 'battlefield' in body), False
    except Exception:
        return False, False

def free_port(start, limit=20):
    for p in range(start, start + limit):
        if probe(p)[1]:
            return p
    return None

start = int(sys.argv[1])
ours, is_free = probe(start)

if ours:
    print('✓ 预览服务已经在跑了，直接用：')
    print(f'    http://127.0.0.1:{start}/prototype/battlefield.html')
    print('  （想重启：pkill -f dsh-serve-prototype 之后再跑一次）')
    sys.exit(0)

port = start if is_free else free_port(start + 1)
if port is None:
    print(f'✗ 从 {start} 起连续 20 个端口都被占用，换个起始端口试试：'
          f'bash tools/serve.sh --static 9000', file=sys.stderr)
    sys.exit(1)
if port != start:
    print(f'⚠ 端口 {start} 被其他程序占用，改用 {port}')

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', port), functools.partial(NoCache)) as httpd:
    print(f'⚠ 纯静态模式（无卡组 API）：http://127.0.0.1:{port}/prototype/battlefield.html')
    print('  卡组会存在浏览器里，换端口/换浏览器就看不到')
    print('  Ctrl+C 停止')
    httpd.serve_forever()
PY
fi

# ---------- 默认：完整服务（静态 + 卡组 API） ----------
PORT="${1:-8099}"
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 找不到 node。本服务需要 Node ≥22.18（node:sqlite 内置 + 直接 import core 的 .ts）。" >&2
  echo "  想纯静态预览（卡组存浏览器）：bash tools/serve.sh --static" >&2
  exit 1
fi
exec env PORT="$PORT" node server/index.mjs
