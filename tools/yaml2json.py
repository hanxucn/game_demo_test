#!/usr/bin/env python3
"""
YAML → JSON 转换（策划编辑 YAML，引擎读 JSON）

用法：
  python3 tools/yaml2json.py                     # data/*.yaml → core/data/*.json
  python3 tools/yaml2json.py data/cards.yaml -o core/data/cards.json

依赖：PyYAML（macOS 自带 python3 通常已有；没有就 pip install pyyaml）
"""
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("需要 PyYAML：pip install pyyaml", file=sys.stderr)
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = ROOT / "data"
OUT_DIR = ROOT / "core" / "data"


def convert(src: Path, dst: Path) -> int:
    data = yaml.safe_load(src.read_text(encoding="utf-8"))
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    n = len(data) if isinstance(data, list) else len(data or {})
    print(f"✓ {src.relative_to(ROOT)} → {dst.relative_to(ROOT)}  ({n} 条)")
    return n


def main() -> int:
    args = sys.argv[1:]
    if args and not args[0].startswith("-"):
        src = Path(args[0])
        dst = Path(args[args.index("-o") + 1]) if "-o" in args else OUT_DIR / (src.stem + ".json")
        convert(src, dst)
        return 0

    files = sorted(SRC_DIR.glob("*.yaml"))
    files = [f for f in files if not f.name.endswith(".draft.yaml")]
    if not files:
        print(f"没有找到 YAML：{SRC_DIR}", file=sys.stderr)
        return 1
    for f in files:
        convert(f, OUT_DIR / (f.stem + ".json"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
