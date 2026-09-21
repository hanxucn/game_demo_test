#!/usr/bin/env python3
"""
生成浏览器用的数据包：core/data/*.json → prototype/data.bundle.js

为什么需要：原型用 file:// 打开，fetch 本地 JSON 会被 CORS 拦掉，
所以把数据内联成一段 JS。改完 data/*.yaml 后要跑：

    python3 tools/yaml2json.py && python3 tools/build-data-bundle.py
    cd core && npm run build:browser
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "core" / "data"
OUT = ROOT / "prototype" / "data.bundle.js"


def main() -> int:
    def load(name: str) -> list:
        f = DATA / f"{name}.json"
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else []

    cards = load("cards")
    heroes = load("heroes")
    statuses = load("statuses")
    keywords = load("keywords")
    payload = {"cards": cards, "heroes": heroes, "statuses": statuses, "keywords": (keywords.get("keywords") if isinstance(keywords, dict) else keywords)}
    OUT.write_text(
        "// 自动生成，勿手改：python3 tools/build-data-bundle.py\n"
        "window.GameData = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print(f"✓ {OUT.relative_to(ROOT)}  ({len(cards)} 卡 + {len(heroes)} 主公 + {len(statuses)} 状态 + {len(keywords if isinstance(keywords, list) else keywords.get(chr(107)+chr(101)+chr(121)+chr(119)+chr(111)+chr(114)+chr(100)+chr(115), []))} 关键词)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
