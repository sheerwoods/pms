// SQLite 初始化 / 建表 / 种子数据
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { fmt, addDays, nightsBetween, genOrderNo, round2 } = require('./utils');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'pms.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// 便捷查询
const q = (sql, ...params) => db.prepare(sql).all(...params);
const get = (sql, ...params) => db.prepare(sql).get(...params);
const run = (sql, ...params) => db.prepare(sql).run(...params);

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      base_price REAL NOT NULL DEFAULT 0,
      remark TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_no TEXT NOT NULL UNIQUE,
      floor INTEGER DEFAULT 1,
      type_id INTEGER REFERENCES room_types(id),
      status TEXT NOT NULL DEFAULT 'clean',   -- clean / dirty / ooo
      remark TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      id_card TEXT DEFAULT '',
      member_level TEXT DEFAULT '普通',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL UNIQUE,
      guest_id INTEGER REFERENCES guests(id),
      guest_name TEXT NOT NULL,
      guest_phone TEXT DEFAULT '',
      guest_id_card TEXT DEFAULT '',
      room_type_id INTEGER REFERENCES room_types(id),
      room_id INTEGER REFERENCES rooms(id),
      check_in_date TEXT NOT NULL,
      check_out_date TEXT NOT NULL,
      nights INTEGER NOT NULL,
      adults INTEGER DEFAULT 1,
      rate REAL NOT NULL DEFAULT 0,
      rooms INTEGER DEFAULT 1,
      total_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'reserved', -- reserved / checked_in / checked_out / cancelled / no_show
      booking_type TEXT DEFAULT '全日房',      -- 全日房 / 钟点房
      rates TEXT DEFAULT '{}',                  -- 各日期房价 JSON {"YYYY-MM-DD": price}（首行房型）
      lines TEXT DEFAULT '[]',                  -- 多预定房型 JSON [{room_type_id, rooms, rate, rates}]
      source TEXT DEFAULT '散客',
      source_order_no TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      actual_check_in TEXT,
      actual_check_out TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS folio_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id),
      guest_id INTEGER REFERENCES guests(id),
      item_type TEXT NOT NULL,       -- room_charge / extra_charge / payment / adj / info
      category TEXT DEFAULT '',
      description TEXT DEFAULT '',
      amount REAL NOT NULL,          -- 正=应收增加(消费) 负=应收减少(付款/收款)
      method TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS reservation_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id),
      room_id INTEGER REFERENCES rooms(id),
      room_type_id INTEGER REFERENCES room_types(id),
      line_index INTEGER DEFAULT 0,
      guest_name TEXT DEFAULT '',
      guest_id_card TEXT DEFAULT '',
      guest_phone TEXT DEFAULT '',
      cohabitors TEXT DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',  -- pending / checked_in / checked_out
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status);
    CREATE INDEX IF NOT EXISTS idx_res_room ON reservations(room_id, status);
    CREATE INDEX IF NOT EXISTS idx_folio_res ON folio_items(reservation_id);
    CREATE INDEX IF NOT EXISTS idx_res_room_res ON reservation_rooms(reservation_id);
    CREATE INDEX IF NOT EXISTS idx_res_room_room ON reservation_rooms(room_id);
  `);

  // 旧库升级：为已存在的 reservations 表补充新字段
  const resCols = q('PRAGMA table_info(reservations)').map((c) => c.name);
  if (!resCols.includes('source_order_no')) run("ALTER TABLE reservations ADD COLUMN source_order_no TEXT DEFAULT ''");
  if (!resCols.includes('rooms')) run('ALTER TABLE reservations ADD COLUMN rooms INTEGER DEFAULT 1');
  if (!resCols.includes('booking_type')) run("ALTER TABLE reservations ADD COLUMN booking_type TEXT DEFAULT '全日房'");
  if (!resCols.includes('rates')) run("ALTER TABLE reservations ADD COLUMN rates TEXT DEFAULT '{}'");
  if (!resCols.includes('lines')) run("ALTER TABLE reservations ADD COLUMN lines TEXT DEFAULT '[]'");
  if (!resCols.includes('guest_id_card')) run("ALTER TABLE reservations ADD COLUMN guest_id_card TEXT DEFAULT ''");

  // residence_rooms 状态列（分批入住）
  const rrCols = q('PRAGMA table_info(reservation_rooms)').map((c) => c.name);
  if (!rrCols.includes('status')) run("ALTER TABLE reservation_rooms ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
}

// 展开为逐间单元：每个 房型行 × 每间 一条，携带行下标与房型
function unitInfos(r) {
  let lines = [];
  try { const arr = r.lines ? JSON.parse(r.lines) : []; lines = (Array.isArray(arr) && arr.length) ? arr : []; } catch { /* */ }
  if (!lines.length) lines = [{ room_type_id: r.room_type_id || null, rooms: r.rooms || 1 }];
  const out = [];
  lines.forEach((ln, li) => {
    const rooms = Math.max(1, Number(ln.rooms) || 1);
    for (let m = 0; m < rooms; m++) out.push({ line_index: li, room_type_id: ln.room_type_id || null });
  });
  return out;
}

// 下载/迁移回填：设置已入住行状态，并按单元补齐每间待入住行（幂等）
function backfillReservationRooms() {
  // 1) 已入住订单的既有行置为 checked_in
  run("UPDATE reservation_rooms SET status='checked_in' WHERE status='pending' AND reservation_id IN (SELECT id FROM reservations WHERE status='checked_in')");

  // 2) 确保每个 active 预订有 totalRoomCount 行
  const res = q("SELECT * FROM reservations WHERE status IN ('reserved','checked_in')");
  for (const r of res) {
    const existing = q('SELECT * FROM reservation_rooms WHERE reservation_id=? ORDER BY id', r.id);
    const units = unitInfos(r);
    // 已有行数超过单元数（异常）时截断多余，避免错位
    let rows = existing.slice(0, units.length);
    for (let i = rows.length; i < units.length; i++) {
      const u = units[i];
      const isFirst = rows.length === 0;
      run(
        'INSERT INTO reservation_rooms (reservation_id, room_id, room_type_id, line_index, guest_name, guest_id_card, guest_phone, status) VALUES (?,?,?,?,?,?,?,?)',
        r.id,
        (isFirst ? r.room_id : null),
        u.room_type_id, u.line_index,
        (isFirst ? r.guest_name : ''), (isFirst ? r.guest_id_card || '' : ''), (isFirst ? r.guest_phone || '' : ''),
        r.status === 'checked_in' ? 'checked_in' : 'pending'
      );
      rows.push({});
    }
  }
}

function seed() {
  const t = get('SELECT COUNT(*) AS c FROM room_types');
  if (t.c > 0) return;

  // ---- 房型 ----
  const typeNames = [
    ['标准大床房', 288],
    ['标准双床房', 328],
    ['豪华大床房', 458],
    ['商务套房', 688],
  ];
  const typeId = [];
  for (const [n, p] of typeNames) {
    typeId.push(Number(run('INSERT INTO room_types (name, base_price) VALUES (?,?)', n, p).lastInsertRowid));
  }

  // ---- 房间：3层×8 ----
  const plans = [
    [1, 101, 108, typeId[0]],
    [2, 201, 208, typeId[1]],
    [3, 301, 304, typeId[2]],
    [3, 305, 308, typeId[3]],
  ];
  const rid = {};
  for (const [floor, from, to, tid] of plans) {
    for (let n = from; n <= to; n++) {
      rid[String(n)] = Number(run('INSERT INTO rooms (room_no, floor, type_id) VALUES (?,?,?)', String(n), floor, tid).lastInsertRowid);
    }
  }

  // ---- 客房状态演示 ----
  run("UPDATE rooms SET status='dirty' WHERE room_no IN ('103','201')");
  run("UPDATE rooms SET status='ooo' WHERE room_no='305'");

  // ---- 宾客 ----
  const guestRows = [
    ['张伟', '13800138001'],
    ['李娜', '13800138002'],
    ['王强', '13800138003'],
    ['赵敏', '13800138004'],
    ['陈静', '13800138005'],
    ['刘洋', '13800138006'],
    ['孙丽', '13800138007'],
    ['周杰', '13800138008'],
  ];
  const gid = guestRows.map(([n, p]) =>
    Number(run('INSERT INTO guests (name, phone) VALUES (?,?)', n, p).lastInsertRowid)
  );

  const T = fmt(new Date());
  const D = (n) => addDays(T, n);

  function mkRes({ gi, roomNo, typeIdx, ci, co, rate, status = 'reserved', source = '散客', sourceOrderNo = '', rooms = 1, booking_type = '全日房', aci = null, aco = null }) {
    let nights, checkout = co;
    if (booking_type === '钟点房') {
      nights = 1;
      checkout = ci;
    } else {
      nights = nightsBetween(ci, co);
    }
    const dates = [];
    for (let i = 0; i < nights; i++) dates.push(addDays(ci, i));
    const ratesJson = JSON.stringify(Object.fromEntries(dates.map((d) => [d, rate])));
    const total = round2(nights * rate * rooms);
    return Number(run(
      `INSERT INTO reservations
        (order_no, guest_id, guest_name, guest_phone, room_type_id, room_id,
         check_in_date, check_out_date, nights, adults, rate, rooms, total_amount,
         status, booking_type, source, source_order_no, rates, actual_check_in, actual_check_out)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      genOrderNo(), gid[gi], guestRows[gi][0], guestRows[gi][1], typeId[typeIdx], rid[roomNo],
      ci, checkout, nights, 1, rate, rooms, total, status, booking_type, source, sourceOrderNo, ratesJson, aci, aco
    ).lastInsertRowid);
  }
  function folio(resId, gi, itemType, category, desc, amount, method = '', dateStr = null) {
    if (dateStr) {
      run('INSERT INTO folio_items (reservation_id, guest_id, item_type, category, description, amount, method, created_at) VALUES (?,?,?,?,?,?,?,?)',
        resId, gid[gi], itemType, category, desc, amount, method, dateStr + ' 12:00:00');
    } else {
      run('INSERT INTO folio_items (reservation_id, guest_id, item_type, category, description, amount, method) VALUES (?,?,?,?,?,?,?)',
        resId, gid[gi], itemType, category, desc, amount, method);
    }
  }

  // 1) 在住：101 张伟（T-1 入住，T+1 离店，2晚）
  let r = mkRes({ gi: 0, roomNo: '101', typeIdx: 0, ci: D(-1), co: D(1), rate: 288, status: 'checked_in', aci: D(-1) });
  folio(r, 0, 'room_charge', '房费', `房费(${D(-1)})`, 288, '', D(-1));
  folio(r, 0, 'room_charge', '房费', `房费(${T})`, 288, '', T);
  folio(r, 0, 'payment', '微信收款', '预付房费', -200, '微信', D(-1));

  // 2) 在住：202 李娜（今天入住，T+2 离店，2晚）
  r = mkRes({ gi: 1, roomNo: '202', typeIdx: 1, ci: T, co: D(2), rate: 328, status: 'checked_in', aci: T });
  folio(r, 1, 'room_charge', '房费', `房费(${T})`, 328, '', T);
  folio(r, 1, 'room_charge', '房费', `房费(${D(1)})`, 328, '', D(1));

  // 3) 在住·今日预离：301 王强（T-3 入住，T 离店，3晚）
  r = mkRes({ gi: 2, roomNo: '301', typeIdx: 2, ci: D(-3), co: T, rate: 458, status: 'checked_in', aci: D(-3) });
  for (let i = -3; i < 0; i++) folio(r, 2, 'room_charge', '房费', `房费(${D(i)})`, 458, '', D(i));
  folio(r, 2, 'extra_charge', '洗衣', '洗衣服务', 48, '', D(-2));
  folio(r, 2, 'payment', '现金收款', '预付房费', -500, '现金', D(-3));

  // 4) 预订·今日预抵：104 赵敏（T 入住，T+2 离店）
  mkRes({ gi: 3, roomNo: '104', typeIdx: 0, ci: T, co: D(2), rate: 288 });

  // 5) 预订·未来到店：205 陈静（T+2 入住，T+4 离店，美团渠道 2 间）
  mkRes({ gi: 4, roomNo: '205', typeIdx: 1, ci: D(2), co: D(4), rate: 328, source: '美团', sourceOrderNo: 'MT20260809120001', rooms: 2 });

  // 6) 已退：106 刘洋（T-4 入住，T-1 离店，3晚，已结清）
  r = mkRes({ gi: 5, roomNo: '106', typeIdx: 0, ci: D(-4), co: D(-1), rate: 288, status: 'checked_out', aci: D(-4), aco: D(-1) });
  for (let i = -4; i < -1; i++) folio(r, 5, 'room_charge', '房费', `房费(${D(i)})`, 288, '', D(i));
  folio(r, 5, 'payment', '现金收款', '结账付款', -364, '现金', D(-1));

  // 7) 已取消：107 孙丽
  mkRes({ gi: 6, roomNo: '107', typeIdx: 0, ci: D(-2), co: D(-1), rate: 288, status: 'cancelled' });

  // 8) 预订·未来：302 周杰（T+1 入住，T+2 离店）
  mkRes({ gi: 7, roomNo: '302', typeIdx: 2, ci: D(1), co: D(2), rate: 458 });

  // 9) 钟点房·预订：303 陈静（今天到店，固定 3 小时）
  mkRes({ gi: 4, roomNo: '303', typeIdx: 2, ci: T, co: T, rate: 128, booking_type: '钟点房' });

  console.log('[db] 已写入种子数据');
}

initSchema();
seed();
backfillReservationRooms();

module.exports = { db, q, get, run };
