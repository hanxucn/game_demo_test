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
#   · 重建产物另需 python3 + PyYAML，以及 core/ 的 esbuild（cd core && npm install）
#
# 启动时会**先重建产物**（实测 ~0.5s）—— 见下面「为什么每次重建」。
#
# 为什么不再自己写一套静态服务：原先这里是 python 的 http.server，它**不提供 /api**，
# 于是「只开 serve.sh」时卡组只能退化成存浏览器 localStorage（换端口/换浏览器就没了）。
# 为了「一条命令就有持久化」，改成委托给 node 服务 —— 它本来就是静态能力的超集。
# 而原本 python 那两个便利行为（端口被占自动往后找、重复启动直接给地址）已经搬进
# server/index.mjs，所以这里的体验不变。
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="server"
if [ "${1:-}" = "--static" ]; then MODE="static"; shift; fi
PORT="${1:-8099}"

# ---------- 产物重建（两个模式共用） ----------
#
# 为什么是「每次重建」而不是「检测过期后再重建」：
#   全量重建实测只要 ~0.5s（yaml2json 0.12s + bundle 0.02s + esbuild 0.08s + 校验），
#   而"检测是否过期"要么靠 mtime（不可靠）、要么靠跟源比对（更慢）。既然重建几乎免费，
#   就直接重建 —— 这样**任何人用本入口启动，页面都不可能跑到旧引擎**。
#
# 为什么需要它（2026-09-27 实测的坑）：
#   teammate 的 PR #12 改了 core/src/*.ts 但**没重建** prototype/core.bundle.js 就提交了，
#   于是 main 上的页面跑的是**旧引擎 + 新数据**（缺 damaged 过滤器、lord_hp / lord_full_hp
#   条件），而且失败是**静默的** —— 页面照常打开、照常能玩，横跨 5 条提交、153 分钟无人发现。
#   对比：产物缺失时页面是**一片黑**（window.Core undefined），那是响亮的失败。
#   这个重建就是让"静默"变回"响亮"、并且直接修好它。
# ---------- 补齐本地协作配置（幂等、静默） ----------
# 三项 config 是各"机制"生效的前提，但存在**每个 clone 各自的 .git/config** 里、无法随仓库分发。
# 放在这里是因为**这是大家本来就会跑的命令**，不用额外记一条（npm install 的 prepare 也会配）。
#   core.hooksPath / merge.ours.driver / pull.rebase（后者不配，git ≥2.27 的 pull 会直接失败）
if [ "$(git config core.hooksPath 2>/dev/null || true)" != ".githooks" ]; then
  git config core.hooksPath .githooks 2>/dev/null || true
  echo "▸ 已启用提交/合并/推送钩子（core.hooksPath = .githooks）"
fi
if [ "$(git config merge.ours.driver 2>/dev/null || true)" != "true" ]; then
  git config merge.ours.driver true 2>/dev/null || true
  echo "▸ 已启用生成物自动合并（merge.ours.driver）"
fi
if [ "$(git config pull.rebase 2>/dev/null || true)" != "false" ]; then
  git config pull.rebase false 2>/dev/null || true
  echo "▸ 已设定 git pull 用 merge（pull.rebase = false）"
fi

build_ok=1
if [ ! -d core/node_modules ]; then
  echo "⚠ core/node_modules 不存在 —— 打包浏览器产物要 esbuild，先跑一次："
  echo "    cd core && npm install"
  build_ok=0
elif BUILD_OUT="$(bash tools/build-cards.sh 2>&1)"; then
  echo "✓ 产物已重建（~0.5s，与 data/*.yaml 和 core/src/*.ts 同步）"
else
  build_ok=0
fi
if [ "$build_ok" = 0 ]; then
  if [ "$MODE" = static ]; then
    # --static 的存在意义就是"不依赖构建链"地验证降级路径，所以这里只警告不拦
    echo "⚠ 产物未重建 —— 页面可能跑旧代码（--static 模式不拦这个）"
  else
    echo "✗ 产物重建失败，下面是原始报错："
    echo "$BUILD_OUT"
    echo
    echo "  常见原因：缺 PyYAML（pip install pyyaml）、或没装 core 的依赖（cd core && npm install）"
    echo "  想跳过重建直接起（页面可能跑旧代码）：bash tools/serve.sh --static"
    exit 1
  fi
fi

# ---------- 纯静态预览（逃生口）：用于验证「没有服务端时页面能不能用」 ----------
if [ "$MODE" = static ]; then
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
if ! command -v node >/dev/null 2>&1; then
  echo "✗ 找不到 node。本服务需要 Node ≥22.18（node:sqlite 内置 + 直接 import core 的 .ts）。" >&2
  echo "  想纯静态预览（卡组存浏览器）：bash tools/serve.sh --static" >&2
  exit 1
fi
exec env PORT="$PORT" node server/index.mjs
