#!/usr/bin/env bash
# 卡牌数据全链重建（改完 data/*.yaml 后跑这个，不要手改中间产物）
#
# 六层数据流：
#   data/transcribe/*.yaml            原始手写稿转录（冻结，不参与重建）
#     → data/cards_decisions.draft.yaml   设计者决策（数值 / 技能 / DSL / 平衡）
#     → data/cards_photo.draft.yaml       应用决策后的卡池
#     → data/cards_v1.draft.yaml          归一化前卡池
#     → data/cards.yaml                   ★ 唯一真源（含派生 value 块）
#     → core/data/*.json                  引擎运行时数据
#
# value 块是派生数据，所以入库要跑两遍 promote：先出 cards.yaml，算出核算块，再并回去。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "① 应用设计决策 → cards_photo.draft.yaml"
python3 tools/merge-photos.py

echo "② 归一化 → cards_v1.draft.yaml"
python3 tools/gen-cards-v1.py

echo "③ 入库（第一遍，不含 value） → data/cards.yaml"
python3 tools/promote-cards.py

echo "④ 导出运行时 JSON"
python3 tools/yaml2json.py

echo "⑤ 计算 value 核算块"
node --experimental-strip-types core/tools/emit-values.ts

echo "⑥ 并入 value 块（第二遍）"
python3 tools/promote-cards.py

echo "⑦ 重新导出运行时 JSON（带上 value）"
python3 tools/yaml2json.py

echo "⑧ 重建浏览器产物"
python3 tools/build-data-bundle.py
(cd core && npm run build:browser --silent)

echo
echo "✓ 完成。接着跑： cd core && npm test && npm run typecheck && npm run validate && npm run verify:dsl && npm run smoke"
