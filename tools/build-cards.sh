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
