#!/usr/bin/env bash
# 启动原型的静态服务器
#
# 为什么需要：Playwright MCP 默认禁用 file:// 协议，自动化测试必须走 HTTP。
# 顺带解决 file:// 下 fetch 本地 JSON 被 CORS 拦截的问题。
#
# 用法：
#   ./tools/serve-prototype.sh          # 默认 8123 端口，前台运行
#   ./tools/serve-prototype.sh 9000     # 指定端口
#   PORT=9000 ./tools/serve-prototype.sh
#
# 后台运行：
#   ./tools/serve-prototype.sh > /tmp/proto.log 2>&1 &
#
# 然后：
#   http://127.0.0.1:<port>/battlefield.html
#   http://127.0.0.1:<port>/card-gallery.html

set -euo pipefail

PORT="${1:-${PORT:-8123}}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/prototype"

if [ ! -d "$DIR" ]; then
  echo "找不到原型目录：$DIR" >&2
  exit 1
fi

# 端口占用检查
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "端口 $PORT 已被占用。换一个：./tools/serve-prototype.sh 8124" >&2
  exit 1
fi

echo "原型服务器已启动"
echo "  战场：    http://127.0.0.1:$PORT/battlefield.html"
echo "  卡面画廊：http://127.0.0.1:$PORT/card-gallery.html"
echo "  风格实验室：http://127.0.0.1:$PORT/style-lab.html"
echo "  Ctrl-C 停止"
echo

cd "$DIR"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
