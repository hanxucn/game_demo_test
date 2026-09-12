#!/usr/bin/env python3
"""
把截图转成"可读的文字"——给没有图像输入能力的模型当眼睛用。

输出：
  1. 亮度 ASCII 图（自动对比度拉伸，能看出布局结构）
  2. 九宫格区域统计（平均亮度 / 饱和度 / 平均色）
  3. 主色板（k-means）
  4. 可选：局部裁剪分析（--crop x,y,w,h）

用法：
  python3 tools/see.py .screenshots/battlefield-736x414.png
  python3 tools/see.py shot.png 92
  python3 tools/see.py shot.png 92 --crop 180,60,120,90
"""
import sys
from collections import Counter

import numpy as np
from PIL import Image

RAMP = " .:-=+*#%@"


def parse_args(argv):
    path = argv[1]
    cols = 92
    crop = None
    for a in argv[2:]:
        if a.startswith("--crop="):
            crop = tuple(int(v) for v in a.split("=", 1)[1].split(","))
        elif a.isdigit():
            cols = int(a)
    return path, cols, crop


def stretch(arr, lo_pct=2, hi_pct=98):
    lo, hi = np.percentile(arr, lo_pct), np.percentile(arr, hi_pct)
    if hi - lo < 1e-6:
        return np.zeros_like(arr)
    return np.clip((arr - lo) / (hi - lo), 0, 1)


def luminance_map(img, cols, do_stretch=True):
    w, h = img.size
    rows = max(1, round(cols * (h / w) / 2.05))
    small = img.convert("L").resize((cols, rows), Image.LANCZOS)
    a = np.asarray(small, dtype=np.float32) / 255.0
    if do_stretch:
        a = stretch(a)
    lines = []
    for r in range(rows):
        lines.append("".join(RAMP[min(len(RAMP) - 1, int(v * len(RAMP)))] for v in a[r]))
    return lines, a


def region_stats(img, grid=3):
    w, h = img.size
    rgb = np.asarray(img.convert("RGB"), dtype=np.float32)
    hsv = np.asarray(img.convert("HSV"), dtype=np.float32)
    out = []
    for gy in range(grid):
        for gx in range(grid):
            x0, x1 = int(w * gx / grid), int(w * (gx + 1) / grid)
            y0, y1 = int(h * gy / grid), int(h * (gy + 1) / grid)
            block = rgb[y0:y1, x0:x1]
            bsat = hsv[y0:y1, x0:x1, 1]
            mean = block.reshape(-1, 3).mean(axis=0)
            out.append((
                f"({gx},{gy})",
                block.mean() / 255,
                bsat.mean() / 255,
                "#%02x%02x%02x" % tuple(int(c) for c in mean),
            ))
    return out


def palette(img, k=8, sample=40000):
    rgb = np.asarray(img.convert("RGB"), dtype=np.float32).reshape(-1, 3)
    if len(rgb) > sample:
        idx = np.linspace(0, len(rgb) - 1, sample).astype(int)
        rgb = rgb[idx]
    rng = np.random.default_rng(42)
    centers = rgb[rng.choice(len(rgb), k, replace=False)].copy()
    lab = np.zeros(len(rgb), dtype=int)
    for _ in range(12):
        d = ((rgb[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        lab = d.argmin(axis=1)
        for i in range(k):
            m = lab == i
            if m.any():
                centers[i] = rgb[m].mean(axis=0)
    counts = Counter(lab.tolist())
    total = sum(counts.values())
    return [("#%02x%02x%02x" % tuple(int(v) for v in centers[i]), c / total)
            for i, c in counts.most_common()]


def tonal_report(img):
    """整体色调分布——判断是否'一团糊'。"""
    g = np.asarray(img.convert("L"), dtype=np.float32) / 255.0
    hist, _ = np.histogram(g, bins=10, range=(0, 1))
    hist = hist / hist.sum()
    print("--- 亮度直方图（10 档）---")
    for i, v in enumerate(hist):
        lo, hi = i / 10, (i + 1) / 10
        print(f"  {lo:.1f}-{hi:.1f}  {v * 100:5.1f}%  {'#' * int(v * 60)}")
    p5, p50, p95 = np.percentile(g, [5, 50, 95])
    print(f"  分位数：P5={p5:.3f}  P50={p50:.3f}  P95={p95:.3f}  动态范围={p95 - p5:.3f}")
    print(f"  低于 0.2 的像素占比：{(g < 0.2).mean() * 100:.1f}%")
    print(f"  高于 0.6 的像素占比：{(g > 0.6).mean() * 100:.1f}%")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    path, cols, crop = parse_args(sys.argv)
    img = Image.open(path)
    label = path
    if crop:
        img = img.crop((crop[0], crop[1], crop[0] + crop[2], crop[1] + crop[3]))
        label += f"  crop={crop}"

    print(f"=== {label}  {img.size[0]}x{img.size[1]} ===")
    print()
    print("--- 亮度图（对比度已拉伸；. 最暗 → @ 最亮）---")
    for line in luminance_map(img, cols)[0]:
        print(line)
    print()
    region_stats(img)
    print("--- 九宫格区域统计 ---")
    for name, lum, sat, hexc in region_stats(img):
        print(f"  {name:>5}  亮度 {lum:5.3f} {'#' * int(lum * 24):<24} 饱和 {sat:5.3f}  {hexc}")
    print()
    tonal_report(img)
    print()
    print("--- 主色板（k-means, 8 色）---")
    for hexc, ratio in palette(img):
        print(f"  {hexc}  {ratio * 100:5.1f}%")


if __name__ == "__main__":
    main()
