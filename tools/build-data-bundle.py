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
    cards = json.loads((DATA / "cards.json").read_text(encoding="utf-8"))
    heroes = json.loads((DATA / "heroes.json").read_text(encoding="utf-8"))
    payload = {"cards": cards, "heroes": heroes}
    OUT.write_text(
        "// 自动生成，勿手改：python3 tools/build-data-bundle.py\n"
        "window.GameData = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    print(f"✓ {OUT.relative_to(ROOT)}  ({len(cards)} 卡 + {len(heroes)} 主公)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
