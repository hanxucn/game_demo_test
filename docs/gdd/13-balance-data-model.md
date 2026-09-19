# 13 · 数值模型与数据格式

> 状态：**已定**。本文件是 `core` 与内容管线的直接输入。

## 1. 总价值预算模型

> **总价值 = 属性点 + 关键词价值 + 技能价值 + 羁绊协同价值 − 负面代价**

### 1.1 为什么不是"费用绑定属性"

费用**不绑定属性**——高费卡可以是"低属性 + 强技能"，也可以是"高属性 + 无技能"。
费用绑定的是**总价值**，属性只是其中一个可分配项。

| 卡 | 属性点 | 技能/关键词 | 总价值 | 8 费基准 | 判定 |
|---|---|---|---|---|---|
| 路线 B：8 费 8/8 + 无双 | 16 | −2 | 18 | 17 | 超 1，可接受 |
| 路线 A：8 费 4/4 + 强力计略 | 8 | +9 | 17 | 17 | ✅ |

### 1.2 适用区分

| 卡类 | 定价方式 |
|---|---|
| 基础兵种卡（无技能） | **属性基准严格适用** |
| 人物卡（有技能/关键词） | **总价值预算适用**，属性可高可低 |
| 事件卡 / 战法卡 / 进化卡 | 按**等效效果价值**定价（见 §3） |

## 2. 属性点基准

> **白板属性点 ≈ 2 × 统率 + 1**

| 统率 | 基准属性点 | 典型白板 |
|---|---|---|
| 1 | 3 | 2/1、1/2 |
| 2 | 5 | 3/2、2/3 |
| 3 | 7 | 4/3、3/4 |
| 4 | 9 | 4/5、5/4 |
| 5 | 11 | 5/6、6/5 |
| 6 | 13 | 6/7、7/6 |
| 7 | 15 | 7/8、8/7 |
| 8 | 17 | 8/8 |
| 9 | 19 | 9/9 |
| 10 | 21 | 10/10 |

> 该曲线由《炉石传说》白板单位实测归纳，误差 ≤ 1 点。

## 3. 关键词价值表

| 关键词 | 价值 | 备注 |
|---|---|---|
| 结阵 | −0.5 | 条件性 |
| 神射 | −0.5 | 条件性 |
| 架盾 | −1 | 全局嘲讽 |
| 武圣 | −1 | 免疫一次 |
| 先攻 | −1 | |
| 奇袭 | −1 | |
| 饮血 | −1 | |
| 疾行 | −1.5 | |
| 连击 | −1.5 | |
| 遗计 | −2 | 已含死亡概率折扣 |
| 无双 | −2 | |
| 忠义 | 视效果 | 按等效价值另算 |

**组合折扣**：多个关键词同时出现时，总价值 = 各关键词之和 × **0.9**。

## 4. 技能定价方法

```
技能价值 = 等效效果价值 × 触发概率 × 可互动折扣
```

### 4.1 等效效果价值

| 效果 | 价值 |
|---|---|
| 造成 N 点伤害 | N × 0.5 |
| 恢复 N 点生命 | N × 0.4 |
| 抽 1 张牌 | 3 |
| 召唤 1/1 | 3 |
| 召唤 2/2 | 5 |
| 使目标无法行动 1 回合（震慑） | 4–6（视目标强度） |
| 全体 +1 攻击（光环） | 受益单位数 × 1 |
| 获得 1 点护甲 | 1 |

### 4.2 触发概率

| 触发类型 | 概率 |
|---|---|
| 入场（战吼） | 100% |
| 回合开始（需存活） | ~70% |
| 回合结束（需存活） | ~70% |
| 阵亡（需死亡） | ~60% |
| 受到伤害后 | 视对局而定，默认 60% |

### 4.3 可互动折扣

| 情形 | 折扣 |
|---|---|
| 技能可被震慑/移除打断 | ×0.8 |
| 技能需要铺垫（如先满足某条件） | ×0.8 |
| 技能目标由对手选择 | ×0.7 |
| 技能必然生效且无法反制 | ×1.0（并需警惕超模） |

## 5. 校验规则（CI 自动检查）

数据校验器需在 CI 中执行以下检查：

| # | 检查 | 失败处理 |
|---|---|---|
| 1 | 总价值超出同费预算 ±1.5 点 | 警告 |
| 2 | 总价值超出 ±3 点 | **报错，阻止合并** |
| 3 | 卡名长度 > 4 字 | 报错 |
| 4 | 非法关键词组合（架盾 + 奇袭） | 报错 |
| 5 | 谋臣卡攻击力 ≠ 0 | 报错 |
| 6 | 进化卡目标兵种不存在 | 报错 |
| 7 | 羁绊引用的人物 id 不存在 | 报错 |
| 8 | 效果引用了未注册的 action / status | 报错 |
| 9 | 缺少 `memo`（一句话记忆点） | 警告 |
| 10 | 同一阵营同类卡数量失衡（超过均值 ±50%） | 警告 |

## 6. 卡牌 Schema

```yaml
# cards.yaml
- id: shu_infantry              # 必填，唯一
  name: 步兵                    # 必填，≤4 字
  faction: neutral              # shu | wei | wu | qun | neutral
  type: troop                   # troop | general | strategist | event | tactic | elite
  cost: 1                       # 0-10
  attack: 2                     # 人物卡必填
  health: 1                     # 人物卡必填
  keywords: [jie_zhen]          # 关键词 id
  skills: []                    # 技能定义
  bonds: []                     # 羁绊 id
  memo: "相邻有步兵时攻击 +1"     # 必填，设计用
  flavor: "结阵而战，进退有度"     # 可选，收藏页显示
```

### 6.1 非人物卡

```yaml
- id: tactic_huogong
  name: 火攻
  faction: neutral
  type: tactic
  cost: 3
  target:
    side: enemy
    filter: { type: character }
    count: 1
    mode: choose
  effects:
    - action: damage
      value: 4
  memo: "3 费 4 点单体伤害"
```

### 6.2 进化卡

```yaml
- id: elite_hubaogi
  name: 虎豹骑
  faction: wei
  type: elite
  cost: 3
  upgradeTarget:
    from: { type: troop, troopKind: infantry, side: ally }
    to:
      id: wei_tiger_cavalry
      name: 虎豹骑
      attack: 3
      health: 2
      keywords: [xian_gong]
  memo: "把步兵变成先攻骑兵"
```

## 7. 效果 DSL

### 7.1 结构

```yaml
effects:
  - action: <动作>
    target: <选择器>
    value: <数值>
    duration: <持续>
    condition: <条件>
```

### 7.2 动作表

| action | 参数 | 说明 |
|---|---|---|
| `damage` | value | 造成伤害 |
| `heal` | value | 恢复生命（≤30） |
| `draw` | value | 抽牌 |
| `summon` | unit, count, position | 召唤人物卡 |
| `apply_status` | status, stacks, duration | 施加状态 |
| `remove_status` | status | 移除状态 |
| `move` | destination | 移动到指定格 |
| `destroy` | — | 直接摧毁 |
| `modify` | attack / health, value, duration | 属性修正 |
| `gain_armor` | value | 获得护甲（主将） |
| `cost_modifier` | value, limit | 费用修正 |
| `transform` | to | 变形/进化 |
| `random_pick` | from, count | 随机选择 |

### 7.3 目标选择器

```yaml
target:
  side: ally | enemy | both | self      # 阵营（self = 来源方阵营）
  source: true                          # 只选「来源单位自身」（ADR-033）
  filter:                               # 过滤条件
    type: troop | general | strategist | character
    keyword: xian_gong
    tag: xi_liang                       # 归属标签（见 §7.5）
    faction: shu
    lane: 1-5
    row: front | back
    health_max: 2
    has_status: zhen_she
  count: 1 | all | 2                    # 数量
  mode: choose | random | first | lowest_health
  require_empty: true                   # 是否要求空格
```

### 7.4 事件卡的"双方"表达

```yaml
target:
  side: both          # 双方同时生效 → 天道无情
  filter: { type: character }
```

### 7.5 归属标签（ADR-029）

人物除**阵营**（shu / wei / wu / qun，决定可用卡池）外，还可带**归属标签**，
表示黄巾军、蛮族、西凉这类身份归属。两者是**正交**的：

| 概念 | 取值 | 作用 |
|---|---|---|
| 阵营 `faction` | shu / wei / wu / qun / neutral | 构筑时可用的卡池边界 |
| 归属标签 `tags` | 见 `data/tags.yaml` | 技能条件与目标过滤；**可多个，可跨阵营** |

```yaml
- id: shu_madai
  name: 马岱
  faction: shu            # 蜀国卡
  tags: [xi_liang]        # 但同时是西凉人物
  skills:
    - name: 西凉子弟
      effects:
        - action: modify
          value: 1
          target: { side: 'both', filter: { tag: xi_liang } }   # 全体西凉人物
```

**为什么不做成子阵营**：马岱是蜀将也是西凉人，若做成子阵营会与阵营互斥；
标签是叠加的，同一人物可同时是「蜀 + 西凉」，将来也可「群 + 黄巾 + 士族」。

**价值**：标签本身 `value: 0`（不占预算）。它的强度体现在**联动卡**上——
所以含标签联动的卡在算总价值时，联动部分要单独估算。

**当前标签**：西凉 `xi_liang`、蛮族 `man_zu`、黄巾 `huang_jin`、士族 `shi_zu`。
新增标签须先登记进 `data/tags.yaml`，否则校验报错。

### 7.6 概率 · 条件 · 动态取值（ADR-033）

> 设计原则：**卡牌效果没有"特殊机制"，只有"通用算子的组合"**。
> 概率 = 掷一次骰子；随机 = 目标集合里随机取；条件 = 结算前查一次局面；
> 动态取值 = 数一个集合的大小。全部用确定性 RNG，保证回放可复现。

#### ① 概率 `chance`

任何效果都可加 `chance`（0–1），结算前掷一次骰子，不中则整个效果跳过。

```yaml
- action: apply_status
  status: zhen_she
  chance: 0.5                 # 一半概率
  target: { side: enemy, filter: { type: 'character' }, count: 1, mode: 'random' }
```

#### ② 条件 `condition`

效果可加 `condition`，不满足则跳过。四种写法，覆盖卡池全部需求：

```yaml
# a) exists —— 该集合非空（"当场上有低于 3 统帅的人时"）
condition: { exists: { side: 'both', filter: { type: 'character', cost_max: 3 } } }

# b) count —— 某集合数量与定值比较（"场上只有典韦一名己方人物时"）
condition: { count: { side: ally, filter: { type: 'character' } }, op: '==', value: 1 }

# c) count_vs —— 两个集合数量互比（"对方场上卡牌数不少于己方时"）
condition: { count_vs: { left: { side: enemy }, right: { side: ally }, op: '>=' } }

# d) event —— 本次结算中发生过某事（"如若斩杀敌人"）
condition: { event: killed }        # killed | clash_won | clash_lost
```

#### ③ 动态取值 `value_from`

数值不再写死，改为**数一个集合**（"场上每有 1 名蛮族人物，自身 +1 攻 +1 血"）：

```yaml
- action: modify
  attack_from: { side: 'both', filter: { tag: man_zu } }      # +1 × 蛮族人物数
  health_from: { side: 'both', filter: { tag: man_zu } }
```

`*_from` 的取值 = 该选择器命中的单位数 ×（可选）`per` 系数；也支持 `limit` 上限。

#### ④ 新增动作

| action | 参数 | 说明 |
|---|---|---|
| `discard` | target.side, count | 弃牌：**按「方」结算**，从该方手牌随机弃 N 张 |
| `return_to_hand` | target | 返回手牌（"收回手中""回到对方手牌"）|
| `clash` | target, then | **拼点**：双方各翻一张，比点数；结果写入 `event` 供条件判定 |
| `scry` | target, count, to | 查看/移动卡池顶或底（"查看卡池第一张牌""放到最底层"）|
| `silence` | target, duration | 禁用技能（"技能禁用一回合"）|
| `flip` | target | 翻面（"将卡牌翻面"，翻面期间不可被选中）|

#### ⑤ 目标选择器补充

```yaml
filter:
  cost_max: 3          # 统帅值上限（"低于自己统帅的敌军"）
  adjacent_to: self    # 相邻（"相邻的己方人物"）
```

### 7.7 光环与属性修正层（ADR-037）

> **问题**：原实现直接改 `u.atk` / `u.maxHp`（加完回不去），导致
> ① 光环无法"条件变化时重算" ② 临时修正在到期后无法回滚。

#### 属性两层结构

```
最终属性 = 基础属性（卡面值）+ Σ 修正层
             ↑ 固定不变          ↑ 光环 / 临时 buff / 永久 debuff
```

每个单位持有 `mods: StatMod[]`，引擎按需重算派生值：

```ts
interface StatMod {
  id: string;          // 来源标识（技能 id），重算时按来源整体替换
  kind: 'aura' | 'temp' | 'permanent';
  attack?: number;
  health?: number;
  turns?: number;      // 'temp' 专用：剩余回合
}
```

#### 光环（aura）

技能声明 `kind: aura`，其 `effects` **不立即生效**，而是被"收集"成修正项。
收集时完整复用 DSL —— 条件、动态取值、目标选择器全部可用：

```yaml
- id: hu_wang
  name: 胡王
  kind: aura                      # 光环
  effects:
    - action: modify
      attack_from: { side: both, filter: { tag: man_zu } }   # 每有 1 名蛮族 +1
      health_from: { side: both, filter: { tag: man_zu } }
      target: { source: true }
```

**重算时机**（对应 `10-skills-statuses.md` §4 时机表）：

| 时机表步骤 | 事件 | 为什么 |
|---|---|---|
| 第 3 步 | 回合开始 | 回合间的状态变化 |
| 第 7 步 | 入场后 | 新单位可能改变光环条件 |
| 第 19 步 | 死亡后 | 来源阵亡或条件集合缩小 |
| 第 21 步 | 清除临时效果后 | 临时修正到期需重算 |

**重算算法**：① 清除全部 `kind: 'aura'` 修正 → ② 遍历双方存活单位的 aura 技能重新收集
→ ③ 按 `基础值 + Σ修正` 重写 `atk` / `maxHp`。

#### 生命修正的处理

生命上限变化时，当前生命**等量增减**并夹在 `[1, 上限]`：
获得 +1 上限同时回 1 血；失去 +1 上限则减 1 血，但**不会因光环失效而死亡**。

#### 约束

| 项 | 规则 |
|---|---|
| 光环内不用 `chance` | 每次重算都掷骰会导致数值抖动；需要随机请改用触发技 |
| 光环 id 唯一 | 同名光环不叠加，重算时整体替换，避免重复累加 |
| 临时修正有 `turns` | 到期由时机表第 21 步移除并触发重算 |

### 7.8 伤害重定向与免死（ADR-039）

> **公共逻辑**：三国卡的核心互动之一是"替人挨打"。周泰援护、陈宫分担、曹操护驾
> 三者机制**完全相同**——伤害本该打在 A 身上，改由 B 承受。做成一个通用机制，
> 卡面文案各自表述。

#### 伤害重定向

给**被保护者**施加带 `redirect_damage` 能力的守护状态，状态记录**守护者的 uid**；
`dealDamage` 在扣血前先查这个状态，命中则把伤害整体转给守护者。

```yaml
- action: apply_status
  status: shou_hu                  # 守护（caps: [redirect_damage]）
  duration: 1
  status_source: self              # ★ 把「来源单位」记为守护者
  target: { side: ally, filter: { type: character }, count: 1, mode: choose }
```

| 规则 | 说明 |
|---|---|
| 传递顺序 | 伤害**整体转移**（不是分摊），转移后原目标完全不受影响 |
| 守护者阵亡 | 守护者血量 ≤ 0 时守护自动失效，伤害回落到原目标 |
| 不自我守护 | 守护者 === 被保护者时忽略，避免自环 |
| 递归上限 | 最多转移 3 层，防止 A→B→A 死循环 |
| 触发时机 | 时机表**第 10 步之前**（免疫判定之前），因为"伤害根本没打到原目标" |

#### 免死（on_lethal）

单位受到致命伤害时触发一次判定，成功则以 1 血存活。用于周泰、夏侯惇。

```yaml
- id: bu_si
  name: 不屈
  kind: trigger
  trigger: on_lethal               # ★ 致命伤害时
  chance: 0.5                      # 一半概率（写在技能上）
  effects:
    - action: survive               # 以 1 血存活
```

| 规则 | 说明 |
|---|---|
| 频率 | 默认 `once`（一场一次）；数据可声明 `frequency` |
| 与免疫的区别 | 免疫在**扣血前**取消伤害；免死在**血量归零后**抬回 1 血 |
| 判定顺序 | 先免疫，再免死 |

### 7.9 主公状态 · 费用规则 · 弃牌属性（ADR-040）

#### ① 主公也可承载状态

`apply_status` 的目标可以是主帅（`target: { lord: true }`），
主帅状态存放在 `Lord.statuses`，与单位状态同构（`stacks` / `turns` / `srcUid`）。

用途：断粮（统率上限 −N）、主公技封锁、主公技次数加成。

```yaml
- action: apply_status
  status: duan_liang
  stacks: 2
  target: { side: enemy, lord: true }
```

| 相关能力 | 作用 |
|---|---|
| `block_lord_skill` | 该方主帅不能使用主公技（田丰） |
| `extra_lord_skill` | 该方主帅每回合主公技次数 +N（黄权，读取 `stacks`） |

断粮对统率上限的影响在**回合开始**结算：`上限 = min(10, 基础上限 + 1 − Σ断粮层数)`。

#### ② 卡牌自身的费用规则 `cost_rule`

手牌费用除受 `mods` 影响外，还可由卡牌定义声明一条**条件规则**（丁奉）：

```yaml
- id: wu_dingfeng
  cost: 4
  cost_rule:
    condition: { exists: { side: ally, filter: { type: character, health_max: 1 } } }
    value: -1                    # 满足条件时费用 −1
```

结算顺序：`卡面费用 → cost_rule → Σ mods`，下限 0。
规则在**每次计算费用时重新判定**，因此条件变化会自动反映。

#### ③ 读取被弃/被牺牲卡牌的属性

`discard` 等动作会把被弃的牌记入 `ctx.lastDiscarded`；后续效果可用
`value_from_discarded` 取其属性（程昱、华佗）：

```yaml
- action: discard
  count: 1
  target: { side: self, zone: hand }
- action: heal
  value_from_discarded: cost      # 按被弃牌的统帅值回血
  target: { side: ally, filter: { type: character }, count: 1 }
```

`value_from_discarded` 取值：`cost` | `health`。

## 7.10 平衡的基本等式（ADR-043）

> **这是本作数值设计的第一原则，任何时候都不许只看属性栏。**

```
属性点 + 关键词成本 + 技能价值 ≈ 2 × 费用 + 1
```

三项**互为替代**：属性低可以用强技能补，属性高就得砍技能。
所以看到"高费低属性"的卡，**先看它的技能值多少分**，再判断强弱。

| 项 | 计价方式 |
|---|---|
| 属性点 | 攻击 + 生命，1 点 = 1 分 |
| 关键词 | 见 `13-§4` 的成本表（负值，占用预算） |
| **技能价值** | 按效果折算，见下方 `effectValue` |

### 技能价值的折算表（实现于 `core/tools/validate.ts`）

| 效果 | 价值 | 说明 |
|---|---|---|
| 伤害 | ×0.5 / 点 | |
| 治疗 | ×0.4 / 点 | |
| 抽牌 | ×3 / 张 | |
| 召唤 | ×3 / 个 | |
| 施加震慑 | 5 | 强力控制 |
| 销毁 | 8 | |
| 夺取手牌 | ×3.5 | |
| 控制权转移 | 7 | |
| 免死 | 6 | |
| 复制技能 | 5 | |
| 属性修正 | ×1.5 / 点 × 目标数 | 动态取值（`*_from`）另按 2 点估 |
| 进化（transform） | `(进化后总价值 − 进化前总价值) × 单位数` | **ADR-046**：原先固定 4 分，会把最强与最弱的同构卡算成一样；来源卡从同技能的 `summon` 推断，取不到才退回 4 |
| 打 N 次（`eff.count`） | 上述单价 × N | **ADR-046**：`伤害/治疗/施加状态` 的 `count` 是次数，原先被忽略（张角 `count: 5` 只算 1 次） |
| AOE（`target.count: 'all'`） | 单价 × `AOE_NOMINAL`(2.5) | **ADR-046**：实际张数取决于场面，取名义值 |
| 主动技折扣 | ×0.8 | 可被震慑打断 |
| 触发技折扣 | 按时机 0.6–1.0 | 见 `TRIGGER_RATE` |

### 工程约定（踩过的坑）

- **DSL 存在 `skills[].dsl`**，不在 `skills[].effects`。
  计价时必须先摊平 `skills[].dsl`，否则**技能价值会被算成 0**，
  导致所有技能卡都被误判为"严重偏弱"。
- 新增效果动作时，**必须同步在 `effectValue` 里加估值**，
  否则该动作按 0 分计，同样会造成误判。

## 8. 示例校验（占位数值，非最终设计）

| 卡 | 费用 | 属性点 | 关键词 | 技能 | 总价值 | 预算 | 判定 |
|---|---|---|---|---|---|---|---|
| 步兵 | 1 | 3 | 结阵 −0.5 | — | 2.5 | 3 | 略低，可接受 |
| 盾兵 | 1 | 3 | 架盾 −1 | — | 4.0 | 3 | **超模 1 点，需调** |
| 弓箭手 | 1 | 2 | 神射 −0.5 | — | 2.5 | 3 | **偏弱 0.5 点** |
| 火攻（战法） | 3 | — | — | 4 伤害 = 2 | 2.0 | 7 | 偏弱（单体伤害价值低） |
| 灾年（事件） | 2 | — | — | 双方各 −1 血 | 对称 | 5 | 需实测 |

> 上表是**示例**，用于演示公式如何工作。人物卡的实际数值由策划提供后填入。

## 9. 数据文件组织

```
data/
├── cards.yaml            # 所有卡牌
├── keywords.yaml         # 关键词定义（id → 显示名、图标、价值）
├── statuses.yaml         # 状态定义
├── bonds.yaml            # 羁绊
├── jiuling.yaml          # 酒令
├── heroes.yaml           # 主公与主公技
└── schema/
    ├── card.schema.json
    ├── bond.schema.json
    └── jiuling.schema.json
```

## 10. 待调项

| 编号 | 项 | 说明 |
|---|---|---|
| T-13-1 | 关键词价值表的最终数值 | 实机测试后校准 |
| T-13-2 | 技能定价的等效价值系数 | 用模拟器回归 |
| T-13-3 | 组合折扣系数（当前 0.9） | 观察组合卡强度 |
| T-13-4 | 校验阈值（±1.5 / ±3） | 依据团队容忍度调整 |
