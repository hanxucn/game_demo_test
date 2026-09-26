# @juhua/core · 规则引擎

> 纯 TypeScript 逻辑，**零引擎依赖**。Cocos 客户端与 Go 服务端共用同一套规则。

## 快速开始

```bash
npm install            # 仅需 typescript + @types/node（dev）
npm test               # 34 个测试（规则 / 引擎 / 回放）
npm run typecheck      # tsc --noEmit
npm run validate       # 卡牌数据校验（GDD 的 10 条规则）
npm run smoke          # 两个 AI 互打一局 + 回放一致性校验
```

数据流：

```
data/*.yaml  --(python3 tools/yaml2json.py)-->  core/data/*.json  --(loader)-->  引擎
```

## 唯一写入口

```ts
import { newMatch, applyAction } from '@juhua/core';

const { state, ctx } = newMatch({
  seed: 12345,
  cards,                                   // Map<id, CardDef>
  lords: { own: liubei, enemy: caocao },
  decks: { own: [...30 ids], enemy: [...30 ids] },
});

const result = applyAction(state, ctx, {
  type: 'ATTACK',
  from: { row: 'front', col: 0 },
  to:   { kind: 'unit', row: 'front', col: 2 },
});

result.ok        // 是否成功
result.state     // 新状态（不可变，原 state 不变）
result.events    // 事件流 —— 客户端只消费这个
```

**客户端不允许自己改状态**，也不允许自己判断规则（谁能打谁、伤害多少）。全部由 `core` 决定。

## 动作

| 动作 | 参数 |
|---|---|
| `PLAY_CARD` | `cardIndex`、人物卡还需 `row` + `col` |
| `ATTACK` | `from {row,col}`、`to {kind:'unit',row,col}` 或 `{kind:'lord'}` |
| `USE_LORD_SKILL` | `target? {side,row,col}` |
| `USE_SKILL` | `row`、`col`、`target?` |
| `END_TURN` | — |

## 事件 → 动画映射（Cocos 用）

| 事件 | 客户端应播放 |
|---|---|
| `TURN_START` | 回合切换、统率值刷新 |
| `CARD_DRAWN` | 抽牌动画（从牌库滑入） |
| `CARD_PLAYED` | 出牌飞行 |
| `UNIT_SUMMONED` | 落地闪光 + 回弹 |
| `ATTACK_DECLARED` | 攻击者冲刺 |
| `DAMAGE` | 目标抖动 + 伤害数字 |
| `HEAL` | 绿色治疗数字 |
| `ARMOR_GAINED` | 护甲图标脉冲 |
| `STATUS_APPLIED` / `STATUS_EXPIRED` | 状态图标出现 / 消失 |
| `UNIT_DIED` | 死亡动画 |
| `LORD_SKILL_USED` | 主公技特效 |
| `FATIGUE` | 粮尽提示 + 主将受伤 |
| `GAME_OVER` | 胜负结算 |
| `REJECTED` | 操作无效提示 |

> 事件是**已发生事实**，不是意图。客户端不需要（也不应该）预判结果。

## 关键不变量

1. **确定性**：同一 `seed` + 同一动作序列 = 完全相同的 `state`（`test/replay.test.ts` 断言）
2. **禁止 `Math.random()`**：只能用 `core` 的 `Rng`（否则回放不可复现）
3. **事件是唯一渲染依据**：客户端不读 `state` 做规则判断
4. **加卡不改代码**：卡牌效果全部走 `effects` DSL

## 给 Go 服务端的建议

服务端有两种做法：

| 方案 | 做法 | 适用 |
|---|---|---|
| **A. 同构**（推荐先做） | 服务端用 Node 跑同一份 `core`，Go 只做网关/匹配/存储 | demo 阶段最快 |
| B. 双实现 | Go 重写规则，用 `npm run smoke` 产出的 replay 做黄金测试对齐 | 后期需要 Go 原生性能时 |

**无论哪种**，`core` 产出的 replay 都是唯一事实来源：同一串动作 + seed 必须得到同一状态。

## 已知设计问题（引擎实测发现）

`npm run smoke` 用纯基础兵种对局时，**40 回合只掉了 1 点主将血**——棋盘容易被双方铺满，没人能破阵。

这正是 GDD 里"三泄压阀"存在的理由：

1. **计谋直伤**（谋臣 / 战法 / 事件卡可直接打主将）——引擎已支持，但卡池里还没有这类卡
2. **粮尽**——引擎已实现，30 张卡组在 40 回合内触发不到
3. **破阵奖励**——尚未实现

> 结论：**卡池必须包含足够数量的"绕过阵型"手段**，否则对局会僵持。
> 这条要在设计战法/事件卡时优先满足。

## 目录

```
core/
├── src/
│   ├── types.ts       全部类型（对外契约）
│   ├── constants.ts   关键词 / 状态 / 结算时机
│   ├── rng.ts         确定性 RNG
│   ├── state.ts       状态创建与查询
│   ├── rules.ts       攻击合法性（4 条规则）+ 有效攻击力
│   ├── mutate.ts      状态变更原语（伤害/治疗/死亡/抽牌）
│   ├── effects.ts     效果 DSL 解释器
│   ├── engine.ts      applyAction 主循环
│   ├── ai/            对战 AI（ADR-084）：cards / profile / eval / options / index
│   ├── loader.ts      数据加载与自动组卡
│   └── index.ts       公共导出
├── test/              254 个测试（含 test/ai.test.ts）
├── tools/             validate（校验器）、smoke（冒烟）、ai-report（AI 对局报表）
└── data/              YAML 转换后的 JSON（勿手改）
```
