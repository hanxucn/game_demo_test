# 待办：B 类技能（B-3 ~ B-11）+ 战吼前端

> 交接文档。上一轮（2026-09-12）已完成 B-1、B-2，剩余 8 项 + 前端交互。
> **上手先读**：`PROJECT_STATE.md` → `AGENTS.md` → 本文档 → `docs/skill-dsl-plan.md`

## 0. 当前状态（接手时请先复核）

> ✅ **2026-09-23：B-3 ~ B-11 与「战吼前端」已全部完成**（ADR-071）。
> 下面是完成后的状态；每项的实现要点与验证方式见文末「§7 完成记录」。

| 项 | 值 |
|---|---|
| 分支 | `update_ui` |
| 本轮基线提交 | `b5c4df7 docs(AGENTS): 测试数更新为 153` |
| 测试 | `npm test` **189 通过 / 0 失败**（+36：`core/test/skills-071.test.ts` 35 条 + 程昱改写） |
| 卡池 | **123 张**（新建祖茂） |
| 校验 | `npm run validate` → **0 错误** / 176 警告 |
| DSL 验证 | `npm run verify:dsl` → **102 通过 / 0 失败** |
| 冒烟 | `npm run smoke` → 回放完全一致 |

复核命令：
```bash
cd core && npm test && npm run typecheck && npm run validate && npm run verify:dsl && npm run smoke
# 数据链（改了 data/ 或 core 的度量后）
bash tools/build-cards.sh
# 原型（改了 core/src/*.ts 后必须重建 bundle）
python3 tools/yaml2json.py && python3 tools/build-data-bundle.py
cd core && npm run build:browser && cd .. && bash tools/serve.sh
```

### ⚠️ 执行前必须先读：BACKLOG 里有 3 项与权威数据矛盾

上一轮写本文档时，B-4 / B-6 / B-9 的**卡牌描述与 `data/` 里的真实卡面不符**
（例如 B-6 说魏延是「掷骰子分支」，但卡面是「攻击时/受伤时各一半概率伤害+1」）。
**已与设计者确认口径：以当前数据 + 有设计者背书的澄清为准**，臆造项不实现。
逐项判定见 §7 的 ⑫。

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

## 2. 任务清单（B-3 ~ B-11）—— ✅ 全部完成，保留原文供复盘

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

## 3. 战吼前端支持 —— ✅ 已完成（原型可点选战吼目标）

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

---

## 7. 完成记录（2026-09-23，ADR-071）

一条命令验证全部：`cd core && npm test && npm run typecheck && npm run validate && npm run verify:dsl && npm run smoke`

| 项 | 做了什么 | 主要文件 | 测试 |
|---|---|---|---|
| B-3 抉择 | `SkillDef.modes[]` + `PLAY_CARD.modeIndex`；`effectsOf()` 为分支取值唯一真源，缺省/越界取 `modes[0]`；曹彰「猛袭」补效果 | `types.ts` `effects.ts` `engine.ts` `cards_decisions.draft.yaml` | 3 条（含 6 种越界值） |
| B-4 性别 | `CardDef.gender` + `filter.gender` + `card_gender` 决策段；貂蝉只震慑男性 | `types.ts` `effects.ts` `gen-cards-v1.py` `promote-cards.py` | 3 条 |
| B-5 连续普攻 | 普攻结算抽成 `effects.resolveAttack()`，`ATTACK` 与 `attack_each` 共用；张苞改为「战吼挨个打攻<自己的敌人，自己阵亡即停」 | `effects.ts` `engine.ts` | 2 条（含中途阵亡停手） |
| B-6 时序 | `on_attack` 触发技改到**算攻击力之前**；姜维/魏延补 `duration: this_turn`；补魏延漏掉的「受创时」分支。**掷骰子分支：臆造，不实现** | `effects.ts` `cards_decisions.draft.yaml` | 3 条 |
| B-7 批量驱散 | `remove_status` 支持 `remove_kind: debuff\|buff`；华佗清全部负面 | `types.ts` `effects.ts` | 2 条 |
| B-8 牺牲取值 | 新增 `sacrifice` 动作（写 `sacrificed_max_hp` / `sacrificed_hp` 进 flags）+ `Action.target2` / `TargetSelector.pick`；程昱改用真·牺牲 | `types.ts` `effects.ts` `mutate.ts` | 3 条 |
| B-9 复制技能 | `zone: 'both'` 覆盖「手里或场上」+ `filter.exclude_source`；陆抗 | `effects.ts` `types.ts` | 3 条 |
| B-10 抽到非某类为止 | 新增 `draw_until`；姜维补「使用策略牌时」分支（复用 `on_card_played` 类型过滤） | `effects.ts` `constants.ts` | 3 条（含粮尽） |
| B-11 护主 | 新状态 `hu_zhu` + `StatusDef.guard_scope` + `findLordGuard`（主帅不是 Unit）；**新建祖茂 2 费 1/3**（ADR-072 改回 ADR-068 的数值） | `constants.ts` `mutate.ts` `statuses.yaml` `new_cards` | 6 条（含跨回合边界） |
| 战吼前端 | `Core.playTargetPlan()` 把「要不要选/选几个/能选谁」下沉到 core；原型弹选目标 + 抉择按钮 + 指向箭头 | `engine.ts` `index.ts` `battlefield.engine.js` `battlefield.html` | 8 条（plan 单测）+ 浏览器实测 |

### 实现时踩到的坑（值得记住）

| # | 坑 | 后果 |
|---|---|---|
| 1 | 光环施加的状态按 `duration: 'turns'` 记了 1 回合 | 会在**自己回合结束**时被清掉，而护主要挡的恰是对手回合的伤害 → 形同虚设。现规定：光环施加的状态不带 `turns`，生命周期交给光环 |
| 2 | 把兵种卡的 `gender` 记成 `unknown` | 貂蝉在纯基础兵对局里**完全空转**（目标池被清空）。现规定：有攻血的单位默认 `male` |
| 3 | 用两条互斥 `condition` 效果表达「手里或场上」 | 估值时两条被**相加**（陆抗价值 14.5 超预算），改用 `zone: 'both'` 单个选择器 |
| 4 | 把 曹彰 的 DSL 误挂在 `wei_chengyu:` 键下 | 程昱的技能被覆盖、曹彰仍是白板 → `bash tools/build-cards.sh` 的输出「有技能名、效果待设计」会暴露这类错误，**改完必须看这一行** |
| 5 | 测试里用 9 攻打张苞当「会被反击打死」的用例 | 张苞的目标集是「攻 **<** 自己」，9 攻根本不在集合里 → 用例假过 |
| 6 | 以「**推出来的**类型」为条件搬运攻血字段 | 类型判不出的卡（黄权缺攻击力）连**生命值一起丢**，变成 0/0 白板。攻血该按"照片稿里有就带上" |
| 7 | 击杀奖励排在「攻击次数 +1」之前 | 关兴「额外行动」刚把次数清零就被加回去 → 额外行动等于白给。**必须排在记账之后** |

### ✅ 设计者答复后已全部收口（ADR-072）

| # | 原「待定夺」项 | 结论 |
|---|---|---|
| 1 | 程昱第三个「指定敌人」 | 设计者确认**可以按随机敌人**落地 → 结项 |
| 2 | 祖茂数值 | 设计者：**1 攻仍是武将，可以显式标注** → 改回 ADR-068 的 **2 费 1/3** + `type_explicit: true` |
| 3 | 张辽 / 关兴的 `event: killed` 永假 | **已修**：`on_attack` 拆成 before（非击杀条件）/ after（击杀条件）两趟 |
| 4 | 向宠 / 黄权的类型错误 | 设计者要求「确保数据里人物都修改正确」→ 两张都从**武将改回谋臣**（数值改了类型没跟着改；黄权还额外清掉一处代码硬编码 + 修回被丢掉的生命值） |

`B-4` 的「两个相邻男性角色决斗」与 `B-6` 的「掷骰子分支」仍判定为臆造、不实现（无手写稿 / ADR 依据）。

---

## 8. 内容缺口 —— ✅ 已全部收口（ADR-074 / ADR-075）

> 下表保留审计记录供复盘。**清单内全部已处理**（`core/test/content-074.test.ts`，23 条）：
> 其余五项实现 + 测试（ADR-074），陈到按设计者裁定先当白板武将（ADR-075）。
> 顺带修掉一个让"卡牌打完就消失"的渲染 bug（`CardRender` 无条件改 `position`），
> 并给所有技能加了"发动"提示与节奏档位。

### 原始审计清单（已处理）

> 这几项都是「文案写了、数据里没有」，但**不能靠改数据修**——要么需要新引擎能力，
> 要么需要设计者拍板口径。**故意没有擅自实现**（本项目已多次因 AI 自行推定机制而返工）。

| 卡 | 文案（真源） | 现状 | 缺什么 |
|---|---|---|---|
| **空城计**（5 费战法） | 「当己方场上没有人物在场时，对方一回合无法攻击主帅」 | ✅ **已实现**：`kong_cheng` 状态 + `legalTargets` 的主帅判定 | — |
| **司马懿**（5 费 1/6） | ①不动则回合结束全体敌方 1 伤 ②**行动且造成伤害**则拆对手牌库一张 ③场上只剩他时②同时生效 | ✅ **已实现**：`acted_this_turn` / `dealt_damage_this_turn` 追踪 + `mill` 动作 + `any_of` | — |
| **休养生息**（5 费战法） | 「下一回合不进行任何活动，恢复全体人员（包括主帅）3-4 点血量，抽三张牌」 | ✅ **已实现**：主将治疗 + `skip_turn` 跳回合 | 「全体」按**己方**理解；若要含敌方改一个 `side` |
| **黄皓**（2 费 1/2） | 「降低**己方主公**一点统率，敌方随机**封锁**手中一张卡」 | ✅ **已实现**：`gain_command: -1` + `ban_play`（封锁≠弃掉） | — |
| **张宝 / 张梁**（3 费） | 「张宝与张梁同时在场时召 2 个黄巾兵；**张氏三兄弟同时在场**时共 4 个」 | ✅ **已实现**：按 `card_id` 精确判定 + `all_of` 组合 | — |
| **陈到**（3 费 2/2） | 技能名「白毦兵」 | ✅ **已裁定**（ADR-075）：先作为**无技能武将**进卡池，技能名等效果设计好再加 | — |
| **步兵 / 机械哨兵 / 机械守卫** | 「不能攻击敌方主帅」「当场上设有其他敌方人物时才可攻击主帅」 | 无承载字段 | 限制型文案，`restrict` 字段仍缺（ADR-045 挂账） |

**另外两处「代码层」欠账**（不在数据里）：
1. `dsl_blocked` 里的 `move` / `random_pick` 两个动作**注册了但没实现**（当前 0 张卡使用，validate 只提示）。
2. `MATCH.TURN_SECONDS = 60` 的回合时限只在原型生效，`core` 侧没有「超时判负」的入口（若服务端需要权威判定要补）。

### ADR-075 的后续调整

| 项 | 变化 |
|---|---|
| **陈到** | 从「有技能名、效果待设计」改为**无技能白板武将**（3 费 2/2）；决策段 `card_no_skill` 控制，技能名保留在设计文档里 |
| **休养生息** | 效果改为「**己方全体（含主帅）+3 血，抽 1 张**」；去掉「下一回合不进行任何活动」与抽 3 张 |
| `skip_turn` / `xiu_zheng` | **当前无卡使用**，能力与测试保留（随时可挂回）；引擎侧跳回合循环仍在 |
| 新增决策段 `card_text` | 卡级 `effects` 的卡（战法/事件）原先改不了卡面文案，现可按卡 id 覆盖 |
