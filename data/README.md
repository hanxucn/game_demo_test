# 数据层说明

> 本目录是**游戏内容的唯一数据源**。`core` 与 `client` 都从这里读取，不允许把卡牌数值硬编码进代码。

## 文件清单

| 文件 | 内容 | 状态 |
|---|---|---|
| `keywords.yaml` | 12 个关键词定义 | 已定 |
| `statuses.yaml` | 12 个状态定义 | 已定 |
| `cards.yaml` | 卡牌数据 | **仅含已确认内容**（基础兵种 + 传国玉玺），其余待策划填写 |
| `characters.draft.yaml` | **人物卡录入区**（口述录入，集中一个文本） | 录入中，不参与构建 |
| `cards_photo.draft.yaml` | **照片识图录入区**（手写设计稿逐字转录，115 张卡） | 待确认，不参与构建 |
| `cards_photo.QUESTIONS.md` | 照片转录的**待确认清单**（系统性约定 + 325 处疑点） | 待设计者回答 |
| `transcribe/batch_*.yaml` | 识图转录的**分批次原始记录**（8 批，含每张照片的疑点细节） | 中间产物，不参与构建 |
| `heroes.yaml` | 四主公与主公技 | 待补（曹操/群雄待选） |
| `bonds.yaml` | 羁绊 | 草案 |
| `jiuling.yaml` | 酒令 | 草案 |
| `schema/` | JSON Schema 校验文件 | 待补 |

## 命名约定

| 前缀 | 用途 | 示例 |
|---|---|---|
| `shu_` / `wei_` / `wu_` / `qun_` | 阵营人物卡 | `shu_guanyu` |
| `neutral_` | 中立卡 | `neutral_infantry` |
| `event_` | 事件卡 | `event_zainian` |
| `tactic_` | 战法卡 | `tactic_huogong` |
| `elite_` | 特殊兵种卡 | `elite_hubaogi` |
| `jiuling_` | 酒令 | `jiuling_wenjiu` |
| `bond_` | 羁绊 | `bond_taoyuan` |

## 卡牌字段

完整字段说明见 `docs/gdd/05-cards.md` §2，效果 DSL 见 `docs/gdd/13-balance-data-model.md` §7。

## 校验规则

新增卡牌时必须通过以下检查（CI 自动执行）：

| # | 检查 | 失败处理 |
|---|---|---|
| 1 | 总价值超出同费预算 ±1.5 点 | 警告 |
| 2 | 总价值超出 ±3 点 | 报错 |
| 3 | 卡名长度 > 4 字 | 报错 |
| 4 | 非法关键词组合（架盾 + 奇袭） | 报错 |
| 5 | 谋臣卡攻击力 > 1 | 报错（ADR-015：不再强制为 0，上限 1）|
| 6 | 进化卡目标兵种不存在 | 报错 |
| 7 | 羁绊引用的人物 id 不存在 | 报错 |
| 8 | 引用了未注册的 action / status / keyword | 报错 |
| 9 | 缺少 `memo` | 警告 |

## 如何新增一张卡

1. 在 `cards.yaml` 追加一条记录，按 `docs/gdd/05-cards.md` §5 的模板填写；
2. 用 `docs/gdd/13-balance-data-model.md` 的公式自检总价值；
3. 运行校验器；
4. **不需要改任何代码**——如果发现必须改代码才能实现，说明效果 DSL 需要扩展，请先更新 `13-balance-data-model.md`。

## 人物卡录入流程（口述 → 集中整理）

人物卡（武将 / 谋臣）的录入走**两步**，避免半成品数值污染构建：

| 步骤 | 落在哪 | 谁做 |
|---|---|---|
| ① 录入 | `characters.draft.yaml`（人物集中一个文本） | 策划口述，AI 按模板完整录入 |
| ② 整理 | `cards.yaml` 的「人物卡」段 ← **唯一真源** | AI 集中整理 + 跑校验 |

**为什么要有录入区**：`tools/yaml2json.py` 只读 `data/*.yaml` 且**自动跳过 `*.draft.yaml`**，所以
草稿区写什么都不可能进 `core/data/*.json`，也就不会让 `npm run validate` 挂掉。

**录入时 AI 必须做**：

1. 按 `docs/gdd/05-cards.md` §5.1 模板**补全所有字段**（缺的信息先追问，不臆造）；
2. 技能按 `docs/gdd/10-skills-statuses.md` §2 翻成 `kind / trigger / target / effects` DSL；
3. 引用只能取已注册的 id：关键词见 `keywords.yaml`、状态见 `statuses.yaml`、
   动作见 `core/src/constants.ts` 的 `ACTIONS`（14 个）；
4. 自查两条硬规则：卡名 ≤4 字、`memo` 必填；
5. 补 `_meta.open` 记录**未定项**，不要用猜测值填坑。

**整理时执行**：

```bash
python3 tools/yaml2json.py && cd core && npm run validate -- --verbose
```

`--verbose` 会逐张打印「属性 / 关键词 / 技能 = 总价值 / 预算」，
偏离预算 ±1.5 警告、±3 报错（`13-balance-data-model.md` §5）。

## 当前进度

- ✅ 基础兵种 3 张（步兵 / 盾兵 / 弓箭手）
- ✅ 传国玉玺
- 🟡 武将卡（**录入中** → `characters.draft.yaml`，5 人：吴·宋谦/朱然/全琮/马忠/李异）
- 🟡 谋臣卡（**录入中** → 同文件，1 人：吴·鲁肃）
- ⬜ 事件卡（照片稿已有 6 张，待整理）
- ⬜ 战法/计策卡（照片稿已有 18 张，待整理）
- 🟡 **手写设计稿 115 张**（照片识图 → `cards_photo.draft.yaml`；疑点清单见 `cards_photo.QUESTIONS.md`）
- ⬜ 特殊兵种卡（草案见 `docs/gdd/07-troops.md` §4）
- ⬜ 酒令（草案见 `docs/gdd/11-events-tactics-jiuling.md` §3）
