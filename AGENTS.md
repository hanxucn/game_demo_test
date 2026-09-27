# AGENTS.md · 《酒话三国》工程约定

> 本文件供 AI Agent 与人类协作者共用。**动手前先读 `PROJECT_STATE.md`**（项目记忆快照）。

## 项目结构

```
docs/                决策与设计文档
  BACKLOG-skills.md  待办：技能 B 类 + 战吼前端（有明确待办时先读它）
  gdd/               机制设计文档（唯一真源）
  gdd/index.html     由 tools/render-gdd.mjs 生成，勿手改
data/                游戏数据（唯一内容源）
  cards.yaml         卡牌
  keywords.yaml      关键词
  statuses.yaml      状态
prototype/           战场原型（引擎驱动）、卡面渲染、风格实验室
tools/               构建与校验脚本
core/                纯 TS 规则引擎（已建）：src / test / tools / data(JSON)
client/              （待建）Cocos Creator 工程
server/              （待建）Go 服务端
```

## 四条铁律

1. **加一张卡 = 只改 `data/*.yaml`，不改代码。**
   卡牌一律加/改在 **`data/cards.yaml`**（ADR-091 起它是唯一手写真源）；字段白名单见该文件头，
   写错字段 `npm run validate` 会直接报错。若必须改代码，说明效果 DSL 需要扩展
   —— 先更新 `docs/gdd/13-balance-data-model.md`，再改代码。
2. **`core/` 零引擎依赖。**
   不允许 `import` 任何 Cocos API。引擎只负责把 `core` 产出的事件流画出来。
3. **机制以 `docs/gdd/` 为唯一真源。**
   代码与文档冲突时，先改文档再改代码；口头约定一律写进 `14-open-questions.md`。
4. **改完必须跑验证命令**（见下），失败不许合并。

## 验证命令

```bash
# 机制文档
node tools/render-gdd.mjs        # 重新生成单页 HTML

# 原型（引擎驱动，需先重建 bundle）
python3 tools/yaml2json.py && python3 tools/build-data-bundle.py
cd core && npm run build:browser && cd ..
open prototype/battlefield.html

# 一条命令：静态页面 + 卡组 API（卡组存 server/game.db，跨浏览器/跨机器都在）
bash tools/serve.sh          # → http://127.0.0.1:8099/prototype/battlefield.html
#   需要 Node ≥22.18（node:sqlite 内置 + 直接 import core 的 .ts）；core/data/*.json 已入库
#   端口被占会自动往后找；重复启动直接给地址
#   想验证「没有服务端时页面还能不能用」：bash tools/serve.sh --static（卡组退化为存浏览器）

# 引擎（core）
cd core
npm test          # 规则 / 引擎 / 回放确定性 / DSL / 框架闭环 / B 类技能 / 内容收口 / AI
npm run typecheck # tsc --noEmit
npm run validate  # 卡牌数据校验（结构 + 字段白名单 + 注册表 + 命名 + 类型定型 + 文案一致性）
npm run verify:dsl  # 逐张跑真实卡牌的 DSL，端到端验证
npm run smoke     # 两个 AI 互打一局 + 回放一致性（完整开局：掷点/换牌）
```

**改数据后必须跑**（ADR-091/092：**只读的校验 + 导出**，不会写 `cards.yaml`）：
```bash
bash tools/build-cards.sh          # 三步：导出 JSON→校验→重建 bundle（全程只读 cards.yaml）
cd core && npm test && npm run typecheck && npm run validate && npm run verify:dsl && npm run smoke
```

> **`data/cards.yaml` 是卡牌数据的唯一手写真源，且没有任何脚本会写它**（ADR-091/092）：
> 加卡就在末尾追加一条 `- id: ...`，改数值/技能直接改对应字段。`bash tools/build-cards.sh`
> 只是**只读的"校验 + 导出"**（导出引擎读的 JSON、重建浏览器产物），不会生成或回写任何卡牌内容。
>
> 允许的字段写在 `data/cards.yaml` 的文件头；**写了名单外的字段会被 `npm run validate` 直接报错**
> （从前的 `promote-cards.py` 是按白名单归一化，写错字段会被静默丢弃 —— `rarity`/`gender` 都丢过）。
> 两套旧机制**都已退役**，改它们不会生效：① 草稿层生成链（`data/cards_decisions.draft.yaml`、
> `tools/legacy/*.py`）；② `value:` 预算核算块（ADR-092 整个删除 —— 那套"超模闸门"是按公式估算、
> 从未实机校准的启发式，会拦住有意为之的数值）。

## 命名约定

| 对象 | 前缀 | 示例 |
|---|---|---|
| 阵营人物卡 | `shu_` / `wei_` / `wu_` / `qun_` | `shu_guanyu` |
| 主公（非卡牌，在 `heroes.yaml`） | `shu_` / `wei_` / `wu_` | `shu_liubei` |
| 中立卡 | `neutral_` | `neutral_infantry` |
| 事件卡 | `event_` | `event_zainian` |
| 战法卡 | `tactic_` | `tactic_huogong` |
| 进化卡 | `elite_` | `elite_hubaqi` |
| 羁绊 | `bond_` | `bond_taoyuan` |
| 关键词 | 拼音 snake_case | `jia_dun`（架盾） |
| 状态 | 拼音 snake_case | `zhen_she`（震慑） |

- 卡名 **≤ 4 字**（卡面显示限制）
- 每张卡必须填 `memo`（一句话记忆点）

## 代码规范

- TypeScript strict；`core` 内不允许 `any`
- `core` 用 Node 原生类型剥离运行：`node --experimental-strip-types`（无需构建步骤）。
  **但浏览器原型跑的是 `prototype/core.bundle.js`** —— 改了 `core/src/*.ts` 后必须
  `cd core && npm run build:browser`，否则页面仍跑旧引擎（症状：改了规则但行为不变）。
- 随机数**只能**用 `core` 的确定性 RNG（`Rng`），禁止 `Math.random()`
  —— 否则 golden replay 无法复现
- 结算顺序严格遵循 `docs/gdd/10-skills-statuses.md` §4 的 23 步时机表
- 新增效果动作（action）必须先注册到 DSL 类型表

## Git 提交约定（重要）

**AI 不要自行 `git commit`。** 每完成一处改动/修复后，向设计者报告：

1. 改了什么、为什么改（含验证结果）
2. 涉及哪些文件
3. 建议的提交粒度与提交信息

**由设计者决定**是继续改还是先提交。理由：AI 按"一个修复一个 commit"的节奏提交
会把历史切得太碎，设计者需要自己掌控提交边界与节奏。

- ✅ 允许：`git status` / `git diff` / `git log` / `git show` 等只读操作
- ✅ 允许：在设计者明确要求时提交，或按设计者指定的粒度提交
- ❌ 不要：改完就自动 `git add -A && git commit`
- ⚠️ 不要用 `git add -A`（会把 `prototype/_probe.html` 等生成物带进版本库）
  —— 只 add 自己确实改过的文件

**提交信息格式（设计者 2026-09-27 修订）**：简体中文。**标题 1~2 句说清"这是什么事"；
正文（comment）分组列出概括性的更新内容**：

```
feat(card): 增加吴国人物卡牌，相关机制优化

一、新增吴国人物卡牌
· 全琮：3 费 3/2 武将；「决水」战吼，对目标造成 3 点水攻伤害。
· 潘璋：5 费 4/2 武将；「擒将」战吼，选择受伤的敌方武将，造成 3 点火攻伤害。

二、功能 && bugfix
· 修复技能目标解析错误，人物目标与主公目标现在能正确区分。
· 修复卡牌效果还未结算时点击「结束回合」导致效果不结算的问题。

三、验证
· npm test 280 全绿；浏览器实测吴国卡组可构筑并可开局

（ADR-0xx）
```

- **标题要短**：完整根因与实测数据写进 `14-open-questions.md` 的 ADR 行，
  标题只交代"这是什么事"，**具体改动点列在正文里**，避免两处各存一份而漂移
- 正文分组用 `一、二、三、`，每条一行以 `·` 起；**有验证结果就单列一组**
- 不用英文；一次提交只讲一件事；docs 与代码同步的提交写 `docs: 同步 ADR-0xx 与 GDD`

**提交粒度（设计者 2026-09 定）**：判断口径是"**这是同一件事的续做，还是另一件事？**"

- **同一件事的续做**（改错、漏改、按追加要求微调同一处、同一个 bug 的下一层原因）
  → **`git commit --amend`** 并进原提交，不要为它新开一条
- **意图方向不同**（换了另一件事、另一个 bug、另一张卡/另一处机制、另一类改动）
  → **新提交**，不要塞进上一条里
- 反例：连续 4 条「修同一个抽牌动画」= 太碎；把「修箭头」和「改卡牌数值」放进同一条 = 太杂

## AI 使用边界

| 让 AI 干 | 别让 AI 干 |
|---|---|
| `core` 规则/效果解释器（有测试兜底） | 引擎版本相关的平台适配代码 |
| 数据 schema、Excel→YAML 导出脚本 | 微信/抖音 SDK 接入（幻觉代价高） |
| 单元测试 + golden replay | 构建/分包/原生工程配置 |
| 平衡模拟器与数值报表 | 包体与性能调优的最终判断 |
| UI 骨架、文档、ADR | 合规/版号相关决策 |

**验收要求**：AI 产出的代码必须带测试；禁止"AI 写完直接合"。

## 禁止事项

- ❌ 把卡牌数值硬编码进代码
- ❌ 在 `core` 里引用引擎 API
- ❌ 手改 `docs/gdd/index.html`（会被重新生成覆盖）
- ❌ 使用未注册的关键词 / 状态 / 效果动作
- ❌ 设计"单次随机决定胜负"的卡（违反 `12-randomness.md` 规则一）
- ❌ 使用非法关键词组合（架盾 + 奇袭）
- ❌ 在 `data/` 里放入未标注来源的占位数值而不加注释

## 提交前检查清单

- [ ] 改了 core / data 后已重建 `core.bundle.js` 与 `data.bundle.js`
- [ ] `cd core && npm test` 全过 + `npm run typecheck` + `npm run validate` + `npm run verify:dsl`
- [ ] 新增卡牌已跑数据校验（`npm run validate` 无 error；字段名、关键词/状态/动作注册、类型定型都过）
- [ ] 若改了机制，`docs/gdd/` 已同步且 `index.html` 已重新生成
- [ ] 若产生新决策，已写入 `docs/gdd/14-open-questions.md` 的 ADR 表
