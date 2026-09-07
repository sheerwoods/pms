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

> 首次启动会自动创建 `data/pms.db`（SQLite 单文件）并写入演示种子数据：
> 4 种房型、24 间房（3 层）、若干宾客与订单（今日预抵 / 在住 / 预离 / 已退 / 已取消），开箱即可演示全部流程。
> 如需重置数据，删除 `data/pms.db*` 后重启即可。

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
├── package.json              # 根脚本：install:all / dev(concurrently) / build / start
├── data/                     # SQLite 数据文件（自动生成）
├── server/
│   ├── index.js              # Express 入口：API + 静态托管 client/dist
│   ├── db.js                 # 建表 + 种子数据
│   ├── folio.js              # 客账业务（房费同步/余额）
│   ├── errors.js / utils.js
│   └── routes/
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
| 数据库 | SQLite（WAL 模式，单文件，零依赖） |
| 前端 | Vue 3、Vite 5、Element Plus、vue-router、axios |

## 接口速览

```
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
