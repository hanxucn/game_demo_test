#!/usr/bin/env bash
# 常驻调试用 Chrome —— chrome-devtools-mcp 需要它
#
# 为什么需要：chrome-devtools-mcp 自己启动的浏览器会随 MCP 连接断开而销毁
#（DSH 的 MCP 客户端每次调用后断连），表现为 new_page 成功但后续调用报 "No page found"。
# 连到外部常驻 Chrome 即可解决。
#
# 用法：
#   ./tools/chrome-debug.sh &        # 启动（默认 9222 端口）
#   ./tools/chrome-debug.sh 9333 &   # 换端口（记得同步 cordis.patch.yml 的 --browserUrl）
set -euo pipefail
PORT="${1:-9222}"
CHROME="${CHROME_BIN:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || { echo "找不到 Chrome：$CHROME（可用 CHROME_BIN 指定）" >&2; exit 1; }
echo "调试 Chrome 启动中，端口 $PORT"
exec "$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
  --remote-debugging-port="$PORT" --user-data-dir="/tmp/chrome-dsh-$PORT" about:blank
