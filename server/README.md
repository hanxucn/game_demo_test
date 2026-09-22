# Demo 服务与卡组 API

这是卡组构筑 Demo 的最小服务，使用 Node 24 内置 `node:sqlite`，不需要额外数据库依赖。

```powershell
$node = "C:\Users\86188\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $node server/index.mjs
```

启动后打开：

- 卡组构筑：<http://127.0.0.1:8099/prototype/deck-builder.html>
- 战场对战：<http://127.0.0.1:8099/prototype/battlefield.html>

如果 `8099` 被占用，可以在 PowerShell 中换端口：

```powershell
$env:PORT = 8100
& $node server/index.mjs
```

然后把地址中的端口换成 `8100`。

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

服务端会校验：30 张、阵营卡池、卡牌是否已拥有、基础兵最多 3 张、其他卡牌最多 1 张，以及卡牌是否处于可用状态。

## 页面流程

### 卡组构筑页

`deck-builder.html` 支持：

- 按阵营、类型、费用和名称筛选卡牌，类型与费用使用平铺按钮；
- 查看费用、属性、技能效果、关键词和 memo；
- 添加/移除卡牌，达到单卡上限或 30 张时禁用加入按钮；
- 新建、保存、读取已保存卡组；战场页会以醒目的卡组按钮展示可载入牌组，并禁用其他阵营牌组；
- 保存前由前端提示，保存时由服务端再次校验。

### 战场对战页

`battlefield.html` 支持：

1. 选择我方和敌方阵营；
2. 手动构筑、自动组卡，或载入 Demo 用户已保存卡组；
3. 换牌；
4. 进入由 `core` 驱动的出牌、攻击、技能和 AI 对战。

战场页面只负责输入、渲染和动画，规则由 `Core` 产生的状态与事件决定。
