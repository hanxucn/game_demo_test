# AGENTS.md · 《酒话三国》工程约定

> 本文件供 AI Agent 与人类协作者共用。**动手前先读 `PROJECT_STATE.md`**（项目记忆快照）。

## 项目结构

```
docs/                决策与设计文档
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
   若必须改代码，说明效果 DSL 需要扩展——先更新 `docs/gdd/13-balance-data-model.md`，再改代码。
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

# 引擎（core）
cd core
npm test          # 144 个测试：规则 / 引擎 / 回放确定性 / DSL / 框架闭环
npm run typecheck # tsc --noEmit
npm run validate  # 卡牌数据校验（结构 + 平衡 + value 块新鲜度）
npm run verify:dsl  # 逐张跑真实卡牌的 DSL，端到端验证
npm run smoke     # 两个 AI 互打一局 + 回放一致性（完整开局：掷点/换牌）
```

**改数据后必须跑**（一条命令重建整条数据链，含派生的 `value` 核算块）：
```bash
bash tools/build-cards.sh          # 八步：决策→归一化→入库→算 value→并回→导出 JSON→重建 bundle
cd core && npm test && npm run typecheck && npm run validate && npm run verify:dsl && npm run smoke
```

> `data/cards.yaml` 的 `value:` 块是**派生数据**（由 `core/tools/emit-values.ts` 依当前度量算出）。
> 不要手改；改了效果/数值后重跑 `build-cards.sh`，否则 `npm run validate` 会报"value 核算块已过期"。

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
- `core` 用 Node 原生类型剥离运行：`node --experimental-strip-types`（无需构建步骤）
- 随机数**只能**用 `core` 的确定性 RNG（`Rng`），禁止 `Math.random()`
  —— 否则 golden replay 无法复现
- 结算顺序严格遵循 `docs/gdd/10-skills-statuses.md` §4 的 23 步时机表
- 新增效果动作（action）必须先注册到 DSL 类型表

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
- [ ] `cd core && npm test` 全过（144/144）+ `npm run typecheck` + `npm run validate` + `npm run verify:dsl`
- [ ] 新增卡牌已跑数据校验（总价值在预算内）
- [ ] 若改了机制，`docs/gdd/` 已同步且 `index.html` 已重新生成
- [ ] 若产生新决策，已写入 `docs/gdd/14-open-questions.md` 的 ADR 表
