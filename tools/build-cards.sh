#!/usr/bin/env bash
# 卡牌数据：校验 + 导出（ADR-091 / ADR-092）
#
# ⚠️ 本脚本**只读** data/cards.yaml —— 不生成、不回写、不改其中任何内容。
#     它做三件事：把 YAML 导成引擎读的 JSON、校验数据、重建浏览器产物。
#     卡牌数据完全由人维护：加卡/改数值/改技能都直接改 data/cards.yaml 即可，
#     不需要为了"保持数据一致"跑任何脚本。
#
# 三步：
#   ① 导出运行时 JSON（cards.yaml → core/data/*.json）
#   ② 校验（结构 / 字段白名单 / 注册表 / 命名 / 类型定型 / 文案与效果一致性）
#   ③ 重建浏览器产物（data.bundle.js + core.bundle.js）
set -euo pipefail
cd "$(dirname "$0")/.."

# 提醒：提交前的自动防线（仓库卫生 + 产物重建）靠 git hook，而 hook 要装一次。
# 没装的话，下面这些检查不会在 `git commit` 时自动跑 —— 这里替它喊一声。
# （本脚本被 .githooks/pre-commit 调用时，hooksPath 已是 .githooks，因此不会重复提醒。）
if [ "$(git config core.hooksPath 2>/dev/null || true)" != ".githooks" ]; then
  echo "⚠ core.hooksPath 未设为 .githooks —— 提交前的自动防线不会生效。装一次即可："
  echo "    cd core && npm install        # 或：git config core.hooksPath .githooks"
  echo
fi

echo "① 导出运行时 JSON（data/*.yaml → core/data/*.json）"
python3 tools/yaml2json.py

echo "② 校验 data/cards.yaml"
(cd core && npm run validate --silent)

echo "③ 重建浏览器产物"
python3 tools/build-data-bundle.py
(cd core && npm run build:browser --silent)

echo
echo "✓ 完成（data/cards.yaml 未被改动）。接着跑："
echo "   cd core && npm test && npm run typecheck && npm run validate && npm run verify:dsl && npm run smoke"
