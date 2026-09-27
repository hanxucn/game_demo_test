# 已退役：草稿层 → cards.yaml 的生成链

这三个脚本在 **ADR-091**（2026-09-27）之前是卡牌数据的主链：

```
data/transcribe/*.yaml                 手写稿转录（冻结）
  → data/cards_photo.draft.yaml        应用决策后的卡池      ← merge-photos.py
  → data/cards_v1.draft.yaml           归一化前卡池          ← gen-cards-v1.py
  → data/cards.yaml                    ★ 唯一真源            ← promote-cards.py
```

**为什么退役**：`promote-cards.py` 会从 `cards_v1.draft.yaml` **重建整张卡表**（重排序 + 覆盖
所有字段）。只要有人直接改 `data/cards.yaml`（例如 teammate 加魏国人物那次），
下一次重建就会把那些改动**静默抹掉** —— 留下一堆看不出原因的失败测试。

**现在**：`data/cards.yaml` 直接手改，`bash tools/build-cards.sh` 只做"校验 + 导出"，
唯一由工具维护的是 `value:` 核算块（`tools/apply-values.py`，逐张就地替换、不重建）。

**这三个脚本保留在这里**只为回溯：需要查"某张卡的数值当初是从哪张照片、哪条决策来的"时，
`data/cards_photo.draft.yaml` / `data/cards_v1.draft.yaml` / `data/cards_decisions.draft.yaml`
连同这些脚本仍在 git 历史与工作区里。**不要**在正常流程里再跑它们。
