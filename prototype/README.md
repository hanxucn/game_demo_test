# 战场原型（引擎驱动）

> **规则 100% 来自 `core`**。本目录只负责渲染、动画、输入。

## 文件

| 文件 | 说明 |
|---|---|
| `battlefield.html` | 战场演示：引擎驱动的完整对局（出牌 / 攻击 / 主公技 / AI 对手） |
| `battlefield.engine.js` | 渲染 + 动画 + 输入 → Action（**不含任何规则判断**） |
| `deck-builder.html` | 独立卡组构筑页：收藏卡牌筛选、效果查看、卡组保存/读取（需要 `server/index.mjs`） |
| `deck-builder.js` | 卡组构筑页 API 调用与交互 |
| `setup.js` | 战场开局：阵营选择、手动/已保存卡组、换牌 |
| `card-render.css` / `.js` | 卡面与动画 |
| `card-gallery.html` | 卡面画廊（1:1 / 2×） |
| `style-lab.html` | 风格实验室（已定稿，保留对比） |
| `core.bundle.js` | 由 core 打包（**自动生成，勿手改**） |
| `data.bundle.js` | 由 data/*.yaml 生成（**自动生成，勿手改**） |
| `shot.sh` | 截图脚本（`CLEAN=1 ./prototype/shot.sh battlefield 1200 700`） |

## 重新构建

改了 core 或 data 之后必须重建：

```bash
# 数据（YAML → JSON → 浏览器数据包）
python3 tools/yaml2json.py
python3 tools/build-data-bundle.py

# 引擎（TS → 浏览器 IIFE 包）
cd core && npm run build:browser
```

## 本地启动

卡组保存和战场载入已保存卡组需要启动完整 Demo 服务：

```powershell
$node = "C:\Users\86188\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $node server/index.mjs
```

然后访问：

```text
http://127.0.0.1:8099/prototype/deck-builder.html
http://127.0.0.1:8099/prototype/battlefield.html
```

仅运行 `tools/serve.sh` 只能预览静态页面，不提供卡组 API。

## 当前构筑与对战流程

```text
卡组构筑页：筛选卡牌 → 查看效果 → 组成 30 张 → 保存到 SQLite
       ↓
战场页：选择阵营 → 手动/载入已保存卡组 → 换牌 → 开始对局
```

当前使用固定 `demo-user`，数据库文件为 `server/game.db`。规则校验仍由 `core/src/deck.ts` 和 `Core.validateDeck()` 负责。

## 演示能做什么

| 操作 | 结果 |
|---|---|
| **按住手牌拖到绿色格子** | 拖拽中卡牌跟随指针；可放置格显示"可放置"，悬停格显示"放下"；松手放置 |
| 点手牌（非人物卡） | 战法/事件卡无目标 → 点击直接打出 |
| 点我方单位 | 引擎返回合法目标 → 绿色高亮 + 判定理由（含"为什么不能打"） |
| 点高亮目标 | 引擎结算伤害/反击/死亡 → 动画播放 + 血量更新 |
| 点敌方空列单位 | **通道高亮 + 主公条变绿**（可直击主将） |
| 点主公技徽章 | 消耗 **1 统率**、**每回合 1 次**；需要目标的进入选目标模式 |
| 结束回合 | 引擎推进回合 → **AI 自动行动** |

### 攻击规则（由 core 判定，UI 只显示结论）

| 情况 | 可攻击目标 |
|---|---|
| 敌方场上有「架盾」（前军） | **只能打它**（可跨列） |
| 无敌方架盾 | 近战只能打**同列敌方前军** |
| 同列前军已空 | 可打该列**后军**（穿透） |
| 同列两排皆空 | 可打**敌方主将**（破阵斩将） |
| 弓箭手「神射」 | 可打任意列的人物卡（仍受架盾限制） |

## 关键约束

- `battlefield.engine.js` **不允许出现规则判断**（谁能打谁、伤害多少、费用够不够）
- 所有状态变更都来自 `Core.applyAction(...)` 返回的 `state`
- 所有动画都由 `Core.applyAction(...)` 返回的 `events` 驱动
- 事件是**已发生事实**，客户端不预判结果

## 踩过的坑

| 现象 | 根因 |
|---|---|
| 点敌方单位没反应、无法攻击 | `dataset.col` 是字符串 `"0"`，与数字 `0` 用 `===` 比较永远为 false。**必须 `Number(d.col)`** |
| 通道光束盖住敌方单位 | z-index 层级错误（光束在卡牌之上） |
| 选中单位时通道不高亮 | 只在全量渲染时更新通道，选中后没刷新 |

## 已知问题

- 卡面中心仍是占位大字（等立绘）
- 纯基础兵种对局容易僵持（见 `core/README.md` 的"已知设计问题"）
