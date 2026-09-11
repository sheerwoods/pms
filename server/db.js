// SQLite 初始化 / 建表 / 种子数据
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { fmt, addDays, nightsBetween, genOrderNo, round2, timeToMinutes, businessDateOf } = require('./utils');

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
      renew_from_order_no TEXT DEFAULT '',   -- 续住：被续旧单的单号（溯源）
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
      room_unit_id INTEGER REFERENCES reservation_rooms(id),  -- 房费明细归属的房间单元
      business_date TEXT,            -- 营业日（房费=该晚日期；其余按夜审时间切分）
      settle_status TEXT NOT NULL DEFAULT 'open',  -- open / partial / settled / ar
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS city_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER REFERENCES reservations(id),
      guest_id INTEGER REFERENCES guests(id),
      guest_name TEXT DEFAULT '',
      company TEXT DEFAULT '',                 -- 挂账单位
      amount REAL NOT NULL DEFAULT 0,          -- 挂账金额
      settled_amount REAL NOT NULL DEFAULT 0,  -- 已核销金额
      status TEXT NOT NULL DEFAULT 'open',     -- open / settled
      settled_at TEXT,
      settled_method TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      business_date TEXT,
      transferred_at TEXT,                     -- AR 账户间转账时间（最近一次转出）
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS ar_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE,                        -- 账户编号（可空，插入后回填 AR0001）
      name TEXT NOT NULL,                      -- 账户名称（公司/协议单位）
      contact TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',   -- active / disabled
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS ar_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ar_account_id INTEGER NOT NULL REFERENCES ar_accounts(id),
      amount REAL NOT NULL DEFAULT 0,          -- 本次回款总额
      method TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      business_date TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS ar_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL REFERENCES ar_receipts(id),
      entry_id INTEGER NOT NULL REFERENCES city_ledger(id),
      amount REAL NOT NULL DEFAULT 0           -- 本回款对该明细的核销额
    );
    CREATE TABLE IF NOT EXISTS folio_settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reservation_id INTEGER NOT NULL REFERENCES reservations(id),
      kind TEXT NOT NULL DEFAULT 'settle',     -- settle（结账）/ ar（挂账）
      ar_account_id INTEGER REFERENCES ar_accounts(id),
      city_ledger_id INTEGER,                  -- kind=ar 时对应的应收明细
      amount REAL NOT NULL DEFAULT 0,          -- 本次结账合计（单边）
      remark TEXT DEFAULT '',
      business_date TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS folio_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      settlement_id INTEGER NOT NULL REFERENCES folio_settlements(id),
      item_id INTEGER NOT NULL REFERENCES folio_items(id),
      side TEXT NOT NULL,                      -- charge（消费侧）/ payment（收款侧）
      amount REAL NOT NULL DEFAULT 0           -- 本次分配额
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
      rate REAL NOT NULL DEFAULT 0,         -- 该间房入住房价覆盖（0=用线路价）
      rates TEXT DEFAULT '{}',              -- 该间房逐晚房价覆盖 {date:price}（优先于 rate）
      check_out_date TEXT,                  -- 该间房预离日（留空=沿用订单离店日）
      remark TEXT DEFAULT '',               -- 该间房备注
      actual_check_out TEXT,                -- 该间房实际离店日
      status TEXT NOT NULL DEFAULT 'pending',  -- pending / checked_in / checked_out
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS dict_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,                     -- charge_category / payment_category / payment_method / source
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',           -- active / disabled
      system INTEGER DEFAULT 0,               -- 1=系统内置，不可删除/改名
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(kind, name)
    );
    CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status);
    CREATE INDEX IF NOT EXISTS idx_res_room ON reservations(room_id, status);
    CREATE INDEX IF NOT EXISTS idx_folio_res ON folio_items(reservation_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_status ON city_ledger(status);
    CREATE INDEX IF NOT EXISTS idx_ledger_res ON city_ledger(reservation_id);
    CREATE INDEX IF NOT EXISTS idx_alloc_entry ON ar_allocations(entry_id);
    CREATE INDEX IF NOT EXISTS idx_alloc_receipt ON ar_allocations(receipt_id);
    CREATE INDEX IF NOT EXISTS idx_folio_alloc_settle ON folio_allocations(settlement_id);
    CREATE INDEX IF NOT EXISTS idx_folio_alloc_item ON folio_allocations(item_id);
    CREATE INDEX IF NOT EXISTS idx_folio_settle_res ON folio_settlements(reservation_id, kind);
    CREATE INDEX IF NOT EXISTS idx_res_room_res ON reservation_rooms(reservation_id);
    CREATE INDEX IF NOT EXISTS idx_res_room_room ON reservation_rooms(room_id);
  `);

  // 默认系统设置：夜审时间（HH:MM）
  run("INSERT OR IGNORE INTO settings (key, value) VALUES ('night_audit_time', '06:00')");

  // 旧库升级：为已存在的 reservations 表补充新字段
  const resCols = q('PRAGMA table_info(reservations)').map((c) => c.name);
  if (!resCols.includes('source_order_no')) run("ALTER TABLE reservations ADD COLUMN source_order_no TEXT DEFAULT ''");
  if (!resCols.includes('rooms')) run('ALTER TABLE reservations ADD COLUMN rooms INTEGER DEFAULT 1');
  if (!resCols.includes('booking_type')) run("ALTER TABLE reservations ADD COLUMN booking_type TEXT DEFAULT '全日房'");
  if (!resCols.includes('rates')) run("ALTER TABLE reservations ADD COLUMN rates TEXT DEFAULT '{}'");
  if (!resCols.includes('lines')) run("ALTER TABLE reservations ADD COLUMN lines TEXT DEFAULT '[]'");
  if (!resCols.includes('guest_id_card')) run("ALTER TABLE reservations ADD COLUMN guest_id_card TEXT DEFAULT ''");
  if (!resCols.includes('renew_from_order_no')) run("ALTER TABLE reservations ADD COLUMN renew_from_order_no TEXT DEFAULT ''");

  // residence_rooms 状态列（分批入住）
  const rrCols = q('PRAGMA table_info(reservation_rooms)').map((c) => c.name);
  if (!rrCols.includes('status')) run("ALTER TABLE reservation_rooms ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
  if (!rrCols.includes('rate')) run('ALTER TABLE reservation_rooms ADD COLUMN rate REAL NOT NULL DEFAULT 0');
  if (!rrCols.includes('rates')) run("ALTER TABLE reservation_rooms ADD COLUMN rates TEXT DEFAULT '{}'");
  if (!rrCols.includes('actual_check_out')) run('ALTER TABLE reservation_rooms ADD COLUMN actual_check_out TEXT');
  if (!rrCols.includes('check_out_date')) run('ALTER TABLE reservation_rooms ADD COLUMN check_out_date TEXT');
  if (!rrCols.includes('remark')) run("ALTER TABLE reservation_rooms ADD COLUMN remark TEXT DEFAULT ''");

  // folio_items 房费明细房间归属（单间退房对账）
  const fiCols = q('PRAGMA table_info(folio_items)').map((c) => c.name);
  if (!fiCols.includes('room_unit_id')) run('ALTER TABLE folio_items ADD COLUMN room_unit_id INTEGER REFERENCES reservation_rooms(id)');
  // folio_items 营业日
  if (!fiCols.includes('business_date')) run('ALTER TABLE folio_items ADD COLUMN business_date TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_folio_bdate ON folio_items(business_date)');
  // folio_items 逐笔结账状态（open / partial / settled / ar，明细见 folio_allocations）
  if (!fiCols.includes('settle_status')) run("ALTER TABLE folio_items ADD COLUMN settle_status TEXT NOT NULL DEFAULT 'open'");
  db.exec('CREATE INDEX IF NOT EXISTS idx_folio_settle_status ON folio_items(settle_status)');

  // city_ledger 归属 AR 账户 + 关联 folio 付款（追溯/护栏）
  const clCols = q('PRAGMA table_info(city_ledger)').map((c) => c.name);
  if (!clCols.includes('ar_account_id')) run('ALTER TABLE city_ledger ADD COLUMN ar_account_id INTEGER');
  if (!clCols.includes('folio_item_id')) run('ALTER TABLE city_ledger ADD COLUMN folio_item_id INTEGER');
  if (!clCols.includes('transferred_at')) run('ALTER TABLE city_ledger ADD COLUMN transferred_at TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ledger_account ON city_ledger(ar_account_id, status)');

  migrateArAccounts();
  migrateFolioSettlements();
}

// 客账逐笔结账迁移（幂等）：历史「挂账」收款行退场
//   新模型下挂账不产生收款行，挂账金额由消费侧的「挂 AR」分配承载；
//   迁移把历史收款行的金额转到消费侧分配后删除该收款行（应收台账与结账批次保留），
//   否则余额会同时被收款行和 AR 分配扣减两次。
// 状态口径见 settlement.js 的 statusOf：整笔挂账=ar / 全额=settled / 无=open / 其余=partial
function migrateFolioSettlements() {
  for (const pay of q("SELECT * FROM folio_items WHERE item_type='payment' AND method='挂账' ORDER BY id")) {
    const ledger = get('SELECT * FROM city_ledger WHERE folio_item_id=?', pay.id);
    const paidC = Math.round(Math.abs(Number(pay.amount)) * 100);
    // 复用既有批次（含已迁移或上一次迁移生成的），否则新建
    let row = get(
      `SELECT s.id FROM folio_settlements s JOIN folio_allocations al ON al.settlement_id=s.id
       WHERE s.kind='ar' AND s.revoked_at IS NULL AND al.item_id=? AND al.side='payment' LIMIT 1`,
      pay.id
    );
    if (!row && ledger) row = get("SELECT id FROM folio_settlements WHERE kind='ar' AND revoked_at IS NULL AND city_ledger_id=?", ledger.id);
    const sid = row ? row.id : Number(run(
      `INSERT INTO folio_settlements (reservation_id, kind, ar_account_id, city_ledger_id, amount, remark, business_date, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      pay.reservation_id, 'ar', ledger ? ledger.ar_account_id : null, ledger ? ledger.id : null,
      paidC / 100, '历史挂账迁移', ledger ? ledger.business_date : null, pay.created_at
    ).lastInsertRowid);
    // 冲抵本单消费（最早优先），补齐到该笔挂账金额
    const doneC = Math.round((get("SELECT COALESCE(SUM(amount),0) AS s FROM folio_allocations WHERE settlement_id=? AND side='charge'", sid).s || 0) * 100);
    let left = paidC - doneC;
    for (const c of q("SELECT * FROM folio_items WHERE reservation_id=? AND item_type IN ('room_charge','extra_charge','adj') AND amount > 0 ORDER BY id", pay.reservation_id)) {
      if (left <= 0) break;
      const used = Math.round((get('SELECT COALESCE(SUM(amount),0) AS s FROM folio_allocations WHERE item_id=?', c.id).s || 0) * 100);
      const take = Math.min(Math.round(Number(c.amount) * 100) - used, left);
      if (take <= 0) continue;
      run('INSERT INTO folio_allocations (settlement_id, item_id, side, amount) VALUES (?,?,?,?)', sid, c.id, 'charge', take / 100);
      left -= take;
    }
    // 收款行退场：先删其分配（外键），再删行
    run('DELETE FROM folio_allocations WHERE item_id=?', pay.id);
    run('DELETE FROM folio_items WHERE id=?', pay.id);
  }
  // 挂账收款行删除后，台账上的 folio_item_id 置空（关联改由 folio_settlements.city_ledger_id 承载）
  run('UPDATE city_ledger SET folio_item_id=NULL WHERE folio_item_id IS NOT NULL AND folio_item_id NOT IN (SELECT id FROM folio_items)');
  // 重算有分配的行状态（历史无分配的行保持 open，退房时自动整单结账）
  for (const r of q(`SELECT f.id, f.amount,
                            COALESCE(SUM(al.amount),0) AS allocated,
                            COALESCE(SUM(CASE WHEN s.kind='ar' THEN al.amount ELSE 0 END),0) AS ar_alloc
                     FROM folio_items f
                     JOIN folio_allocations al ON al.item_id=f.id
                     JOIN folio_settlements s ON s.id=al.settlement_id
                     GROUP BY f.id`)) {
    const cap = Math.abs(Number(r.amount));
    const full = r.allocated >= cap - 0.005;
    const status = (full && r.ar_alloc > 0.005) ? 'ar'
      : (r.allocated < 0.005 ? 'open' : (full ? 'settled' : 'partial'));
    run('UPDATE folio_items SET settle_status=? WHERE id=?', status, r.id);
  }
}

// AR 迁移（幂等）：历史自由文本挂账归入默认账户；尽力回填 folio_item_id
function migrateArAccounts() {
  const orphans = get('SELECT COUNT(*) AS c FROM city_ledger WHERE ar_account_id IS NULL').c;
  if (orphans > 0) {
    run("INSERT OR IGNORE INTO ar_accounts (code, name, remark) VALUES ('HIST','历史挂账','系统迁移的历史挂账单位')");
    const hist = get("SELECT id FROM ar_accounts WHERE code='HIST'");
    if (hist) {
      run("UPDATE city_ledger SET ar_account_id=?, company=COALESCE(NULLIF(company,''),'历史挂账') WHERE ar_account_id IS NULL", hist.id);
    }
  }
  // 仅当同额挂账付款唯一时才关联，避免误连
  run(`UPDATE city_ledger SET folio_item_id = (
         SELECT f.id FROM folio_items f
         WHERE f.reservation_id = city_ledger.reservation_id
           AND f.method='挂账' AND ABS(f.amount + city_ledger.amount) < 0.005
         LIMIT 1)
       WHERE ar_account_id IS NOT NULL AND folio_item_id IS NULL
         AND (SELECT COUNT(*) FROM folio_items f
              WHERE f.reservation_id = city_ledger.reservation_id
                AND f.method='挂账' AND ABS(f.amount + city_ledger.amount) < 0.005) = 1`);
}

// 回填历史流水的营业日（幂等；须在 seed / backfillReservationRooms 之后执行）
//   房费：描述 房费(YYYY-MM-DD) -> 取该晚日期
//   其余：按 created_at 依夜审时间切分
function backfillBusinessDates() {
  const rows = q('SELECT id, item_type, description, created_at FROM folio_items WHERE business_date IS NULL');
  if (!rows.length) return;
  const auditMin = timeToMinutes(get("SELECT value FROM settings WHERE key='night_audit_time'")?.value, 6 * 60);
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      let bd = null;
      if (r.item_type === 'room_charge') {
        const m = /房费\((\d{4}-\d{2}-\d{2})\)/.exec(r.description || '');
        if (m) bd = m[1];
      }
      if (!bd) bd = businessDateOf(r.created_at, auditMin);
      run('UPDATE folio_items SET business_date=? WHERE id=?', bd, r.id);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
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
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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

// 字典默认项：仅在首次建库时播种（避免用户删除后重启复活）
function seedDicts() {
  if (get("SELECT value FROM settings WHERE key='dicts_seeded'")) return;
  const rows = [
    ['charge_category', '迷你吧', 1, 0], ['charge_category', '洗衣', 2, 0], ['charge_category', '电话', 3, 0],
    ['charge_category', '赔偿', 4, 0], ['charge_category', '早餐', 5, 0], ['charge_category', '其他', 6, 0],
    ['payment_category', '房费', 1, 0], ['payment_category', '杂费', 2, 0], ['payment_category', '预付', 3, 0],
    ['payment_method', '现金', 1, 0], ['payment_method', '银行卡', 2, 0], ['payment_method', '微信', 3, 0],
    ['payment_method', '支付宝', 4, 0], ['payment_method', '挂账', 5, 1],
    ['source', '散客', 1, 0], ['source', '美团', 2, 0], ['source', '携程', 3, 0],
    ['source', '飞猪', 4, 0], ['source', '京东', 5, 0], ['source', '小程序', 6, 0],
  ];
  for (const [kind, name, sort, system] of rows) {
    run('INSERT OR IGNORE INTO dict_items (kind, name, sort_order, system) VALUES (?,?,?,?)', kind, name, sort, system);
  }
  run("INSERT OR IGNORE INTO settings (key, value) VALUES ('dicts_seeded', '1')");
}

initSchema();
seedDicts();
seed();
backfillReservationRooms();
backfillBusinessDates();

module.exports = { db, q, get, run };
