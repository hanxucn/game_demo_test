# 《酒话三国》

> 三国题材**阵营卡牌对战**游戏。单局 6–8 分钟，一行 8 格战场，击破对方主公取胜。
> 技术栈：**Cocos Creator 3.8 LTS + TypeScript**（客户端）+ **纯 TS 规则引擎** **`core`** + **Go 服务端**（待建）；
> v1 目标平台是微信 / 抖音小游戏（横屏）。
>
> **当前阶段**：规则引擎已完成，浏览器原型可完整对局。本文是**上手与自测入口**。
> 想了解"为什么这么设计"，看 [AGENTS.md](AGENTS.md) 与 [PROJECT\_STATE.md](PROJECT_STATE.md)。

***

## 快速开始

### 0. 环境要求

| 依赖               | 版本          | 用途                                                    |
| ---------------- | ----------- | ----------------------------------------------------- |
| **Node**         | **≥ 22.18** | 跑引擎与本地服务（`node:sqlite` 内置 + 直接 import `core` 的 `.ts`） |
| python3 + PyYAML | —           | 重建数据产物（`tools/yaml2json.py`）                          |
| `core` 的 npm 依赖  | —           | 只有 `typecheck`（tsc）与 `build:browser`（esbuild）需要       |

```bash
cd core && npm install     # node_modules 不入库，新 clone 必做一次
```

> 不装也能跑 `npm test` / `validate` / `verify:dsl` / `smoke`（纯 node），
> 但 `tools/serve.sh` 启动时会重建产物，缺依赖会被拦住并提示这一句。

实测环境：Node **v22.23.2**。

### 1. 起服务（一条命令）

```bash
bash tools/serve.sh
```

启动后打开 **<http://127.0.0.1:8099/prototype/battlefield.html>**。

它同时提供**静态页面**与**卡组 API**，卡组存 `server/game.db`（关掉再开、换浏览器、换机器都还在）。

```bash
bash tools/serve.sh 9000         # 指定起始端口（被占会自动往后找 20 个）
bash tools/serve.sh --static     # 逃生口：纯静态、无 /api，卡组退化为存浏览器
```

停止：`Ctrl+C`，或 `pkill -f "server/index.mjs"`。
**重复启动不会报错**：它会认出本服务已在跑，直接打印地址并退出。

> **每次启动都会重建产物（\~0.5s）**，所以本地**不可能**跑到过期的引擎或数据。
> 这是为了让"改了 `core/` 却忘了重建 bundle"这类**静默失败**变回响亮失败 —— 详见 [AGENTS.md](AGENTS.md) 的钩子章节。

***

## 页面一览

服务起来后，这些页面都可直接打开：

| 页面                               | 用途                                                  |
| -------------------------------- | --------------------------------------------------- |
| **`prototype/battlefield.html`** | **主入口**：选阵营 → 构筑卡组（搜索 / 详情 / 保存 / 读取）→ 换牌 → 与 AI 对局 |
| **`prototype/card-test.html`**   | **逐张验证卡牌技能**                                        |
| `prototype/deck-builder.html`    | 独立卡组构筑页（与战场同源：同一套 `core` 规则 + 同一套存储）                |
| `prototype/card-gallery.html`    | 卡面画廊（1:1 / 2×）                                      |
| `prototype/style-lab.html`       | 风格实验室（已定稿，保留作对比）                                    |

***

## 卡牌测试页 `card-test.html`

> 想**快速验证某张卡的效果对不对**，用这条路径，不要开局打完整对局。

**两步走**（`card-test.html` 只是**选卡界面**，测试局实际跑在 `battlefield.html`）

**第 1 步 · 在** **`card-test.html`** **选卡**

**第 2 步 · 自动跳到** **`battlefield.html?...`** **开打**

```
http://127.0.0.1:8099/prototype/battlefield.html?test=shu_guanyu,wei_zhangliao&own=shu&enemy=wei
```

> ⚠️ **参数挂在** **`battlefield.html`** **上，不是** **`card-test.html`** **上。**
> `card-test.html` 自己不解析 URL 参数 —— 任何时候打开它都是选卡界面。
> 想复现同一个测试局，直接贴上面那条 `battlefield.html?test=...` 的链接。
> 战场页右下角有「卡牌测试」链接可以跳回选卡界面。

| 参数              | 含义                                              |
| --------------- | ----------------------------------------------- |
| `test`          | 逗号分隔的卡 id，**1–10 张、不可重复、必须可构筑且无** **`pending`** |
| `own` / `enemy` | 双方阵营（`shu` / `wei` / `wu`）                      |
| `ai`            | `1` = 敌方 AI 会行动                                 |

参数不合法时（比如卡 id 写错、超过 10 张、重复），战场页会**直接跳回** **`card-test.html`** **选卡界面**（实测），不会白屏、也不会进正常开局流程；在选卡界面点「开始测试」时也会先校验，不合法会提示「请选择 1～10 张有效卡牌」。

**测试局的预设**（这些便利条件只作用于测试模式，不改正式规则）

| 项    | 值                              |
| ---- | ------------------------------ |
| 先手   | **我方**（固定）                     |
| 我方统率 | **10 点**（直接给满，方便测高费卡）          |
| 我方手牌 | **就是你选的那些卡**                   |
| 我方牌库 | 你选的卡**循环填满 30 张** → 所以你会反复抽到它们 |
| 我方场上 | 1 个白板步兵（**当技能靶子**用）            |
| 敌方场上 | **5 个白板步兵**（当群体技能靶子）           |
| 敌方牌库 | 30 张白板步兵                       |
| 敌方回合 | **默认跳过**；勾了「敌方 AI 行动」才会真的动     |

***

## 测试与校验

### A. 不需要 `npm install`（纯 node）

```bash
node tools/render-gdd.mjs        # 重建 docs/gdd/index.html（改过 docs/gdd/*.md 后跑）
bash tools/build-cards.sh        # 只读三步：导出运行时 JSON → 校验 → 重建浏览器 bundle

cd core
npm test                         # 规则 / 引擎 / 回放确定性 / DSL / AI
npm run validate                 # 卡牌数据校验（结构 + 字段白名单 + 注册表 + 文案一致性）
npm run verify:dsl               # 逐张跑真实卡牌的 DSL，端到端
npm run smoke                    # 两个 AI 互打一局 + 回放一致性
npm run ai:report                # AI 对局统计（攻击构成 / 技能使用 / 决策耗时）
```

### B. 需要 `cd core && npm install`

```bash
cd core
npm run typecheck                # tsc --noEmit
npm run build:browser            # esbuild → prototype/core.bundle.js
```

### 改完数据 / 引擎后的标准流程

```bash
bash tools/build-cards.sh
cd core && npm test && npm run typecheck && npm run validate && npm run verify:dsl && npm run smoke
```

**当前基线**（本机实测，供对照 —— 数字变了说明内容变了）

| 命令                   | 结果                 |
| -------------------- | ------------------ |
| `npm test`           | **295 通过 / 0 失败**  |
| `npm run typecheck`  | 通过                 |
| `npm run validate`   | **0 错误 / 13 警告**   |
| `npm run verify:dsl` | **133 张通过 / 0 失败** |
| `npm run smoke`      | 我方胜利，**回放校验完全一致**  |

***

## 目录结构

```
data/          卡牌内容（唯一手写真源）
  cards.yaml     ← 加卡 / 改数值 / 改技能，只改这里
  heroes.yaml    主公与非卡牌配置
  keywords.yaml / statuses.yaml / tags.yaml
core/          纯 TypeScript 规则引擎（零引擎依赖）+ 测试 + 数据校验工具
prototype/     浏览器原型：只负责渲染 / 动画 / 输入，规则 100% 来自 core
server/        本地服务：静态页面 + 卡组 API（node:sqlite，卡组存 game.db）
tools/         构建与校验脚本
docs/          设计文档；docs/gdd/ 是机制的唯一真源
```

各目录还有更细的说明：[`prototype/README.md`](prototype/README.md)、[`server/README.md`](server/README.md)、[`data/README.md`](data/README.md)、[`docs/gdd/README.md`](docs/gdd/README.md)。

***

## 两条铁律（改代码前必读）

### 1. 加一张卡 = 只改 `data/cards.yaml`

`data/cards.yaml` 是**唯一手写真源**，且**没有任何脚本会写它** ——
`bash tools/build-cards.sh` 只是"只读的校验 + 导出"。

允许的字段写在文件头，**写了名单外的字段** **`npm run validate`** **会直接报错**（不再静默丢弃）。

### 2. 改了 `core/src/*.ts` 必须重建浏览器产物

浏览器跑的是 `prototype/core.bundle.js`，不是源码。
忘了重建的症状是**静默的**：页面照常打开、照常能玩，只是规则是旧的。

两道保险已经装好，正常不会踩到：

***

## 常见问题

| 症状                                 | 原因与处理                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------- |
| 改了规则但页面行为不变                        | 多半是 bundle 过期。用 `bash tools/serve.sh` 启动（会自动重建），或手动 `cd core && npm run build:browser`  |
| 页面**一片黑**                          | `prototype/core.bundle.js` 缺失（`window.Core` undefined）→ 跑一次 `bash tools/build-cards.sh` |
| 卡组"换浏览器就没了"                        | 你在 `--static` 模式或 `file://` 下打开的。用 `bash tools/serve.sh` 走完整服务                          |
| `serve.sh` 提示缺 `core/node_modules` | `cd core && npm install`                                                                |
| 端口被占                               | 自动往后找 20 个；也可 `bash tools/serve.sh 9000`                                                |
| `npm run validate` 报「未知字段」         | 字段名不在 `cards.yaml` 头部的白名单里，改成合法字段                                                       |

***

## 已知遗留（不要被误导）

| 项                                                               | 状态                                                                                                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prototype/rules.js` + `prototype/rules-check.mjs`              | **core 之前的独立规则模块，已被取代。** `rules.js` 现在只剩"关键词图标表"给 `card-render.js` 用；`rules-check.mjs` 的 13 条断言测的是**旧的 5 列规则**，与现行规则不符 —— 保留作历史对照，别拿它当验收                  |
| `docs/gdd/01-overview.md` / `07-troops.md` / `PROJECT_STATE.md` | 部分内容仍写着**已作废的「5 列 × 2 排」**（现行是 ADR-051 的**一行 8 格**）。`07-troops.md` 文首已加过时横幅                                                                               |
| `.gitignore`                                                    | `docs/gdd/index.html` 与 `prototype/_probe.html` 两行**带了行尾注释**，而 gitignore 不支持行尾注释 → 这两条**实际未生效**（已用 `git check-ignore` 证实）。目前靠人工注意：**不要** **`git add -A`** |

***

## 文档索引

| 文档                                                                             | 内容                                                           |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| [AGENTS.md](AGENTS.md)                                                         | **工程约定**：目录结构、四条铁律、验证命令、命名规范、提交约定                            |
| [PROJECT\_STATE.md](PROJECT_STATE.md)                                          | **项目记忆快照**：已定决策、ADR 索引、进度与下一步                                |
| [`docs/gdd/`](docs/gdd/)                                                       | **机制唯一真源**（`02-battlefield.md` 是规则地基）；`index.html` 是生成的单页阅读版 |
| [`docs/gameplay-archetypes-proposal.md`](docs/gameplay-archetypes-proposal.md) | 玩法重构提案：低费断层、士兵体系、阵营原型                                        |
| [`docs/gdd/17-troop-system-rework.md`](docs/gdd/17-troop-system-rework.md)     | 兵种与 14 个特种兵设计稿                                               |
| [`docs/BACKLOG-skills.md`](docs/BACKLOG-skills.md)                             | 待办：技能 B 类 + 战吼前端                                             |

