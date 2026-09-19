# 对局架子：现状盘点与缺口清单

> 生成日期：2026-09-12
> 对应目标：把 122 张卡升为正式数据 + 让完整对局架子跑起来
> 验证命令：`cd core && npm test && npm run typecheck && npm run validate && npm run verify:dsl && npm run smoke`

## 1. 已经打通的链路

```
组卡 → 起牌 → 对战 → 技能释放 → 结束
```

| 环节 | 实现位置 | 状态 |
|---|---|---|
| 组卡 | `core/src/deck.ts` | ✅ 30 张 / 单阵营+中立 / 同名上限 2 / 非法类型排除；`autoDeck` 保证合法 |
| 起牌 | `core/src/setup.ts`、`core/src/state.ts` | ✅ 掷点定先手（D6 平局重掷）→ 酒令三选一 → 换牌（换 N 补 N，每方一次）→ 后手补传国玉玺 |
| 对战 | `core/src/engine.ts` | ✅ 23 步时机表、5 列×2 排、架盾优先级、伤害重定向、光环重算 |
| 技能释放 | `core/src/effects.ts`、`core/src/rules.ts` | ✅ 主动技 / 触发技 / 光环；主动技频率（每回合 1 次）已强制 |
| 结束 | `core/src/result.ts`、`core/src/mutate.ts` | ✅ 主将阵亡即时判定；40 回合上限比血量；对局摘要与单行战报 |
| 酒令 | `core/src/jiuling.ts`、`data/jiuling.yaml` | ✅ 4 个酒令挂在 4 个 hook 上，在 hook 形状内新增只改数据 |

**实测证据**（无头驱动 `prototype/*.bundle.js`，即 HTML 真正加载的那份产物）：

- 6 组阵营对局 × 3 个 seed = **18/18 局全部正常收束**（主将阵亡或回合上限），无死循环、无动作被拒
- 一局覆盖 **26 种事件类型**：`TURN_START / CARD_DRAWN / CARD_PLAYED / UNIT_SUMMONED / UNIT_TRANSFORMED / ATTACK_DECLARED / CLASH / DAMAGE / HEAL / UNIT_DIED / STATUS_APPLIED / STATUS_EXPIRED / JIULING_TRIGGERED / GAME_OVER` 等
- 回放一致性：同 seed 重放全部动作，状态逐字段一致（`npm run smoke`）

## 2. 缺口清单

### 2.1 阻塞对局体验（建议优先级最高）

| # | 缺口 | 影响 | 现状 |
|---|---|---|---|
| G-1 | **构筑界面** | 玩家只能用 `autoDeck` 自动组卡，无法自己选 30 张 | `validateDeck` 已就绪，缺 UI |
| G-2 | **换牌交互** | 引擎支持 `mulligan`，但原型不传 `mulliganIndices`，玩家没机会换 | 缺 UI；引擎侧已可用 |
| G-3 | **酒令选择交互** | 原型从 localStorage 取或默认取候选第一个，没有三选一界面 | `offerJiuling` 已就绪，缺 UI |
| G-4 | **战斗动画** | 事件流已产出 26 种事件，客户端只做了状态重绘 | 缺动画层；`docs/gdd/15-card-visual.md` |
| G-5 | **Cocos 客户端** | 目前只有 HTML 原型（`prototype/battlefield.html`） | `client/` 未建 |

### 2.2 引擎能力缺口

| # | 缺口 | 说明 |
|---|---|---|
| G-6 | **3 个动作注册但未实现** | `remove_status`（驱散）、`move`（换位）、`random_pick` 在 `ACTIONS` 里但 `effects.ts` 没有 `case`。`remove_status` 已计价（2/层），华佗「青囊」依赖它 |
| G-7 | **`restrict` 字段缺失** | 步兵 / 机械哨兵 / 机械守卫 / 架盾 4 张的文案是纯限制（"不能攻击敌方主帅"），schema 无处承载，`validate` 报 warn（ADR-045） |
| G-8 | **弃牌只作用于手牌** | 司马懿文案②③（"使敌方卡池随机丢弃一张"）与左慈（"移到对方卡池"）需要**牌库**弃牌，`discard` 目前只动 `hand` |
| G-9 | **左慈「兼通星纬」错译** | 文案是"查看对方手牌并移一张"，DSL 却是"看自己牌库顶放牌库底"；且"血量降为 0 回牌库底"无对应 effect |
| G-10 | **司马懿 ②③ 无 effect** | 文案三条，YAML 只落了 ① |
| G-11 | **"指定弃哪张手牌"无待选机制** | 多个效果需要玩家在手牌里选一张（左慈、部分事件卡），引擎只有"选场上单位"的 `chosen` |
| G-12 | **`on_attack` / `on_defend` 时机未接入** | 7 个触发时机里 5 个已接；这两个仍缺（程普「持重」用了 `on_attack`） |
| G-13 | **羁绊系统未实现** | `docs/gdd/09-bonds.md` 已设计，无 `data/bonds.yaml`、无引擎支持 |

### 2.3 数据与工具缺口

| # | 缺口 | 说明 |
|---|---|---|
| G-14 | **108 张卡缺 `memo`** | AGENTS.md 要求"每张卡必须填 memo"，校验器暂未强制 |
| G-15 | **稀有度（S/A/B）无字段** | `docs/design-review-SAB.md` 的分级没进 schema；「煮酒论英雄」的"史诗卡"因此只能近似实现 |
| G-16 | **3 个人物未建卡** | 夏侯恩 / 孙桓 / 祖茂（设计已在 `docs/design-review-SAB.md`） |
| G-17 | **`keywords.json` 导出不全** | `yaml2json.py` 只取顶层键，`keywords.yaml` 是 `{keywords, forbidden_combos}` 结构，导出只有 2 条。引擎实际读 `constants.ts`，所以暂不影响运行 |
| G-18 | **5 张卡故意无效果** | 陈到「白毦兵」、曹彰「猛袭」、步兵、机械哨兵、机械守卫（前两张待设计，后三张是限制型文案） |

### 2.4 平衡

**当前 `npm run validate` = 0 错误 / 178 警告**。偏差全部收敛进 ±3，但警告里仍有 178 条"建议复核"级（±1.5~±3），其中多数是刻意为之的"低属性 + 强技能"卡（见 `docs/gdd/13-balance-data-model.md` §7.5）。

本轮为达标所做的改动**全部记录在 `data/cards_decisions.draft.yaml` 的 `card_stats` 与 `dsl` 里**，每条都带 `reason`；重大结论见 ADR-046 / ADR-047。**这些数值是按当前度量算出来的，不是实机测出来的**——下一步应按 `docs/balance-backlog.md` 的优先级做实机校准。

## 3. 建议的下一步顺序

1. **G-6 + G-8 + G-11**：补 3 个动作 + 牌库弃牌 + 手牌待选机制。这一组解锁 G-9 / G-10，让左慈、司马懿、华佗三张卡真正可用。
2. **G-1 + G-2 + G-3**：构筑 / 换牌 / 酒令三个界面。引擎侧全部就绪，只差 UI。
3. **G-14 + G-15**：补 memo 与稀有度字段，让卡池数据完整。
4. **G-4**：动画层，决定原型是否够用还是要直接进 Cocos。
5. **G-7 + G-12 + G-13**：`restrict` 字段、两个触发时机、羁绊系统。

## 4. 本轮新发现并修掉的引擎 bug（都已加回归测试）

| bug | 症状 | 影响面 |
|---|---|---|
| **主动技频率未实现** | `useUnitSkill` 从不检查 `frequency`，0 费主动技可无限使用 | 7 个主动技全是 0 费 → AI 死循环（seed=7 卡在第 10 回合 4000 步），真人则无限收益。已把判定下沉到 `rules.ts` 的 `canUseUnitSkill`，**AI 与引擎同源** |
| **`skills[].chance` 未参与估值** | 50% 的免死按 100% 计价 | 夏侯惇「血战」、周泰「不屈」等被高估 |
| **`transform` 固定 4 分** | 不读进化前后属性差与单位数 | 公孙瓒/马腾/高顺从同记 +5.0 分化；**公孙瓒方向原本是反的** |
| **AOE 被按单体计价** | `target.count: 'all'` 只算 1 个目标 | 14 张 AOE 卡；且不能一律按满场算（相邻最多 2 个、带标签的子集更少），已改为按 filter 选择性取名义值 |
| **弃自己的牌记成正收益** | `discard` 不分弃谁的牌，一律 +1.5/张 | 马谡"抽2弃2"净手牌为 0 却被记 +9.0（单卡最大假溢价） |
| **`value_from_discarded` 记 0 分** | 已实现的机制完全不计价 | 程昱核心机制白送 |
| **`modify` 永久属性被 ×1.5** | 印刷属性 1 分、技能给的永久属性 1.5 分 | 郭淮「据守」等被高估；已改为永久 ×1.0、临时 ×0.7 |
