# 待办：B 类技能（B-3 ~ B-11）+ 战吼前端

> 交接文档。上一轮（2026-09-12）已完成 B-1、B-2，剩余 8 项 + 前端交互。
> **上手先读**：`PROJECT_STATE.md` → `AGENTS.md` → 本文档 → `docs/skill-dsl-plan.md`

## 0. 当前状态（接手时请先复核）

| 项 | 值 |
|---|---|
| 分支 | `update_ui` |
| 最近提交 | `d209585 feat(core): on_kill 击杀时机 + 击杀者引用；录入华雄/马超（ADR-070）` |
| 测试 | `npm test` **153 通过 / 0 失败** |
| 卡池 | **122 张**（`core/data/cards.json`） |
| 校验 | `npm run validate` → 0 错误 / 178 警告 |
| DSL 验证 | `npm run verify:dsl` → **100 通过 / 0 失败** |

复核命令：
```bash
cd core && npm test && npm run typecheck && npm run validate && npm run verify:dsl && npm run smoke
```

## 1. 已完成（B-1 / B-2），不要重做

| 项 | 内容 | 提交 |
|---|---|---|
| B-1 | 技能禁用：关羽「水淹七军」（`jin_yong` 本就有 `block_skill`）；陈宫「忠烈」（新状态 `jin_gu` + 新条件 `chosen_side`）；**战吼可选目标**（`PLAY_CARD.target`）；修「文案被卡面覆盖」bug | `c59d952` |
| B-2 | `on_kill` 时机 + 击杀者引用（`TargetSelector.event`、`turn_max`、`victim_type` 条件）；华雄、马超 | `d209585` |

**已建立的挂载点约定（后续同类需求照此办理）**：
`mutate.ts` 不能 `import runEffects`（会与 `effects.ts` 形成循环依赖）。
需要从变更点触发 DSL 时，用**注册挂载点**模式：
```ts
// mutate.ts
export type OnXResolver = (...) => void;
let onXResolver: OnXResolver | null = null;
export function registerOnXResolver(fn: OnXResolver): void { onXResolver = fn; }

// effects.ts
registerOnXResolver((...) => { runEffects(...); });
```
现有三个：`registerOnDrawResolver` / `registerOnDeathResolver` / `registerOnKillResolver`。

---

## 2. 剩余任务（每项都必须带测试）

### B-3 抉择（二选一） — 曹彰、庞统

- **卡**：曹彰「将驰」上场时二选一（① 抽 1 张 ② 本回合攻击 +1）；庞统「凤雏」二选一（A 抽三张 / B 每回合抽一张）
- **缺**：DSL 无法表达"由玩家二选一"
- **建议做**：
  - `SkillDef` 加 `modes?: { name: string; effects: CardEffect[] }[]`（每个分支一组效果）
  - 动作 `PLAY_CARD` 加 `modeIndex?: number`（玩家选了哪个分支）
  - 引擎：取 `modes[modeIndex]` 执行；未指定时取 `modes[0]`（供 AI 与测试兜底）
  - 庞统 B 分支（每回合抽一张）需要 `turn_start` 触发，属于**跨时机的抉择**，建议拆分：A 用 `on_play`，B 挂一个 `turn_start` 且带"已选 B"的标记状态——**先与设计者确认**是否接受这种实现
- **测试**：`modeIndex: 0/1` 各走一遍，断言两条分支效果分别生效；越界 `modeIndex` 安全兜底
- **涉及文件**：`core/src/types.ts`、`core/src/engine.ts`、`core/src/effects.ts`、`data/cards_decisions.draft.yaml`、`docs/gdd/13-balance-data-model.md`（DSL 扩展必须先更新文档，见铁律 1）

### B-4 性别 + 相邻两人决斗 — 貂蝉

- **卡**：貂蝉「倾国倾城」选择两个**相邻**的**男性**角色决斗，拼点胜利互相攻击，失败则貂蝉回合结束阵亡
- **缺**：`filter` 无性别字段；`clash` 只支持"目标 vs 来源"，不支持"两个第三方单位互拼"
- **建议做**：
  - 数据层加 `gender: 'male' | 'female' | 'unknown'`（`CardDef` + `promote-cards.py` 的 `KEEP` 白名单！**不加白名单会被静默丢弃**——这是踩过的坑）
  - `TargetSelector.filter.gender`
  - `clash` 支持 `targetA` / `targetB` 两方（或新增 `clash_between`）
  - "失败则貂蝉回合结束阵亡" → `condition.event: clash_lost` + `destroy` 自身（`destroy` 已实现）
- **测试**：两个相邻男性才可选；同性/非相邻不可选；胜/负两条分支
- **注意**：`chance` 与拼点结果无关者不要混用；拼点走的 rng 必须来自 `state.rngState`（回放一致性）

### B-5 连续普通攻击 — 张苞

- **卡**：张苞「将风」战吼：挨个对攻 < 自己的敌方人物发动**普通攻击**，直到自己阵亡
- **缺**：需要"发起一次真正的普攻"（含正常反击），而不是 `damage`
- **建议做**：新增动作 `attack_each`（或 `repeat_attack`），内部**复用 `engine.ts` 的普攻结算路径**（不能复制一份，否则反击/圣盾/守护/饮血逻辑会漂移）
  - 建议把普攻结算抽成 `resolveAttack(state, ctx, from, to, events, rng)` 供两处共用
  - 目标集 = 敌方人物中 `atk < 自己 atk` 者；每次结算后检查自己是否存活，死了就停
- **测试**：反击伤害正确计入；张苞中途阵亡则停止后续攻击（断言剩余目标未受伤）

### B-6 掷骰子分支 — 魏延

- **卡**：魏延「桀骜不驯」掷骰：5–6 圣盾+冲锋 / 3–4 冲锋 / 1–2 回合结束消灭魏延并对主公 4 点
- **缺**：DSL 无"按随机点数分支"
- **建议做**：新增效果字段 `branches?: { min: number; max: number; effects: CardEffect[] }[]` + `dice?: number`（骰面），用 `rng.int(dice) + 1` 取点。**必须用 core 的 `Rng`**（禁 `Math.random()`）
- **测试**：用固定 seed 断言落在某个区间；三个区间各写一条（可用 `rng` 种子逼近或直接把 `branches` 抽成纯函数单测）
- **注意**：「冲锋」= 先攻（`xian_gong`），沿用既有关键词

### B-7 批量驱散 + 治疗值取统率值 — 华佗

- **卡**：华佗「青囊」弃 1 张手牌，指定一人物治疗并**清除负面**，治疗值 = 该人物**统率值**
- **缺**：① `remove_status` 只认具体状态 id，不支持"清掉所有 debuff"；② `heal` 无 `value_from: 'cost'`
- **建议做**：
  - `remove_status` 支持 `status: 'any_debuff'`（或新字段 `remove_kind: 'debuff'`）：遍历 `u.statuses`，对 `STATUSES[id].kind === 'debuff'` 的全部移除
  - `value_from_target: 'cost'` 或复用 `value_from_discarded` 的思路加 `value_from_target`
- **测试**：身上挂 3 个 debuff + 1 个 buff → 只清 debuff；治疗量等于目标 cost

### B-8 牺牲己方 + 按被牺牲卡血量取值 — 程昱

- **卡**：程昱「审时度势」每回合可选牺牲一名己方卡牌，将其**血量最大值**恢复给指定人物，并对随机敌人造成**牺牲卡牌当时血量**的伤害
- **缺**：需要一个"先选中己方单位 → 销毁它 → 用它的属性做后续数值"的链式效果
- **建议做**：新增 `sacrifice` 动作：销毁目标并把它的 `maxHp` / `hp` 写入 `ctx.flags`（如 `sacrificed_max_hp:6`），后续效果用既有的 `value_from_flag`（已实现！）取用
- **测试**：牺牲 6 血单位 → 治疗量 6、伤害量 = 牺牲时的当前血量（受伤后应更小）

### B-9 授予亡语 — 陆抗

- **卡**：陆抗「谦冲如常」使指定一人物获得亡语（阵亡后回到主公手牌）
- **缺**：无法把 `on_death` 效果挂到别的单位上
- **建议做**：`Unit` 加 `grantedDeaths?: CardEffect[]`；`killUnit` 里除了卡面 `on_death` 技能，也执行 `unit.grantedDeaths`；新增动作 `grant_deathrattle`
- **测试**：给单位挂亡语后击杀它 → 回手效果生效；不挂则不生效
- **注意**：`killUnit` 已经有 `onDeathResolver`，把 granted 效果合并进 skills 数组即可复用

### B-10 抽到非某类牌为止 — 姜维

- **卡**：姜维「文武双全」普通攻击 +1；使用**策略牌**时抽牌直到抽到非策略牌
- **缺**：无"抽到非某类型为止"的动作；触发时机是"自己使用策略牌时"
- **建议做**：
  - 新增动作 `draw_until`，参数 `filter.type != 'tactic'`
  - 触发时机：已有 `ON_CARD_PLAYED`（`runCardPlayedTriggers`）。需要能判定"刚打出的是策略牌" → 给 `runCardPlayedTriggers` 的 ctx 带上刚打出的卡类型
- **测试**：牌库按 `[策略, 策略, 非策略, ...]` 排列 → 应恰好抽 3 张停在非策略
- **注意**：牌库会耗尽，需要与「粮尽」交互正确

### B-11 守护授予 — 祖茂

- **卡**：祖茂「替主」己方主帅受到伤害时，可改为由祖茂承受
- **缺**：不确定"守护"如何授予（这是**最后一个待确认项**）
- **现状**：`shou_hu`（守护）状态已有 `redirect_damage` cap，`findGuard` 靠 `inst.srcUid` 找守护者。
  陈宫「忠烈」已用 `apply_status: shou_hu` + `status_source: self` 实现"伤害由陈宫承担"。
- **但**：`findGuard` 目前是"**任意友方**受伤都转给守护者"，而祖茂的要求是"**主帅**受伤才转"
- **建议**：先读 `core/src/mutate.ts` 的 `findGuard`；若要区分"只护主帅"，需给状态加一个 `guard_scope: 'lord' | 'any'`（状态定义在 `core/src/constants.ts` 的 `STATUSES`）
- **测试**：主帅受伤 → 转给祖茂；其他友方受伤 → 不转

---

## 3. 战吼前端支持（引擎已就绪，UI 未做）

**背景**：`PLAY_CARD` 现在支持 `target?: { side, row, col }`（B-1 加的），引擎会把
它作为 `chosen` 传给战吼效果。但**原型出牌时不会弹选目标**，所以陈宫/蔡瑁在实机上
仍只能自动选第一个目标。

**要做（`prototype/battlefield.engine.js` + `setup.js`）**：
1. 出牌前判断该卡的 `on_play` 技能是否含 `target.mode === 'choose'` 的效果
   （AI 与引擎共用同一判定 —— 参照 `rules.ts` 的 `canUseUnitSkill` 的做法，**判定下沉到 core，UI 不自己判断**）
2. 若需要选目标：进入与 `pendingSkill` 同构的待选状态（**已有现成实现可抄**：
   `onLordSkillClick` → `pendingSkill` → `onUnitClick` 里选目标那段）
3. 选好后 `doAction({ type:'PLAY_CARD', cardIndex, row, col, target })`
4. 参考既有交互：攻击用**指向箭头**（`arrowTo`/`arrowHide`，命中合法目标变绿）

**踩过的坑（务必遵守）**：
- `#arrow-layer`、`#card-tip` 必须是 `<body>` 直属子节点。放进 `#canvas` 会因
  `transform: scale()` + `overflow:hidden` 导致坐标被二次缩放（这个 bug 修过一次）
- 点选用 `pointerup` 判定位移，**不要依赖 `click`**（`startUnitDrag` 的
  `preventDefault()` 会吞掉真机的 click 事件）
- 本地资源已加时间戳防缓存；测试时用 `bash tools/serve.sh`（发 no-store）

---

## 4. 通用陷阱清单（都是这个项目里实际踩过的）

| # | 陷阱 | 后果 |
|---|---|---|
| 1 | 改 `data/cards.yaml` | **会被 `tools/build-cards.sh` 覆盖**。真源是 `data/cards_decisions.draft.yaml` |
| 2 | 数值硬编码在 `tools/gen-cards-v1.py` | 基础兵（盾兵）就在脚本里，改数据要一并看 |
| 3 | `promote-cards.py` 的 `KEEP` 白名单 | 新字段不加进去会被**静默丢弃**（`rarity` 就丢过） |
| 4 | `dsl._none` 与 `dsl` 冲突 | 卡被列进「无技能」清单时技能会被静默跳过（蔡瑁踩过） |
| 5 | 卡面原文覆盖 DSL 文案 | 已修（DSL text 优先），但多技能卡要确认每条文案都对 |
| 6 | 测试改单位属性只改 `atk/hp/maxHp` | `applyMods()` 会用 `baseAtk/baseMaxHp` 重算打回原形，**必须同时改 base** |
| 7 | 测试写死卡面数值 | 设计者一改数值测试就碎，用相对断言（如"掉了 1 点"） |
| 8 | `mutate.ts` import `runEffects` | 循环依赖，必须走注册挂载点 |
| 9 | 改 `core/src/*.ts` 后忘记 `npm run build:browser` | 浏览器仍跑旧引擎 |
| 10 | ADR 表格行里写换行 | 会把表格切断；且 `render-gdd.mjs` 遇到「以 `\|` 开头但下一行不是表分隔符」的行会**死循环**（已加兜底，但仍应写成单行） |

## 5. 每项完成的定义（DoD）

1. `docs/gdd/13-balance-data-model.md` 或 `10-skills-statuses.md` 已同步（**铁律 1：DSL 扩展先改文档**）
2. 数据已录入 `data/cards_decisions.draft.yaml`，`bash tools/build-cards.sh` 已跑
3. **带测试**，且测试用相对断言（不写死卡面数值）
4. `cd core && npm test && npm run typecheck && npm run validate && npm run verify:dsl && npm run smoke` 全绿
5. `docs/gdd/14-open-questions.md` 加一条 ADR（记录决策、理由、来源）
6. `node tools/render-gdd.mjs` 重新生成 `docs/gdd/index.html`
7. **不自行 commit**（见 `AGENTS.md` 的「Git 提交约定」）——改完向设计者报告，由设计者决定提交

## 6. 建议顺序

B-3（抉择，2 张卡）→ B-5（连续攻击）→ B-6（掷骰）→ B-7（华佗）→ B-8（程昱）→ B-9（陆抗）→ B-10（姜维）→ B-4（貂蝉）→ B-11（祖茂，需先确认守护范围）→ 战吼前端
