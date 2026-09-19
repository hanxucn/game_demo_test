#!/usr/bin/env python3
"""
卡池入库：cards_v1.draft.yaml → data/cards.yaml

做四件事：
  1. **归一化 skills**：把草稿里的 skills[].dsl 摊平成正式 schema 的 SkillDef[]，
     并把展示用文案挂在每个技能的 text 上（卡面/详情面板要读）
  2. **剥离草稿字段**：_meta / source / flags / dsl_status / note / dsl 等一律不写入真源
  3. **保留正式字段**：id/name/faction/type/cost/attack/health/troopKind/keywords/tags/
     skills/effects/cost_rule/memo/flavor
  4. **按 GDD 排序**：阵营 → 类型 → 费用 → id，便于人读

⚠️ 本脚本**覆盖** data/cards.yaml。后者是唯一真源，运行前请确保 git 干净。

用法：
  python3 tools/promote-cards.py            # 归一化并写入
  python3 tools/promote-cards.py --check    # 只报告会写入什么，不落盘
"""
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("需要 PyYAML：pip install pyyaml", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "cards_v1.draft.yaml"
DST = ROOT / "data" / "cards.yaml"

# 只保留这些正式字段（草稿专用字段一律丢弃）
KEEP = ("id", "name", "faction", "type", "cost", "attack", "health",
        "troopKind", "keywords", "tags", "memo", "flavor", "cost_rule")

FACTION_ORDER = {"shu": 0, "wei": 1, "wu": 2, "qun": 3, "neutral": 4}
TYPE_ORDER = {"lord": 0, "general": 1, "strategist": 2, "troop": 3,
              "elite": 4, "token": 5, "tactic": 6, "event": 7, "special": 8, "status": 9}


def normalize(card: dict) -> dict:
    """草稿卡 → 正式卡"""
    out = {k: card[k] for k in KEEP if k in card and card[k] not in (None, "", [])}
    # 数值字段即使是 0 也要保留（0 攻的谋臣、0 费卡）
    for k in ("cost", "attack", "health"):
        if k in card and card[k] is not None:
            out[k] = card[k]
    out["keywords"] = list(card.get("keywords") or [])
    if card.get("tags"):
        out["tags"] = list(card["tags"])

    # skills：摊平 dsl；无 dsl 的区分「卡级效果已翻译」与「效果待设计」
    has_card_effect = bool(card.get("effects"))
    skills_out = []
    for sk in card.get("skills") or []:
        dsl = sk.get("dsl")
        if dsl:
            for d in dsl:
                entry = dict(d)
                if sk.get("text"):
                    entry["text"] = sk["text"]
                skills_out.append(entry)
        elif sk.get("name") or sk.get("text"):
            entry = {"id": sk.get("id") or "", "name": sk.get("name") or ""}
            if sk.get("text"):
                entry["text"] = sk["text"]
            # 「效果已可用」的三种情况不算 pending：
            #   ① 卡级 effects 已翻译 ② 卡带 keywords（技能即该关键词，如「舍身」=架盾）
            #   ③ 卡带 cost_rule（技能即条件费用规则，如丁奉）④ 属性/状态定义卡
            has_mechanic = (has_card_effect
                            or bool(card.get("keywords"))
                            or bool(card.get("cost_rule"))
                            or card.get("type") == "status")
            if not has_mechanic:
                entry["pending"] = True
            skills_out.append(entry)
    if skills_out:
        out["skills"] = skills_out

    # 卡级效果（计策/事件/属性卡）
    if card.get("effects"):
        out["effects"] = card["effects"]

    out["memo"] = card.get("memo") or ""
    out["flavor"] = card.get("flavor") or ""
    return out


def main() -> int:
    check = "--check" in sys.argv
    doc = yaml.safe_load(SRC.read_text(encoding="utf-8"))
    cards = [normalize(c) for c in doc["cards"]]

    cards.sort(key=lambda c: (
        FACTION_ORDER.get(c["faction"], 9),
        TYPE_ORDER.get(c["type"], 9),
        c.get("cost") or 0,
        c["id"],
    ))

    pending = [c for c in cards if any(s.get("pending") for s in c.get("skills") or [])]
    no_skill = [c for c in cards if not c.get("skills") and not c.get("effects")]

    print(f"待入库 {len(cards)} 张")
    print(f"  · 技能已翻译/已定义：{len(cards) - len(pending) - len(no_skill)}")
    print(f"  · 有技能名、效果待设计：{len(pending)} → {'、'.join(c['name'] for c in pending)}")
    print(f"  · 无技能（白板/关键词/纯属性）：{len(no_skill)}")

    if check:
        print("\n（--check 模式，未写盘）")
        return 0

    header = """# ============================================================
# 卡牌数据（唯一真源）
# ============================================================
#
# ⚠️ 本文件由 tools/promote-cards.py 从 cards_v1.draft.yaml 归一化生成。
#    要改卡牌数据，改**上游**再重新入库，不要直接手改本文件：
#      data/transcribe/*.yaml        原始手写稿转录（冻结）
#      data/cards_decisions.draft.yaml  设计者决策（数值/技能/DSL 翻译）
#      data/cards_v1.draft.yaml        归一化前的卡池
#
# 字段说明见 docs/gdd/05-cards.md §2；效果 DSL 见 docs/gdd/13-balance-data-model.md §7。
# 数值核算（属性 + 关键词 + 技能 ≈ 2×费用+1）见 ADR-043，
# 用 `cd core && npm run validate -- --verbose` 逐张打印。
#
# 技能里有 `pending: true` 的表示：技能名已定、效果待设计。
#
"""
    DST.write_text(header + yaml.dump(cards, allow_unicode=True, sort_keys=False,
                                      default_flow_style=False, width=1000), encoding="utf-8")
    print(f"\n✓ 已写入 {DST.relative_to(ROOT)}（{len(cards)} 张）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
