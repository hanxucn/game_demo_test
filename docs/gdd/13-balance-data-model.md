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
  side: ally | enemy | both | self      # 阵营
  filter:                               # 过滤条件
    type: troop | general | strategist | character
    keyword: xian_gong
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
