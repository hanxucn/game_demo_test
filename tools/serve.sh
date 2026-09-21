#!/usr/bin/env bash
# 本地预览服务器（禁缓存）。
#
# 为什么需要它：python -m http.server 不发缓存头，Chrome 会按启发式缓存 JS，
# 于是改了 prototype/*.js 刷新页面却仍在跑旧代码 —— 排查方向会被彻底带偏。
#
# 用法：
#   bash tools/serve.sh            # 默认 8099；已被本项目占用则直接给地址，被别的程序占用则自动换端口
#   bash tools/serve.sh 9000       # 指定起始端口
#   停止：pkill -f dsh-serve-prototype
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8099}"

# 末尾那个标记参数只为让进程可被 pkill -f dsh-serve-prototype 找到
# （python3 子进程的命令行里不会有 "serve.sh"，只杀 bash 包装进程会留下占着端口的孤儿）
python3 -u - "$PORT" dsh-serve-prototype <<'PY'
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
    # 重复启动不该甩一个 traceback 出来 —— 直接告诉人地址就行
    print('✓ 预览服务已经在跑了，直接用：')
    print(f'    http://127.0.0.1:{start}/prototype/battlefield.html')
    print('  （想重启：pkill -f dsh-serve-prototype 之后再跑一次）')
    sys.exit(0)

port = start if is_free else free_port(start + 1)
if port is None:
    print(f'✗ 从 {start} 起连续 20 个端口都被占用，换个起始端口试试：'
          f'bash tools/serve.sh 9000', file=sys.stderr)
    sys.exit(1)
if port != start:
    print(f'⚠ 端口 {start} 被其他程序占用，改用 {port}')

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', port), functools.partial(NoCache)) as httpd:
    print(f'✓ 预览服务器（禁缓存）：http://127.0.0.1:{port}/prototype/battlefield.html')
    print('  Ctrl+C 停止')
    httpd.serve_forever()
PY
