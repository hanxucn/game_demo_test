#!/usr/bin/env python3
"""
照片转录批次合并 + 完整性检查

用法：
  python3 tools/merge-photos.py            # 检查 + 合并 data/transcribe/batch_*.yaml
  python3 tools/merge-photos.py --check    # 只检查，不写文件

做三件事：
  1. 覆盖率：编号 45–160（116 张）是否每张都恰好出现一次（漏号 / 重号 / 越界都报出来）
  2. 合并：按编号升序写入 data/cards_photo.draft.yaml（带来源注释头）
  3. 汇总：统计卡牌 / 非卡牌、以及所有 uncertain 疑点清单

本文件产物是**原样识图录入**，不是规范数据；整理进 cards.yaml 前不做任何改写。
"""
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("需要 PyYAML：pip install pyyaml", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "data" / "transcribe"
OUT = ROOT / "data" / "cards_photo.draft.yaml"
DECISIONS = ROOT / "data" / "cards_decisions.draft.yaml"
QOUT = ROOT / "data" / "cards_photo.QUESTIONS.md"
RESEARCH = ROOT / "docs" / "research" / "sanguo-role-classification.yaml"
TODO = ROOT / "data" / "cards_todo.draft.yaml"

FIRST, LAST = 45, 160
EXPECTED = [str(n) for n in range(FIRST, LAST + 1)]

# 设计者已确认的非卡牌照片（不参与卡池，仅保留出处）
#   45 = 便签，写着 6915-1668 / xhykcd，与卡牌无关
KNOWN_NONCARDS = {"45"}


def load_batches() -> tuple[list[dict], list[str]]:
    rows: list[dict] = []
    problems: list[str] = []
    files = sorted(SRC_DIR.glob("batch_*.yaml"))
    if not files:
        print(f"没有找到批次文件：{SRC_DIR}/batch_*.yaml", file=sys.stderr)
        sys.exit(1)
    for f in files:
        data = yaml.safe_load(f.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            problems.append(f"{f.name}: 顶层不是列表（得到 {type(data).__name__}）")
            continue
        for i, row in enumerate(data):
            if not isinstance(row, dict) or "photo" not in row:
                problems.append(f"{f.name}: 第 {i+1} 条缺少 photo 字段")
                continue
            row["_batch"] = f.name
            rows.append(row)
    return rows, problems


def is_card(row: dict) -> bool:
    """判定一条记录是不是卡牌。

    不能只看 name：#160 这类草稿只有类型「步兵」、没写卡名，也算卡牌；
    而 #45 便签只有 note，任何卡牌字段都为空。
    """
    return any(row.get(k) not in (None, "", 0) for k in
               ("name", "card_type", "cost", "attack", "health", "skill_name", "skill_text"))


def report_duplicates(cards: list[dict]) -> None:
    """近重复检测：原稿里有重抄件（同一张卡被写了两遍、拍了两张）。

    判据：同卡名（缺失时退化为类型）+ 同阵营，且技能描述归一化后相似度 ≥ 0.85。
    只报告、不合并——是否真是同一张卡由设计者定夺。
    """
    import difflib
    import re

    def norm(s: str) -> str:
        return re.sub(r"[\s，。、；：,.;:!？?（）()〈〉【】\[\]「」…\-—~～]", "", s or "")

    groups: dict[tuple, list[dict]] = {}
    for c in cards:
        label = c.get("name") or c.get("card_type") or ""
        key = (norm(c.get("faction") or ""), norm(label))
        groups.setdefault(key, []).append(c)

    found = False
    for (fac, name), members in groups.items():
        if not name or len(members) < 2:
            continue
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                a, b = members[i], members[j]
                ta, tb = norm(a.get("skill_text") or ""), norm(b.get("skill_text") or "")
                ratio = difflib.SequenceMatcher(None, ta, tb).ratio() if (ta or tb) else 1.0
                if ratio >= 0.85:
                    if not found:
                        print("─" * 56)
                        print("疑似重复卡（原稿重抄件，需设计者确认是否并为一张）：")
                        found = True
                    flag = "完全相同" if ta == tb else f"相似度 {ratio:.0%}"
                    print(f"  #{a['photo']} ≈ #{b['photo']}  {fac or '—'}·{name}  ({flag})")
                    if ta != tb:
                        sm = difflib.SequenceMatcher(None, ta, tb)
                        for tag, i1, i2, j1, j2 in sm.get_opcodes():
                            if tag != "equal":
                                print(f"      差异: #{a['photo']}「{ta[i1:i2] or '（空）'}」 vs "
                                      f"#{b['photo']}「{tb[j1:j2] or '（空）'}」")
    if not found:
        print("✓ 未发现疑似重复卡")

    # 同名多版本：同一人物/卡名被设计了两遍以上，但效果不同（不是重抄，是两套方案）
    multi = {k: v for k, v in groups.items() if len(v) > 1 and k[1]}
    dup_pairs = set()
    for members in multi.values():
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                ta = norm(members[i].get("skill_text") or "")
                tb = norm(members[j].get("skill_text") or "")
                if difflib.SequenceMatcher(None, ta, tb).ratio() >= 0.85:
                    dup_pairs.add(frozenset((id(members[i]), id(members[j]))))
    multi = {
        k: v for k, v in multi.items()
        if not all(frozenset((id(v[i]), id(v[j]))) in dup_pairs
                   for i in range(len(v)) for j in range(i + 1, len(v)))
    }
    if multi:
        print("─" * 56)
        print("同名多版本（同一人物有多套设计，需设计者定夺保留哪套）：")
        for (fac, name), members in sorted(multi.items(), key=lambda kv: kv[0][1]):
            ids = "、".join(f"#{m['photo']}" for m in sorted(members, key=lambda m: str(m["photo"])))
            skills = " / ".join((m.get("skill_name") or "无技能名") for m in members)
            print(f"  {fac or '—'}·{name}  {len(members)} 版：{ids}")
            print(f"      技能名：{skills}")


def load_decisions() -> dict:
    """读取设计者决策层。没有该文件时返回空决策（纯原样转录）。"""
    if not DECISIONS.exists():
        return {}
    return yaml.safe_load(DECISIONS.read_text(encoding="utf-8")) or {}


def apply_decisions(rows: list[dict], dec: dict) -> list[dict]:
    """把设计者决策覆盖到转录行上。

    原则：**只覆盖被明确决策的字段**，原值保留在 `<field>_original`，
    覆盖依据记在 `decisions` 里，绝不静默改数。
    """
    by = {str(r["photo"]): r for r in rows}
    applied: list[str] = []

    for ov in dec.get("overrides") or []:
        row = by.get(str(ov["photo"]))
        if row is None:
            applied.append(f"✗ 覆盖失效：找不到 #{ov['photo']}")
            continue
        field = ov["field"]
        old = row.get(field)
        row[f"{field}_original"] = old
        row[field] = ov["value"]
        row.setdefault("decisions", []).append(
            f"{field}: {old} → {ov['value']}（{ov.get('adr', '')}）；{ov.get('reason', '').strip()}"
        )
        applied.append(f"#{ov['photo']} {field}: {old} → {ov['value']}")

    for dup in dec.get("duplicates") or []:
        row = by.get(str(dup["drop"]))
        if row is None:
            continue
        row["duplicate_of"] = dup["keep"]
        row["duplicate_confirmed"] = bool(dup.get("confirmed"))
        if dup.get("confirmed"):
            applied.append(f"#{dup['drop']} 已确认与 #{dup['keep']} 重复，合并稿中剔除")
        else:
            applied.append(f"#{dup['drop']} 标记为 #{dup['keep']} 的疑似重抄件（未确认，保留）")

    # 称号栏其实是技能名：card_type → skill_name（设计者确认，ADR-022）
    REAL_TYPES = ("谋", "医", "传", "步兵", "主公", "计", "事件", "战术", "弓")
    for t in dec.get("title_to_skill") or []:
        row = by.get(str(t["photo"]))
        if row is None:
            applied.append(f"✗ 称号搬运失效：找不到 #{t['photo']}")
            continue
        skill = (t.get("skill_name") or "").strip()
        if not skill:
            applied.append(f"#{t['photo']} 未搬运（设计者标注为草稿/无技能名）")
            continue
        row["skill_name_original"] = row.get("skill_name") or ""
        row["skill_name"] = skill
        old_type = (row.get("card_type") or "").strip()
        if old_type and not any(old_type.startswith(x) for x in REAL_TYPES):
            row["card_type_original"] = old_type
            row["card_type"] = ""
            applied.append(f"#{t['photo']} {t.get('name', '')}：称号「{old_type}」→ 技能名「{skill}」（类型栏本就空）")
        else:
            applied.append(f"#{t['photo']} {t.get('name', '')}：技能名 = 「{skill}」")
        if t.get("skill_text_confirmed"):
            row["skill_text_confirmed"] = t["skill_text_confirmed"]
        if t.get("note"):
            row.setdefault("notes", []).append(t["note"])

    # 移出卡池（设计者决定，如主公卡不进可用卡池）
    for ex in dec.get("excluded") or []:
        row = by.get(str(ex["photo"]))
        if row is None:
            continue
        row["excluded"] = True
        row["exclude_reason"] = f"{ex.get('reason', '')}（{ex.get('adr', '')}）"
        applied.append(f"#{ex['photo']} 移出卡池：{ex.get('reason', '')[:40]}")

    # 未定稿标记：只加标注，不改原文
    for dm in dec.get("draft_marks") or []:
        row = by.get(str(dm["photo"]))
        if row is None:
            continue
        row.setdefault("draft_marks", []).append(
            f"{dm.get('field', '')} = {dm.get('value', '（原文）')}｜未定稿：{dm.get('reason', '')}"
        )
        row["is_draft"] = True

    return applied


def build_merged_characters(rows: list[dict], dec: dict) -> list[dict]:
    """同一人物的多套设计 → 合并成一条记录，两套技能都保留（ADR-017）。"""
    by = {str(r["photo"]): r for r in rows}
    out = []
    for grp in dec.get("character_merges") or []:
        variants = []
        for ph in grp["variants"]:
            r = by.get(str(ph))
            if r is None:
                continue
            variants.append({
                "photo": r["photo"],
                "cost": r.get("cost"),
                "attack": r.get("attack"),
                "health": r.get("health"),
                "skill_name": r.get("skill_name") or "",
                "skill_text": r.get("skill_text") or "",
                "uncertain": r.get("uncertain") or [],
            })
        if not variants:
            continue
        out.append({
            "name": grp["name"],
            "faction": grp.get("faction") or variants[0].get("faction") or "",
            "type": "general",
            "status": "待决策（两套设计并存，见 ADR-017）",
            "sources": [v["photo"] for v in variants],
            "memo": grp.get("memo", ""),
            "variants": variants,
        })
    return out


def write_questions(rows: list[dict], dec: dict) -> None:
    """生成「待确认清单」——只列**仍然没解决**的问题。

    判定「已解决」：该卡该字段在决策层里有覆盖 / 被标为 not_applicable。
    """
    by = {str(r["photo"]): r for r in rows}
    resolved: dict[str, set] = {}
    for ov in dec.get("overrides") or []:
        resolved.setdefault(str(ov["photo"]), set()).add(ov["field"])
    for t in dec.get("title_to_skill") or []:
        resolved.setdefault(str(t["photo"]), set()).update({"card_type", "skill_name"})
    for dm in dec.get("draft_marks") or []:
        resolved.setdefault(str(dm["photo"]), set()).add(dm.get("field", ""))
    na: dict[str, set] = {}
    for x in dec.get("not_applicable") or []:
        na[str(x["photo"])] = set(x["fields"])

    NONCHAR = ("计", "事件", "战术", "传")
    ischar = lambda r: not any((r.get("card_type") or "").startswith(x) for x in NONCHAR)

    L = ["# 卡牌照片转录 · 待确认清单（自动生成）\n",
         "> 由 `python3 tools/merge-photos.py --questions` 从 `data/cards_decisions.draft.yaml` 派生。",
         "> **已经答过的条目不会再出现**——回答请改决策层，不要改这里。",
         "> 完整原始转录与历史疑点见 `data/cards_photo.draft.yaml` 的 `uncertain` 字段。\n"]

    L.append("## 一、待你拍板的设计问题\n")
    items = dec.get("open_items") or []
    if items:
        L.append("| # | 问题 |")
        L.append("|---|---|")
        for it in items:
            L.append(f"| {it['id']} | {it['question']} |")
    else:
        L.append("（无）")
    L.append("")

    chars = [r for r in rows if ischar(r) and (r.get("name") or r.get("card_type"))]
    L.append("## 二、需要你补的数值（人物卡；非人物卡已按 ADR-025 排除）\n")
    L.append("| 字段 | 仍需补 | 编号 |")
    L.append("|---|---|---|")
    for f, label in (("cost", "统率值（费用）"), ("attack", "攻击力"), ("health", "生命值")):
        miss = [r for r in chars
                if r.get(f) in (None, "") and f not in na.get(str(r["photo"]), set())]
        miss.sort(key=lambda r: int(r["photo"]))
        nums = "、".join(f"#{r['photo']}{r.get('name') or r.get('card_type')}" for r in miss)
        L.append(f"| {label} | {len(miss)} | {nums or '—'} |")
    L.append("")

    L.append("## 三、仍未解决的辨认疑点\n")
    left = 0
    L.append("| 照片 | 卡 | 字段 | 疑点 |")
    L.append("|---|---|---|---|")
    for ph, r in sorted(by.items(), key=lambda kv: int(kv[0])):
        done = resolved.get(ph, set())
        label = f"{r.get('faction') or '—'}·{r.get('name') or r.get('card_type') or '?'}"
        for u in r.get("uncertain") or []:
            field = u.split("：")[0].strip() if "：" in u[:16] else ""
            if field and (field in done or field in na.get(ph, set())):
                continue
            if not field and done:
                continue
            left += 1
            L.append(f"| #{ph} | {label} | {field or '—'} | {u.replace('|', '／')} |")
    L.append("")
    if left == 0:
        L.append("（无）\n")

    QOUT.write_text("\n".join(L), encoding="utf-8")
    print(f"✓ 已写入 {QOUT.relative_to(ROOT)}（待拍板 {len(items)} 条 / 未解决疑点 {left} 处）")


def classify_types(rows: list[dict], dec: dict) -> dict:
    """按 ADR-018 给人卡定型：攻击 > 1 → 武将；≤ 1 且史实非武将 → 谋臣。

    史实身份来自 docs/research/sanguo-role-classification.yaml（48 人，已查证演义原文）。
    只为**没有明确类型**或**与规则冲突**的卡写 type_proposed，供设计者复核。
    """
    research = {}
    if RESEARCH.exists():
        research = {x["name"]: x for x in yaml.safe_load(RESEARCH.read_text(encoding="utf-8"))}

    na: dict[str, set] = {}
    for x in dec.get("not_applicable") or []:
        na[str(x["photo"])] = set(x["fields"])

    forced: dict[str, str] = {}
    for x in dec.get("type_overrides") or []:
        for ph in x["photos"]:
            forced[str(ph)] = x["type"]

    REAL = {"谋": "谋臣", "医": "谋臣", "传": "谋臣", "主公": "主公",
            "步兵": "兵种", "弓": "兵种", "计": "计谋卡", "事件": "事件卡",
            "战术": "战法卡"}
    flagged, blocked = [], []
    for r in rows:
        name = r.get("name")
        if str(r["photo"]) in KNOWN_NONCARDS:
            r["type_proposed"] = "非卡牌（设计者确认忽略）"
            continue
        if str(r["photo"]) in forced:
            r["type_proposed"] = forced[str(r["photo"])]
            r["type_reason"] = "非人物卡（见决策层 type_overrides）"
            continue
        ct = (r.get("card_type") or "").strip()
        cur = next((v for k, v in REAL.items() if ct.startswith(k)), None)
        atk = r.get("attack")
        info = research.get(name)

        if cur in ("计谋卡", "事件卡", "战法卡", "兵种") and not atk:
            r["type_proposed"] = cur          # 非人卡：直接用原稿类型
            r["type_reason"] = "非人物卡，不参与武将/谋臣定型"
            continue
        if atk is None:
            if "attack" in na.get(str(r["photo"]), set()):
                r["type_proposed"] = cur or "（不适用）"
                continue
            r["type_proposed"] = "（待攻击力）"
            blocked.append(r)
            continue
        if atk > 1:
            prop, why = "武将", f"攻击 {atk} > 1（ADR-018 规则）"
        elif cur == "谋臣":
            # 原稿已标谋臣，且攻击 ≤ 1，符合上限——保持，不算冲突
            prop, why = "谋臣", f"原稿已标谋臣，攻击 {atk} ≤ 1 符合上限（ADR-018）"
        elif info and info["role"] == "谋臣":
            prop, why = "谋臣", f"攻击 {atk} ≤ 1，且演义身份为谋臣/非武将（{info['confidence']}置信度）"
        elif info:
            prop, why = "武将", f"攻击 {atk} ≤ 1，但演义身份为武将（{info['confidence']}置信度）"
        else:
            prop, why = "（需人工判断）", "攻击 ≤ 1 且不在研究名单内"
        r["type_proposed"] = prop
        r["type_reason"] = why
        if cur and cur != prop:
            r["type_conflict"] = f"原稿标「{cur}」，规则判「{prop}」"
            flagged.append(r)
    return {"flagged": flagged, "blocked": blocked}


def write_todo(rows: list[dict], dec: dict) -> None:
    """生成「填空清单」——设计者只需在 answer 字段填内容。

    覆盖三类缺口：文案里的【?】、缺失数值、以及被标为未定稿的项。
    """
    import re
    na = {str(x["photo"]): set(x["fields"]) for x in dec.get("not_applicable") or []}
    resolved: dict[str, set] = {}
    for ov in dec.get("overrides") or []:
        resolved.setdefault(str(ov["photo"]), set()).add(ov["field"])
    PAT = re.compile(r"【[^】]*】|█")

    out = []
    for r in sorted(rows, key=lambda r: int(r["photo"])):
        ph = str(r["photo"])
        if r.get("type_proposed") == "非卡牌（设计者确认忽略）" or r.get("excluded"):
            continue
        qs = []

        # ① 文案里的占位符——带上下文，便于定位（skill_text 已被覆盖则跳过）
        text = r.get("skill_text") or ""
        for m in ([] if "skill_text" in resolved.get(ph, set()) else PAT.finditer(text)):
            a, b = max(0, m.start() - 14), min(len(text), m.end() + 14)
            ctx = ("…" if a else "") + text[a:b] + ("…" if b < len(text) else "")
            frag = m.group()
            if frag == "█":
                qs.append(f"技能描述「{ctx}」中 █ 处的数字/字是什么？")
            elif "涂改" in frag:
                qs.append(f"技能描述「{ctx}」中被涂改的部分，原文应该是什么？")
            elif "插字" in frag:
                qs.append(f"技能描述「{ctx}」中的插字，是否确认为正文？")
            else:
                qs.append(f"技能描述「{ctx}」中 {frag} 处读不出的字是什么（或整句本意）？")

        # ② 缺失数值（跳过 not_applicable；ADR-025：非人物卡不问攻血）
        NONPERSON = ("事件卡", "计谋卡", "战法卡", "兵种", "属性卡", "临时卡")
        is_person = (r.get("type_proposed") or "") in ("武将", "谋臣", "主公")
        fields = [("cost", "统率值(费用)")]
        if is_person:
            fields += [("attack", "攻击力"), ("health", "生命值")]
        cur = {k: r.get(k) for k in ("cost", "attack", "health")}
        for f, label in fields:
            if r.get(f) in (None, "") and f not in na.get(ph, set()):
                qs.append(f"{label}是多少？（现有 cost/attack/health = {cur}）")

        # ③ 未定稿标记
        for dm in r.get("draft_marks") or []:
            fld = dm.split("=")[0].strip()
            if fld in resolved.get(ph, set()):
                continue
            qs.append(f"未定稿项定下来了吗？{dm}")

        if qs:
            out.append({
                "photo": r["photo"],
                "name": r.get("name") or r.get("card_type") or "（无名）",
                "faction": r.get("faction") or "",
                "type": r.get("type_proposed") or "",
                "skill_name": r.get("skill_name") or "",
                "skill_text": text,
                "questions": [{"q": q, "answer": ""} for q in qs],
            })

    header = "\n".join([
        "# ============================================================",
        "# 待补清单 —— 你只需在每条的 answer 字段填内容",
        "# ============================================================",
        "# 生成：python3 tools/merge-photos.py --todo",
        "# 填完告诉我，我会解析本文件、写进决策层（cards_decisions.draft.yaml），",
        "#       然后重新生成合并稿。**不要直接改 cards_photo.draft.yaml**。",
        "#",
        "# 填写示例：",
        "#     - q: 统率值(费用)是多少？（现有 ...）",
        "#       answer: \"4\"",
        "#     - q: 技能描述「…进入禁用状态【?】一回合…」中 【?】 处读不出的字？",
        "#       answer: \"就是逗号，原文是「进入禁用状态，一回合」\"",
        "#",
        "# 拿不准的可以留空或写「未定」，我会跳过。",
        "",
    ]) + "\n"
    TODO.write_text(header + yaml.dump({"todo": out}, allow_unicode=True, sort_keys=False,
                                       default_flow_style=False, width=1000), encoding="utf-8")
    nq = sum(len(x["questions"]) for x in out)
    print(f"✓ 已写入 {TODO.relative_to(ROOT)}（{len(out)} 张卡 / {nq} 个待答问题）")

def main() -> int:
    check_only = "--check" in sys.argv
    rows, problems = load_batches()
    dec = load_decisions()
    applied = apply_decisions(rows, dec)
    typing = classify_types(rows, dec)

    seen: dict[str, list[str]] = {}
    for r in rows:
        seen.setdefault(str(r["photo"]), []).append(r["_batch"])

    missing = [p for p in EXPECTED if p not in seen]
    extra = [p for p in seen if p not in EXPECTED]
    dups = {p: v for p, v in seen.items() if len(v) > 1}

    print(f"\n批次文件 {len(set(r['_batch'] for r in rows))} 个，条目 {len(rows)} 条")
    print("─" * 56)
    print(f"应有编号 {FIRST}–{LAST}，共 {len(EXPECTED)} 张")
    print(f"实际覆盖 {len(seen) - len(extra)} 张")
    if missing:
        print(f"✗ 漏号 {len(missing)} 张：{'、'.join(missing)}")
    if extra:
        print(f"✗ 越界编号 {len(extra)} 张：{'、'.join(sorted(extra))}")
    if dups:
        for p, where in sorted(dups.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else 0):
            print(f"✗ 重号 {p}：出现在 {', '.join(where)}")
    if problems:
        for p in problems:
            print(f"✗ {p}")
    if not (missing or extra or dups or problems):
        print("✓ 覆盖率完整：116 张全部有且仅有一条记录")

    cards = [r for r in rows if is_card(r)]
    noncards = [r for r in rows if not is_card(r)]
    known = [r for r in noncards if str(r["photo"]) in KNOWN_NONCARDS]
    odd = [r for r in noncards if str(r["photo"]) not in KNOWN_NONCARDS]
    print("─" * 56)
    print(f"卡牌 {len(cards)} 条 / 非卡牌 {len(noncards)} 条")
    if known:
        print(f"  已确认非卡牌（设计者确认忽略，仅留出处）：{'、'.join(str(r['photo']) for r in known)}")
    if odd:
        print(f"  ⚠ 额外非卡牌（需确认）：{'、'.join(str(r['photo']) for r in odd)}")

    suspects = [(r["photo"], u) for r in rows for u in (r.get("uncertain") or [])]
    print(f"疑点 {len(suspects)} 处，涉及 {len(set(p for p, _ in suspects))} 张")

    report_duplicates(cards)

    if applied:
        print("─" * 56)
        print(f"已应用设计者决策 {len(applied)} 条（来源 {DECISIONS.name}）：")
        for a in applied:
            print(f"  · {a}")

    drafts = [r for r in rows if r.get("is_draft")]
    if drafts:
        print("─" * 56)
        print(f"未定稿标记 {len(drafts)} 张（原稿带问号或设计者自标暂定）：")
        for r in sorted(drafts, key=lambda r: int(r["photo"])):
            for dm in r.get("draft_marks") or []:
                print(f"  #{r['photo']} {r.get('name') or r.get('card_type') or ''} · {dm}")

    if typing["flagged"] or typing["blocked"]:
        print("─" * 56)
        print(f"定型需复核：冲突 {len(typing['flagged'])} 张 / 待攻击力 {len(typing['blocked'])} 张")
        for r in sorted(typing["flagged"], key=lambda r: int(r["photo"])):
            print(f"  ⚠️ #{r['photo']} {r.get('name') or r.get('card_type') or '（无名）'}：{r['type_conflict']}")
        for r in sorted(typing["blocked"], key=lambda r: int(r["photo"])):
            print(f"  ? #{r['photo']} {r.get('name') or r.get('card_type') or '（无名）'}：攻击力未定，定型阻塞")

    merged = build_merged_characters(rows, dec)
    if merged:
        print("─" * 56)
        print(f"合并人物 {len(merged)} 人（多套设计并存，两套技能都保留）：")
        for m in merged:
            skills = " ｜ ".join(f"#{v['photo']}〈{v['skill_name'] or '无技能名'}〉" for v in m["variants"])
            print(f"  {m['faction']}·{m['name']}：{skills}")

    if "--questions" in sys.argv:
        write_questions(rows, dec)

    if "--todo" in sys.argv:
        write_todo(rows, dec)

    if not check_only and not ({"--questions", "--todo"} & set(sys.argv)):
        ordered = sorted(rows, key=lambda r: int(r["photo"]) if str(r["photo"]).isdigit() else 9999)
        for r in ordered:
            r.pop("_batch", None)
        header = (
            "# ============================================================\n"
            "# 卡牌照片识图录入（原样转录 + 设计者决策覆盖）\n"
            "# ============================================================\n"
            "# 来源：~/Downloads/cards_pic/ 微信图片_<时间戳>_<编号>_123.jpg\n"
            "#       ⚠️ 时间戳分两组，按固定前缀匹配会漏文件，务必用通配：\n"
            "#          20260911215734 → 编号 45–143（99 张）\n"
            "#          20260911215831 → 编号 144–160（17 张）\n"
            "# 生成：python3 tools/merge-photos.py（**本文件是生成的，勿手改**）\n"
            "#\n"
            "# 两层结构：\n"
            "#   · 原始转录（transcribe/batch_*.yaml）—— 永久冻结，逐字照抄，作为证据\n"
            "#   · 设计者决策（cards_decisions.draft.yaml）—— 覆盖层，记录后来决定了什么\n"
            "#   本文件 = 两者合并的结果。要改数值请改决策层，不要改这里。\n"
            "#\n"
            "# 字段约定：\n"
            "#   · skill_text 保留原文（含错别字、口语、涂改），未翻译成游戏术语\n"
            "#   · 认不准的字用【?】占位，疑点记在 uncertain 字段\n"
            "#   · 被决策覆盖过的字段，原值保留在 <字段>_original，依据记在 decisions\n"
            "#   · 不参与构建（*.draft.yaml 会被 tools/yaml2json.py 跳过）\n"
            "\n"
        )
        payload = {"cards": ordered, "merged_characters": merged,
                   "open_items": dec.get("open_items") or []}
        OUT.write_text(header + yaml.dump(payload, allow_unicode=True, sort_keys=False,
                                          default_flow_style=False, width=1000), encoding="utf-8")
        print(f"\n✓ 已写入 {OUT.relative_to(ROOT)}（{len(ordered)} 条 + {len(merged)} 组合并人物）")

    return 1 if (missing or extra or dups or problems) else 0


if __name__ == "__main__":
    sys.exit(main())
