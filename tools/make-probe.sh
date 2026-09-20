#!/usr/bin/env bash
# 由 battlefield.html 生成临时探针页 prototype/_probe.html
# 探针 = 正式页 + 自动走完「阵营→构筑→换牌→开战」的脚本，用于截图核对中局画面。
# 探针是生成物，勿手改；改了 battlefield.html 后重跑本脚本即可同步。
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=prototype/_probe.html
python3 - "$OUT" <<'PY'
import pathlib, sys
src = pathlib.Path('prototype/battlefield.html').read_text(encoding='utf-8')
drive = pathlib.Path('tools/probe-autodrive.js').read_text(encoding='utf-8')
assert '</body>' in src, 'battlefield.html 缺少 </body>'
out = src.replace('</body>', '<script>\n' + drive + '\n</script>\n</body>')
pathlib.Path(sys.argv[1]).write_text(out, encoding='utf-8')
print('✓ 已生成 ' + sys.argv[1])
PY
