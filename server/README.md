# Demo 服务与卡组 API

这是卡组构筑 Demo 的最小服务。它做两件事：**发静态页面** + **提供卡组 API**，
卡组存 `server/game.db`（Node 内置 `node:sqlite`，不需要任何额外数据库依赖）。

```bash
bash tools/serve.sh              # 推荐入口：一条命令起本服务（静态页面 + 卡组 API）
node server/index.mjs            # 等价：直接起本服务，默认 8099
PORT=8100 node server/index.mjs  # 指定起始端口（被占会自动往后找）
```

**运行要求：Node ≥ 22.18**。两个下限叠在一起：
- `node:sqlite` 需要 ≥ 22.5（22.x 上会打一条 experimental 警告，属正常）
- 服务端 `import '../core/src/deck.ts'` 复用引擎的组卡规则，需要默认开启的类型剥离（≥ 22.18）

不需要 `npm install`：`node:sqlite` 是内置模块，`core/data/*.json` 已入库。

启动后打开：

- 战场对战：<http://127.0.0.1:8099/prototype/battlefield.html>（**构筑已并入开局第 2 步**）
- 卡组构筑：<http://127.0.0.1:8099/prototype/deck-builder.html>（独立入口，同一套规则与存储）

> `tools/serve.sh` 现在**委托给本服务**（ADR-097）—— 它原先自己起 python 的 `http.server`，
> 不提供 `/api`，所以"只开 serve.sh"时卡组只能退化成存浏览器。合并后一条命令就有持久化。
> 它同时保留 `bash tools/serve.sh --static` 作为逃生口：纯静态、无 `/api`，
> 用于验证「没有服务端时页面还能不能用」（此时卡组存浏览器 `localStorage`）。
>
> 端口被占会自动往后找 20 个；重复启动会认出本服务已在跑、直接打印地址并退出。

首次启动会创建 `server/game.db`，同步 `core/data/cards.json`，创建固定 `demo-user`，并把当前已实现的可构筑卡牌加入收藏。`game.db` 是运行时数据，不要作为卡牌内容真源；改卡牌后重新生成 JSON 并重启服务即可同步。

## 固定用户与数据

当前版本固定使用 `demo-user`，暂时没有登录、注册和鉴权流程。首次启动会：

1. 创建 `server/game.db` 和数据库表；
2. 从 `core/data/cards.json` 同步卡牌目录；
3. 创建 Demo 用户；
4. 将当前非 `pending` 的可构筑卡牌加入 Demo 收藏。

`data/*.yaml` 仍然是卡牌内容真源，SQLite 只保存运行时目录、收藏和卡组数据。

## API

所有接口返回 JSON。卡牌 ID 使用 `data/cards.yaml` 中的稳定 ID。

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/api/health` | 服务健康检查 |
| `GET` | `/api/users/demo-user` | 读取固定 Demo 用户 |
| `GET` | `/api/cards?faction=shu` | 查询可构筑卡牌目录 |
| `GET` | `/api/users/demo-user/cards?faction=shu` | 查询 Demo 收藏和卡牌效果 |
| `GET` | `/api/users/demo-user/decks` | 查询已保存卡组摘要 |
| `GET` | `/api/users/demo-user/decks/:id` | 查询卡组明细 |
| `POST` | `/api/users/demo-user/decks` | 创建卡组 |
| `PUT` | `/api/users/demo-user/decks/:id` | 修改卡组并增加 revision |
| `DELETE` | `/api/users/demo-user/decks/:id` | 删除卡组 |

创建或修改卡组的请求示例：

```json
{
  "name": "蜀国测试卡组",
  "faction": "shu",
  "cards": [
    { "cardId": "shu_guanyu", "quantity": 1 },
    { "cardId": "neutral_infantry", "quantity": 3 }
  ]
}
```

校验分两层，职责不重叠：

| 层 | 管什么 | 真源 |
|---|---|---|
| **组卡规则** | 30 张、阵营池（本方 + 中立/群雄）、同名上限（基础兵 3 / 其余 1）、可否组入、主公不进卡组 | `core/src/deck.ts` —— 服务端**直接 import**，不重写 |
| **玩家状态** | 卡是否启用、是否已实现、是否拥有足够张数 | `server/game.db`（只有服务端知道） |

> 从前「组卡规则」在服务端被抄了第二份（`DECK_SIZE` / `PUBLIC_POOL` / 白名单 `DECKABLE_TYPES` /
> `quantity > 3`），和引擎各存一份。已实测出漂移：core 用黑名单 `NON_DECK_TYPES`（新增卡型默认**可**组），
> 服务端用白名单（新增卡型默认**不可**组）—— 默认相反，只是当前卡型恰好重合。现在统一到 core（ADR-095）。

## 页面流程

### 战场对战页（主入口）

`battlefield.html`：

1. 选择我方和敌方阵营；
2. **构筑卡组 —— 完整能力都在这一步，不再跳页**：搜索名称/ID、悬停看完整效果与关键词、
   手动加入/移除、自动组卡、按建议曲线对照、命名并保存、读取、删除；
3. 换牌；
4. 进入由 `core` 驱动的出牌、攻击、技能和 AI 对战。

存储模式（服务端 / 本地浏览器）由 `deck-store.js` 自动判定，页面顶部明示当前是哪种；
本地攒下的卡组会标「未同步」，服务端起来后可一键上传（不自动覆盖、不自动丢弃）。

### 卡组构筑页（独立入口）

`deck-builder.html` 提供同一套能力的独立入口，适合专心配牌：

- 按阵营、类型、费用和名称筛选卡牌；
- 查看费用、属性、技能效果、关键词和 memo；
- 添加/移除卡牌，达到单卡上限或 30 张时禁用加入按钮；
- 新建、保存、读取、删除已保存卡组。

它与战场页**共用同一套规则与存储**（`Core.*` + `DeckStore`），因此没有服务端时同样可用。

战场页面只负责输入、渲染和动画，规则由 `Core` 产生的状态与事件决定。
