#!/usr/bin/env bash
#
# 原型截图脚本（供具备视觉能力的模型自查界面）
#
# 用法：
#   ./prototype/shot.sh battlefield            # 默认 1200x700
#   ./prototype/shot.sh battlefield 736 414    # 按设计基准 1:1 截
#   ./prototype/shot.sh card-gallery 1400 1000
#   ./prototype/shot.sh style-lab 1400 900
#
# 输出：.screenshots/<page>-<w>x<h>.png
#
set -uo pipefail

PAGE="${1:-battlefield}"
CLEAN="${CLEAN:-0}"
W="${2:-1200}"
H="${3:-700}"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  echo "找不到 Chrome：$CHROME" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUFFIX=""; [ "$CLEAN" = "1" ] && SUFFIX="-clean"
OUT="$ROOT/.screenshots/${PAGE}-${W}x${H}${SUFFIX}.png"
mkdir -p "$ROOT/.screenshots"
rm -f "$OUT"

"$CHROME" --headless=old --disable-gpu --no-sandbox --no-first-run --hide-scrollbars \
  --user-data-dir="/tmp/cr-shot-$$" --window-size="${W},${H}" \
  --screenshot="$OUT" "file://$ROOT/prototype/${PAGE}.html${CLEAN:+?clean=1}" >/dev/null 2>&1 &
PID=$!

for _ in $(seq 1 20); do
  sleep 1
  [ -f "$OUT" ] && break
done
kill "$PID" 2>/dev/null || true
sleep 1

if [ -f "$OUT" ]; then
  echo "$OUT"
else
  echo "截图失败：$PAGE" >&2
  exit 1
fi
