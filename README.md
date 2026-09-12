# 酒店 PMS 管理系统

基于 **Node.js + Express + SQLite**（后端）与 **Vue 3 + Element Plus**（前端）的酒店物业管理系统，包含三大核心模块：

- **房态图**：按日期/房型/楼层查看所有房间状态（空净/空脏/占净/占脏/维修/预抵/预离），点击房间卡片可办理入住、退房、续住、换房、预订、维护房态与查看客账
- **订单管理**：订单全生命周期（预订 → 入住 → 在住 → 退房/取消/未到），支持续住调整、调价、自动房费明细
- **账务管理**：客账管理（房费/杂费/押金/收款/调整/冲销）、账务流水、营业报表（收入分类、收款方式、按日营收、入住率、ADR）

## 快速开始

```bash
# 1. 安装全部依赖（根 + client）
npm run install:all

# 2. 开发模式（后端 :3001 + 前端热更新 :5175，前端代理 /api）
npm run dev
# 打开 http://localhost:5175

# 3. 或生产模式（构建前端后由 Express 托管，单端口）
npm run build
npm start
# 打开 http://localhost:3001
```

> 首次启动会按 `config/stores.json` 为每个门店创建独立数据库 `data/stores/<门店key>.db`，
> 并把配置里的房型与房间同步进去。默认内置 4 个演示账号（`store1` ~ `store4`，初始密码 `Pms@123456`）。
> 如需重置某家店的数据，删除对应的 `data/stores/<key>.db*` 后重启即可。

## 多门店与登录

一个实例可同时服务多家门店，**每家门店一个独立 SQLite 文件**，数据物理隔离（登录哪家账号就只能看到哪家店的房间与订单）。

- **账号与房间数据跟随 git**：由 `config/stores.json`（及 `config/rooms/*.json`）定义，每次启动按配置同步。
  房间按 `room_no` 匹配更新，**保持房间 id 不变**，因此历史订单不会失效；同步过程绝不触碰订单/账务表。
- **订单数据不跟随**：订单在各店自己的数据库里，题目录 `data/` 已被 gitignore，代码升级不会影响。
- **改密码**：`npm run hash-password -- <新密码>` 生成哈希，替换 `config/stores.json` 里的 `passwordHash` 后重启。
- **旧库导入**：首次启动时，若存在遗留的 `data/pms.db`，把它归入 `config/stores.json` 的 `legacyStore` 指定门店
  （订单原样保留）。归属不明确时不会自动认领，需设置 `PMS_LEGACY_STORE=<key>`。
- **备份**：`npm run backup` 会逐店生成快照到 `data/backup/<key>/`。
- **门锁制卡**：硬件设置（启用/串口/门锁库账号）属机器级，写在 `config/machine.json`；
  各店的楼栋号在 `config/stores.json` 的 `card.building` 配置，避免共用一套门锁系统时房号冲突。
  一台机器只有一个读卡器，制卡调用已串行化。

### 环境变量

| 变量 | 说明 |
| --- | --- |
| `PMS_DATA_DIR` | 数据目录（默认 `./data`），存放各店数据库与会话密钥 |
| `PMS_CONFIG` | 门店配置文件路径（默认 `./config/stores.json`） |
| `PMS_STORE_KEYS` | 只启用配置中的部分门店（一店一实例部署时用，逗号分隔） |
| `PMS_LEGACY_STORE` | 遗留 `pms.db` 归属的门店 key |
| `PMS_SESSION_SECRET` | 会话签名密钥；不设则在数据目录生成并持久化 `session.key` |
| `PMS_COOKIE_SECURE` | 设为 `1` 时 Cookie 加 `Secure`（HTTPS 部署） |
| `PORT` | 服务端口（默认 3001） |

## 使用说明

### 房态图
- 切换日期可查看任意一天的房态；图例说明右上角颜色含义
- 点击房间卡片 → 弹出房间详情与当前订单，按状态提供快捷操作：
  - 空房：预订 / 散客直接入住 / 设干净 / 设脏 / 维修封房
  - 在住：办理入住 / 退房 / 续住改单 / 换房 / 查看账单
  - 维修房：解封
- 顶部工具栏"散客入住"可直接办理未预定客人入住

### 订单管理
- 筛选：状态、日期范围（按入住日期）、关键字（单号/客人/手机/房号）
- 新建订单：可选已有宾客或直接录入（后台自动建档）；可暂不指定房间（预订）
- 行操作按状态显示：入住房态、改单、取消、未到、退房、续住、换房、账单
- **退房结算**：系统按实际离店日期自动调平房费（多退少补），提示应收/应退/找零，支持部分收款挂欠款；退房后房间自动置"脏"
- **在住改单**：修改入住/离店日期或房价后，房费明细自动按新间夜重新生成

### 账务管理
- **客账管理**：选择订单查看客账并操作：加账（杂费）、收款、押金、账务调整、冲销明细；收付正负颜色区分，余额实时计算（正=客欠，负=酒店应退）
- **账务流水**：按日期范围/关键字检索全部账目，支持冲销，展示合计净额
- **营业报表**：消费合计、房费收入、杂费、实收、押金、退款、间夜、入住率、ADR、收入分类、收款方式、按日营收柱状图

## 业务规则

- 订单状态机：`reserved → checked_in → checked_out`，旁路 `cancelled` / `no_show`
- 房费：入住时按每晚生成一条 `room_charge`（每夜金额 = 订单房价）；退房/改单按实际间夜自动增补或冲销
- 账目符号约定：正数 = 应收增加（消费/房费），负数 = 应收减少（押金/收款/退款）；订单余额 = 账目合计
- 房价与金额按两位小数计算；订单号格式 `RSV+时间戳+序号`（唯一）
- 客房状态 `clean/dirty/ooo` 与订单状态联动：退房自动置脏、入住后可换房（旧房置脏）、维修房不可预订

## 目录结构

```
pms/
├── package.json              # 根脚本：install:all / dev(concurrently) / build / start / backup / hash-password
├── config/
│   ├── stores.json           # 门店 + 账号配置（跟随 git）
│   ├── machine.json          # 机器级门锁硬件配置
│   └── rooms/<key>.json      # 各店房型与房间方案（跟随 git）
├── data/                     # 运行时数据（gitignore）：stores/<key>.db、session.key、backup/
├── server/
│   ├── index.js              # Express 入口：公开登录接口 → 鉴权网关 → 业务 API + 静态托管 client/dist
│   ├── db.js                 # 建表 + 逐店引导 + 房间同步
│   ├── stores/config.js      # 门店配置加载与校验
│   ├── stores/registry.js    # 各店数据库句柄 + AsyncLocalStorage 上下文 + 旧库认领
│   ├── auth/session.js       # scrypt 密码哈希 + HMAC 签名 Cookie
│   ├── middleware/storeContext.js  # 鉴权并绑定门店上下文
│   ├── folio.js              # 客账业务（房费同步/余额）
│   ├── errors.js / utils.js
│   └── routes/
│       ├── auth.js           # 登录 / 登出 / 当前会话
│       ├── rooms.js          # 房型/房间 CRUD、客房状态、房态图计算
│       ├── reservations.js   # 订单 CRUD + 入住/退房/取消/未到/换房
│       ├── finance.js        # 客账/流水/营业报表
│       └── stats.js          # 今日经营概况
└── client/
    └── src/
        ├── views/            # RoomStatus / Orders / Finance 三大页面
        ├── components/       # ReservationForm / CheckIn / CheckOut / ChangeRoom / Folio
        ├── utils/format.js   # 金额/日期/状态映射
        └── api/ store.js
```

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Node.js ≥ 22（内置 `node:sqlite`）、Express 4 |
| 数据库 | SQLite（WAL 模式，一店一个库文件，零依赖） |
| 鉴权 | 自建会话（scrypt 密码哈希 + HMAC 签名 httpOnly Cookie，无第三方依赖） |
| 前端 | Vue 3、Vite 5、Element Plus、vue-router、axios |

## 接口速览

```
POST /api/auth/login           登录 {username,password} → 下发 httpOnly 会话 Cookie
POST /api/auth/logout          退出登录
GET  /api/auth/me              当前门店与账号

# 以下接口均需登录，且自动限定在登录账号所属门店
GET  /api/room-status?date=    房态图
GET  /api/stats/today          今日概况
GET/POST/PUT/DELETE /api/room-types, /api/rooms
PUT  /api/rooms/:id/status     客房状态
GET  /api/reservations         订单列表(筛选/分页)
POST /api/reservations         新建(可直接入住)
POST /api/reservations/:id/check-in | check-out | cancel | no-show | change-room
GET  /api/finance/folio?reservation_id=   客账明细
POST /api/finance/items        加账/收款/押金/调整
GET  /api/finance/transactions 账务流水
GET  /api/finance/report       营业报表
```

## 数据库表

- `room_types` 房型（名称/门市价）
- `rooms` 房间（房号/楼层/房型/客房状态）
- `guests` 宾客档案（姓名/电话/证件/会员等级）
- `reservations` 订单（单号/宾客/房型/房间/入住离店/房价总额/状态/来源）
- `folio_items` 客账明细（类型/类别/说明/金额/方式/时间）
