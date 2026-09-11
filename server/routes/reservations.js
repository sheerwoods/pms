// 订单管理 + 入住/退房/取消/未到/换房
const express = require('express');
const { q, get, run } = require('../db');
const { AppError, wrap } = require('../errors');
const { addFolioItem, getBalance, getDepositBalance, getFolio, syncRoomCharges } = require('../folio');
const { genOrderNo, nightsBetween, today, now, addDays, round2 } = require('../utils');
const { safeParseLines, roomRate } = require('../rates');
const { currentBusinessDate, itemKind } = require('../accounting');
const { createArEntryTx, assertNoOverAr } = require('../ar');
const { autoSettleTx, unsettledCharges } = require('../settlement');
const { withTx } = require('../tx');

const router = express.Router();

// 退房闸门：先自动整单结账，仍有未结消费（欠款且未挂 AR）则拒绝退房
function assertAllSettled(reservationId) {
  autoSettleTx(reservationId);
  const due = unsettledCharges(reservationId);
  if (due.total > 0.005) {
    throw new AppError(`还有未结账消费 ¥${due.total.toFixed(2)}，请先在客账中逐笔结账或挂 AR 账户`);
  }
}

// 整单结算：押金抵扣/退还 -> 收款(全额入账) -> 找零/退款 -> 挂账到 AR 账户
// 客户端传 payments=[{method, amount(实收全额), ar_account_id?}]、refund={method, amount(找零)}、use_deposit
function settleFolio(r, { payments = [], refund = null, use_deposit = true, deposit_refund_method = '现金' } = {}) {
  const bd = currentBusinessDate();
  // 1) 押金抵扣应收
  let due = getBalance(r.id);
  const depBal = getDepositBalance(r.id);
  if (use_deposit && depBal > 0 && due > 0) {
    const applied = round2(Math.min(depBal, due));
    if (applied > 0) {
      addFolioItem({ reservationId: r.id, guestId: r.guest_id, itemType: 'payment', category: '押金抵扣', description: '押金抵扣房费', amount: -applied, method: '押金', businessDate: bd });
      addFolioItem({ reservationId: r.id, guestId: r.guest_id, itemType: 'deposit', category: '押金抵扣', description: '押金抵扣房费', amount: applied, businessDate: bd });
      due = round2(due - applied);
    }
  }
  // 2) 退还剩余押金
  const depLeft = getDepositBalance(r.id);
  if (depLeft > 0) {
    addFolioItem({ reservationId: r.id, guestId: r.guest_id, itemType: 'deposit', category: '退押金', description: '退还押金', amount: depLeft, method: deposit_refund_method, businessDate: bd });
  }
  // 3) 收款（按实收全额入账，找零另记退款，避免产生幻影欠款）；挂账必须绑定 AR 账户
  for (const p of payments || []) {
    const amt = round2(Number(p.amount) || 0);
    if (amt <= 0) continue;
    if (p.method === '挂账') {
      if (!p.ar_account_id) throw new AppError('挂账必须选择 AR 账户');
      if (amt > due + 0.005) throw new AppError(`挂账金额不能超过未结应收 ¥${Math.max(0, due).toFixed(2)}`);
      createArEntryTx({
        reservationId: r.id, guestId: r.guest_id, guestName: r.guest_name,
        arAccountId: p.ar_account_id, amount: amt, remark: p.remark || '',
      });
      due = round2(due - amt);
    } else {
      addFolioItem({ reservationId: r.id, guestId: r.guest_id, itemType: 'payment', category: `${p.method}收款`, description: '结账收款', amount: -amt, method: p.method, businessDate: bd });
      due = round2(due - amt);
    }
  }
  // 4) 找零/退款
  if (refund && Number(refund.amount) > 0) {
    addFolioItem({ reservationId: r.id, guestId: r.guest_id, itemType: 'payment', category: '退款', description: '退款找零', amount: Number(refund.amount), method: refund.method || '现金', businessDate: bd });
  }
}

// 整单结账退房事务（供「整单退房」与「续住」复用）：
// 未到店子单按未到关闭 -> 在住子单置已退 -> 按实际离店日对账房费 -> 收款/退款/挂账结算 -> 订单已退 -> 住过的房间置脏
// 返回结算后余额；须调用方置于事务中（可嵌套 withTx）
function closeOrderTx(r, { payments = [], refund = null, use_deposit = true, deposit_refund_method = '现金', checkoutDate } = {}) {
  const coDate = checkoutDate || today();
  run("UPDATE reservation_rooms SET status='no_show' WHERE reservation_id=? AND status='pending'", r.id);

  const checkedUnits = q("SELECT id FROM reservation_rooms WHERE reservation_id=? AND status='checked_in'", r.id);
  for (const cu of checkedUnits) {
    run("UPDATE reservation_rooms SET status='checked_out', actual_check_out=? WHERE id=?", coDate, cu.id);
  }
  // 按实际夜数调平各房型房费（房费归入对应房间）
  syncRoomCharges(r.id, r.guest_id, occupiedRoomUnits(r, coDate));

  // 结算：押金抵扣/退还 -> 收款 -> 找零 -> 挂账
  assertNoOverAr(r.id);
  settleFolio(r, { payments, refund, use_deposit, deposit_refund_method });
  assertAllSettled(r.id);

  run("UPDATE reservations SET status='checked_out', actual_check_out=? WHERE id=?", coDate, r.id);
  // 置脏实际住过的房间（含本次退房与历史单间已退的房）；未入住即关闭的房不动
  const seen = new Set();
  for (const x of q("SELECT room_id FROM reservation_rooms WHERE reservation_id=? AND status='checked_out'", r.id)) {
    if (x.room_id && !seen.has(x.room_id)) { seen.add(x.room_id); run("UPDATE rooms SET status='dirty' WHERE id=?", x.room_id); }
  }
  if (!seen.size && r.room_id) run("UPDATE rooms SET status='dirty' WHERE id=?", r.room_id);

  return getBalance(r.id);
}

function getRoomNo(id) {
  if (!id) return '-';
  const r = get('SELECT room_no FROM rooms WHERE id=?', id);
  return r ? r.room_no : '-';
}

// 终态父单状态：不可再发生入住/退房/换房等流转
function isTerminal(status) {
  return ['cancelled', 'no_show', 'checked_out'].includes(status);
}

// 子单状态统计（以子单为唯一事实来源）
function unitCounts(resId) {
  const r = get(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) AS pending,
            COALESCE(SUM(CASE WHEN status='checked_in' THEN 1 ELSE 0 END),0) AS checked_in,
            COALESCE(SUM(CASE WHEN status='checked_out' THEN 1 ELSE 0 END),0) AS checked_out
     FROM reservation_rooms WHERE reservation_id=?`,
    resId
  );
  return { total: r.total || 0, pending: r.pending || 0, checked_in: r.checked_in || 0, checked_out: r.checked_out || 0 };
}

// 订单是否已有房间入住（部分入住时父单状态仍为 reserved）
function hasCheckedInUnit(resId) {
  return unitCounts(resId).checked_in > 0;
}

// 依据 room_list 回填子单统计与父单派生状态（供列表/详情统一消费）
function deriveUnitFields(x) {
  const units = x.room_list || [];
  const counts = { total: units.length, pending: 0, checked_in: 0, checked_out: 0, no_show: 0 };
  for (const u of units) {
    if (counts[u.status] != null) counts[u.status] += 1;
  }
  x.unit_counts = counts;
  x.checked_in_rooms = counts.checked_in;
  x.pending_rooms = counts.pending;
  x.has_checked_in = counts.checked_in > 0;
  // 终态父单优先；非终态以子单推导：有在住→在住；有待入住（含部分退房）→已预订；全部已退→已退；无子单→已预订
  x.eff_status = isTerminal(x.status) ? x.status
    : counts.checked_in > 0 ? 'checked_in'
    : counts.pending > 0 ? 'reserved'
    : (counts.checked_out + counts.no_show) > 0 ? 'checked_out'
    : 'reserved';
  return x;
}

// 为一批预订挂载其已分配的房间列表（room_list）
function attachRoomList(list) {
  if (!list.length) return list;
  const ids = list.map((x) => x.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = q(
    `SELECT rr.*, rm.room_no FROM reservation_rooms rr
     LEFT JOIN rooms rm ON rm.id=rr.room_id
     WHERE rr.reservation_id IN (${placeholders}) ORDER BY rr.id`,
    ...ids
  );
  const byRes = {};
  rows.forEach((r) => { (byRes[r.reservation_id] = byRes[r.reservation_id] || []).push(r); });
  const consumes = q(
    `SELECT reservation_id, COALESCE(SUM(amount),0) AS s FROM folio_items
     WHERE item_type IN ('room_charge','extra_charge','adj') AND reservation_id IN (${placeholders})
     GROUP BY reservation_id`,
    ...ids
  );
  const consumeMap = {};
  consumes.forEach((c) => { consumeMap[c.reservation_id] = Math.round((c.s || 0) * 100) / 100; });
  list.forEach((x) => {
    x.room_list = byRes[x.id] || [];
    x.total_consume = consumeMap[x.id] || 0;
    deriveUnitFields(x);
  });
  return list;
}

// 房间是否可用（未被占用/维修）——兼容旧的 reservations.room_id 与新 reservation_rooms
function isRoomAvailable(roomId, excludeResId = null) {
  if (!roomId) return false;
  const room = get('SELECT * FROM rooms WHERE id=?', roomId);
  if (!room || room.status === 'ooo') return false;
  const ex = excludeResId || 0;
  const active = get(
    "SELECT id FROM reservations WHERE room_id=? AND status IN ('reserved','checked_in') AND id != ? LIMIT 1",
    roomId, ex
  );
  if (active) return false;
  const rr = get(
    "SELECT r.id FROM reservation_rooms rr JOIN reservations r ON r.id=rr.reservation_id WHERE rr.room_id=? AND r.status IN ('reserved','checked_in') AND r.id != ? LIMIT 1",
    roomId, ex
  );
  return !rr;
}

function validateReservation(body, { isHourly = false } = {}) {
  const { check_in_date, check_out_date, lines } = body;
  if (!check_in_date) throw new AppError('到达时间必填');
  if (!isHourly) {
    if (!check_out_date) throw new AppError('离店时间必填');
    if (check_out_date <= check_in_date) throw new AppError('离店时间必须晚于到达时间');
  }
  const hasPrice = Array.isArray(lines) && lines.some((ln) =>
    Number(ln && ln.rate) > 0 || (Array.isArray(ln && ln.rates) && ln.rates.some((x) => Number(x && x.price) > 0))
  );
  if (!hasPrice) throw new AppError('请至少设置一个房型的房价');
}

// 展开为逐间单元：每个 房型行 × 每间 一条，携带行下标与房型
function unitsFromLines(lines) {
  const arr = (Array.isArray(lines) && lines.length) ? lines : [];
  const out = [];
  arr.forEach((ln, li) => {
    const rooms = Math.max(1, Number(ln.rooms) || 1);
    for (let m = 0; m < rooms; m++) out.push({ line_index: li, room_type_id: ln.room_type_id || null });
  });
  return out;
}

function unitInfos(r) {
  return unitsFromLines(safeParseLines(r));
}

// 该订单应入住的房间总数
function totalRoomCount(r) {
  return unitInfos(r).length;
}

// 按新的 lines 同步子单行：保留已入住/已退子单（重映射 line_index），增减待入住子单
function syncReservationUnits(resId, lines) {
  const units = unitsFromLines(lines);
  const existing = q('SELECT * FROM reservation_rooms WHERE reservation_id=? ORDER BY id', resId);
  const fixed = existing.filter((u) => u.status !== 'pending');   // 已入住/已退，不可删
  const pending = existing.filter((u) => u.status === 'pending');
  if (units.length < fixed.length) throw new AppError('间数不能少于已入住/已退的房间数');

  const slots = units.map((u) => ({ line_index: u.line_index, room_type_id: u.room_type_id, taken: false }));
  // 1) 非 pending 子单按房型就近占位，重映射 line_index（保证 rate 取自正确的房价线路）
  for (const row of fixed) {
    let idx = slots.findIndex((s) => !s.taken && s.room_type_id != null && Number(s.room_type_id) === Number(row.room_type_id));
    if (idx < 0) idx = slots.findIndex((s) => !s.taken && s.room_type_id == null && !row.room_type_id);
    if (idx < 0) idx = slots.findIndex((s) => !s.taken);
    slots[idx].taken = true;
    if (Number(row.line_index) !== Number(slots[idx].line_index)) {
      run('UPDATE reservation_rooms SET line_index=? WHERE id=?', slots[idx].line_index, row.id);
    }
  }
  // 2) 待入住子单占剩余槽位；不足则新增，多余则删除（释放占用）
  let pi = 0;
  for (const slot of slots) {
    if (slot.taken) continue;
    const row = pending[pi++];
    if (row) run('UPDATE reservation_rooms SET line_index=?, room_type_id=? WHERE id=?', slot.line_index, slot.room_type_id, row.id);
    else run('INSERT INTO reservation_rooms (reservation_id, room_type_id, line_index, status) VALUES (?,?,?,?)', resId, slot.room_type_id, slot.line_index, 'pending');
  }
  for (let k = pi; k < pending.length; k++) run('DELETE FROM reservation_rooms WHERE id=?', pending[k].id);
}

// 「整单当前应计房费」权威集合：对已入住或已退房的每个房间单元，生成 [入住日, roomEnd) 每夜一条
// roomEnd = 该间 actual_check_out || （该间仍在住 → defaultEnd || r.check_out_date）
function occupiedRoomUnits(r, defaultEnd = null) {
  const isHourly = r.booking_type === '钟点房';
  const start = (r.actual_check_in && String(r.actual_check_in).slice(0, 10)) || r.check_in_date;
  const endBase = defaultEnd || r.check_out_date;
  const rows = q("SELECT * FROM reservation_rooms WHERE reservation_id=? AND status IN ('checked_in','checked_out') ORDER BY id", r.id);
  const units = [];
  for (const row of rows) {
    const end = isHourly ? null : (row.actual_check_out || endBase);
    const nights = isHourly ? 1 : Math.max(0, nightsBetween(start, end || start));
    for (let i = 0; i < nights; i++) {
      const d = addDays(start, i);
      units.push({ date: d, amount: roomRate(r, row, d), roomUnitId: row.id });
    }
  }
  return units;
}

// 「已发生（已完成夜晚）房费」权威集合：与夜审口径一致——在住间只计至营业日-1，已退间计至实际离店日。
// 用于在住期间的房费对账（改价/提前离店），绝不提前计当夜及以后的房费。
function elapsedRoomUnits(r) {
  const isHourly = r.booking_type === '钟点房';
  const start = (r.actual_check_in && String(r.actual_check_in).slice(0, 10)) || r.check_in_date;
  const cutoff = currentBusinessDate(); // 已完成夜晚 < cutoff（即 <= 营业日-1）
  const rows = q("SELECT * FROM reservation_rooms WHERE reservation_id=? AND status IN ('checked_in','checked_out') ORDER BY id", r.id);
  const units = [];
  for (const row of rows) {
    if (isHourly) {
      // 钟点房退房时结算 1 晚；在住期间不预提
      if (!row.actual_check_out) continue;
      units.push({ date: start, amount: roomRate(r, row, start), roomUnitId: row.id });
      continue;
    }
    const end = row.actual_check_out || cutoff;
    const nights = Math.max(0, nightsBetween(start, end));
    for (let i = 0; i < nights; i++) {
      const d = addDays(start, i);
      units.push({ date: d, amount: roomRate(r, row, d), roomUnitId: row.id });
    }
  }
  return units;
}

// 入住人/同住人校验：姓名必填；身份证号/手机号选填（填了则校验格式）。兼容 guest_* 与 name/id_card/phone 两种字段
function validateOccupantImpl(o, label) {
  const name = String((o && (o.guest_name ?? o.name)) || '').trim();
  const idCard = String((o && (o.guest_id_card ?? o.id_card)) || '').trim().toUpperCase();
  const phone = String((o && (o.guest_phone ?? o.phone)) || '').trim();
  if (!name) throw new AppError(`${label}姓名必填`);
  if (idCard && !/^\d{17}[\dX]$/.test(idCard)) throw new AppError(`${label}身份证号格式不正确（18位，末位可为X）`);
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) throw new AppError(`${label}手机号格式不正确（1开头的11位数字）`);
  return { name, idCard, phone };
}

// 归一化预定房型：优先 body.lines；兼容旧负载（顶层 rate/rates/room_type_id/rooms）；否则回退存量订单
function normalizeLines(body, fallbackRes = null) {
  if (Array.isArray(body.lines) && body.lines.length) return body.lines;
  if (body.rate != null) {
    return [{
      room_type_id: body.room_type_id || null,
      rooms: body.rooms || 1,
      rate: body.rate,
      rates: Array.isArray(body.rates) ? body.rates : [],
    }];
  }
  if (fallbackRes) return safeParseLines(fallbackRes);
  return [];
}

// 计算多预定房型：lines = [{ room_type_id, rooms, rate, rates:[{date,price}] }]，总额 = Σ各房型(Σ每晚房价×间数)
function computeLines({ booking_type = '全日房', lines, check_in_date, check_out_date }) {
  const isHourly = booking_type === '钟点房';
  const nights = isHourly ? 1 : Math.max(0, nightsBetween(check_in_date, check_out_date));
  const dates = [];
  for (let i = 0; i < nights; i++) dates.push(addDays(check_in_date, i));
  const raw = (Array.isArray(lines) && lines.length) ? lines : [{ room_type_id: null, rooms: 1, rate: 0 }];
  let total = 0;
  const normalized = raw.map((ln) => {
    const rooms = Math.max(1, Number(ln.rooms) || 1);
    const provided = Array.isArray(ln.rates) ? ln.rates : [];
    const map = {};
    const nightRates = [];
    for (const d of dates) {
      const hit = provided.find((x) => String(x.date) === d);
      const hitPrice = hit && hit.price != null ? Number(hit.price) : 0;
      // 某晚未设价(0/空)时回退该行间晚房价
      const price = hitPrice > 0 ? hitPrice : (Number(ln.rate) || 0);
      map[d] = price;
      nightRates.push({ date: d, rate: price });
    }
    const lineTotal = round2(nightRates.reduce((s, x) => s + x.rate, 0) * rooms);
    total += lineTotal;
    return { room_type_id: ln.room_type_id || null, rooms, rate: nightRates[0]?.rate || 0, rates: JSON.stringify(map) };
  });
  return { isHourly, nights, total: round2(total), lines: normalized, dates };
}

// ============ 宾客搜索 ============
router.get('/guests', wrap((req, res) => {
  const k = `%${req.query.keyword || ''}%`;
  res.json(q('SELECT * FROM guests WHERE name LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 20', k, k));
}));

// ============ 订单列表 ============
router.get('/reservations', wrap((req, res) => {
  const { status, keyword, start, end, page = 1, pageSize = 20 } = req.query;
  const conds = [];
  const params = [];
  if (status) {
    // 各栏以子单状态为事实来源推导；父状态仅作无子单历史数据的回退，防止脏父状态污染列表
    const hasUnits = 'EXISTS (SELECT 1 FROM reservation_rooms rr0 WHERE rr0.reservation_id=r.id)';
    const anyIn = 'EXISTS (SELECT 1 FROM reservation_rooms rr WHERE rr.reservation_id=r.id AND rr.status=\'checked_in\')';
    const anyPend = 'EXISTS (SELECT 1 FROM reservation_rooms rr WHERE rr.reservation_id=r.id AND rr.status=\'pending\')';
    const anyOut = 'EXISTS (SELECT 1 FROM reservation_rooms rr WHERE rr.reservation_id=r.id AND rr.status=\'checked_out\')';
    if (status === 'checked_in') {
      // 「在住」栏：有任一子单在住（含部分入住，订单头仍为 reserved）；无子单的历史订单回退父状态
      conds.push(`((r.status NOT IN ('cancelled','no_show','checked_out') AND ${anyIn}) OR (r.status='checked_in' AND NOT ${hasUnits}))`);
    } else if (status === 'checked_out') {
      // 「已退」栏：父已退，或所有已发生入住的子单均已离店（无在住、无待入住）
      conds.push(`(r.status='checked_out' OR (${anyOut} AND NOT ${anyIn} AND NOT ${anyPend} AND r.status NOT IN ('cancelled','no_show')))`);
    } else if (status === 'reserved') {
      // 「已预订」栏：父状态为 reserved 即展示（含部分入住/部分退房后仍有待入住，与「在住」栏可同单双现）
      conds.push("r.status = 'reserved'");
    } else {
      conds.push('r.status = ?'); params.push(status);
    }
  }
  if (keyword) {
    conds.push('(r.order_no LIKE ? OR r.guest_name LIKE ? OR r.guest_phone LIKE ? OR rm.room_no LIKE ?)');
    const k = `%${keyword}%`;
    params.push(k, k, k, k);
  }
  if (start) { conds.push('r.check_in_date >= ?'); params.push(start); }
  if (end) { conds.push('r.check_out_date <= ?'); params.push(end); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const total = get(`SELECT COUNT(*) AS c FROM reservations r LEFT JOIN rooms rm ON rm.id=r.room_id ${where}`, ...params).c;
  const offset = (Number(page) - 1) * Number(pageSize);
  const list = q(`SELECT r.*, rm.room_no, t.name AS type_name
                  FROM reservations r
                  LEFT JOIN rooms rm ON rm.id=r.room_id
                  LEFT JOIN room_types t ON t.id=r.room_type_id
                  ${where}
                  ORDER BY r.id DESC LIMIT ? OFFSET ?`, ...params, Number(pageSize), offset);
  attachRoomList(list);
  res.json({ total, list, page: Number(page), pageSize: Number(pageSize) });
}));

// ============ 订单详情 ============
router.get('/reservations/:id', wrap((req, res) => {
  const r = get(`SELECT r.*, rm.room_no, t.name AS type_name
                 FROM reservations r
                 LEFT JOIN rooms rm ON rm.id=r.room_id
                 LEFT JOIN room_types t ON t.id=r.room_type_id
                 WHERE r.id=?`, req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  r.balance = getBalance(r.id);                 // 应收（欠款）
  r.account_balance = round2(-r.balance);       // 账户余额（收款−消费）
  r.deposit_balance = getDepositBalance(r.id);  // 押金余额
  r.folio = getFolio(r.id).map((it) => ({ ...it, kind: itemKind(it) }));
  attachRoomList([r]);
  res.json(r);
}));

// ============ 新建订单（支持 auto_checkin 直接入住） ============
router.post('/reservations', wrap((req, res) => {
  const b = req.body;
  const {
    check_in_date, check_out_date,
    booking_type = '全日房',
  } = b;
  const isHourly = booking_type === '钟点房';
  const {
    guest_id, guest_name, guest_phone, guest_id_card = '',
    adults = 1,
    source = '散客', source_order_no = '', remark = '', auto_checkin = false,
  } = b;
  if (!guest_name) throw new AppError('预定人姓名必填');

  // 多预定房型：总额 = Σ各房型(Σ每晚房价×间数)；兼容旧负载
  const linesInput = normalizeLines(b);
  validateReservation({ ...b, lines: linesInput }, { isHourly });
  const p = computeLines({ booking_type, lines: linesInput, check_in_date, check_out_date });
  const nights = p.nights;
  const total = p.total;
  const lines = p.lines;
  const first = lines[0] || { room_type_id: null, rooms: 1, rate: 0, rates: '{}' };
  const linesJson = JSON.stringify(lines);
  const ci = check_in_date;
  const co = isHourly ? check_in_date : check_out_date;

  if (auto_checkin) {
    if (!b.room_id) throw new AppError('直接入住必须指定房间');
    if (!isRoomAvailable(b.room_id)) throw new AppError('该房间不可用或已被占用');
  }

  // 宾客：复用或新建
  let gid = guest_id || null;
  if (!gid) {
    const existing = get('SELECT id FROM guests WHERE name=? AND phone=?', guest_name, guest_phone || '');
    if (existing) gid = existing.id;
    else gid = Number(run('INSERT INTO guests (name, phone, id_card) VALUES (?,?,?)', guest_name, guest_phone || '', guest_id_card).lastInsertRowid);
  } else if (guest_phone || guest_id_card) {
    run('UPDATE guests SET phone=?, id_card=? WHERE id=?', guest_phone || '', guest_id_card, gid);
  }

  // 按单元逐间写 pending 分配行；直接入住时首间置为已入住
  const units = unitsFromLines(lines);
  // 直接入住仅在单间时父单即为在住；多间则父单保持已预订（部分入住），仅首间入住
  const status = (auto_checkin && units.length <= 1) ? 'checked_in' : 'reserved';
  const order_no = genOrderNo();
  const rid = Number(run(
    `INSERT INTO reservations
      (order_no, guest_id, guest_name, guest_phone, guest_id_card, room_type_id, room_id,
       check_in_date, check_out_date, nights, adults, rate, rooms, total_amount,
       status, booking_type, source, source_order_no, remark, rates, lines, actual_check_in)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    order_no, gid, guest_name, guest_phone || '', guest_id_card, first.room_type_id, b.room_id || null,
    ci, co, nights, adults, first.rate, first.rooms, total,
    status, booking_type, source, source_order_no, remark, first.rates, linesJson, auto_checkin ? now() : null
  ).lastInsertRowid);


  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const isFirst = i === 0;
    run(
      'INSERT INTO reservation_rooms (reservation_id, room_id, room_type_id, line_index, guest_name, guest_id_card, guest_phone, status) VALUES (?,?,?,?,?,?,?,?)',
      rid, (isFirst ? (b.room_id || null) : null), u.room_type_id, u.line_index,
      (isFirst ? guest_name : ''), (isFirst ? guest_id_card : ''), (isFirst ? guest_phone || '' : ''), 'pending'
    );
  }
  if (auto_checkin && b.room_id) {
    run("UPDATE reservation_rooms SET status='checked_in' WHERE reservation_id=? AND id=(SELECT MIN(id) FROM reservation_rooms WHERE reservation_id=?)", rid, rid);
  }

  // 入住不自动产生消费；每日房费由夜审在夜审时间统一补计（钟点房于退房时结算）
  res.json({ id: rid, order_no });
}));

// ============ 修改订单（含续住/调价/换房） ============
router.put('/reservations/:id', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (isTerminal(r.status)) throw new AppError('该状态的订单不可修改');
  const b = req.body;
  const check_in_date = b.check_in_date || r.check_in_date;
  let check_out_date = b.check_out_date || r.check_out_date;
  const booking_type = b.booking_type != null ? b.booking_type : (r.booking_type || '全日房');
  const isHourly = booking_type === '钟点房';
  const linesBody = normalizeLines(b, r);
  validateReservation({ check_in_date, check_out_date, lines: linesBody }, { isHourly });

  // 多预定房型：总额 = Σ各房型(Σ每晚房价×间数)
  const p = computeLines({ booking_type, lines: linesBody, check_in_date, check_out_date });
  const nights = p.nights;
  const total = p.total;
  const lines = p.lines;
  const first = lines[0] || { room_type_id: r.room_type_id || null, rooms: r.rooms || 1, rate: r.rate || 0, rates: r.rates || '{}' };
  const linesJson = JSON.stringify(lines);
  check_out_date = isHourly ? check_in_date : check_out_date;
  const room_id = b.room_id != null ? b.room_id : r.room_id;
  if (room_id && room_id != r.room_id && !isRoomAvailable(room_id, r.id)) throw new AppError('该房间不可用');

  run(
    `UPDATE reservations SET guest_name=?, guest_phone=?, room_type_id=?, room_id=?,
       check_in_date=?, check_out_date=?, nights=?, adults=?, rate=?, rooms=?, total_amount=?,
       booking_type=?, source=?, source_order_no=?, remark=?, rates=?, lines=?
     WHERE id=?`,
    b.guest_name || r.guest_name,
    b.guest_phone != null ? b.guest_phone : r.guest_phone,
    first.room_type_id,
    room_id, check_in_date, check_out_date, nights,
    b.adults != null ? b.adults : r.adults, first.rate, first.rooms, total,
    booking_type, b.source || r.source, b.source_order_no != null ? b.source_order_no : r.source_order_no,
    b.remark != null ? b.remark : r.remark, first.rates, linesJson, r.id
  );

  // 按新 lines 同步子单行（增/减待入住子单、重映射 line_index），先于房费重算
  syncReservationUnits(r.id, lines);

  // 在住（含部分入住，父单 reserved，只要仍有在住子单）按新日期/房型/间数对账「已完成夜晚」房费
  // 只补/调已过夜次，不提前计当夜及以后；剩余夜次仍由夜审到点补计
  if (hasCheckedInUnit(r.id)) {
    const updated = { ...r, booking_type, check_in_date, check_out_date, lines: linesJson };
    syncRoomCharges(r.id, r.guest_id, elapsedRoomUnits(updated));
  }
  res.json({ ok: true });
}));

// ============ 修改某个房间单元的一位客人（主客人或同住人）——详情页内联编辑，不触发房费重算 ============
// body: { index (0=主客，>=1 同住人下标), name/id_card/phone 或 guest_name/guest_id_card/guest_phone }
router.put('/reservations/:id/rooms/:unitId/occupant', wrap((req, res) => {
  const row = get('SELECT * FROM reservation_rooms WHERE id=? AND reservation_id=?', req.params.unitId, req.params.id);
  if (!row) throw new AppError('在住房间不存在', 404);
  const idx = Number(req.body.index) || 0;
  const { name, idCard, phone } = validateOccupantImpl(req.body, '客人');
  if (idx === 0) {
    // 仅更新该房间的入住人；不回写订单头/宾客档案，预定人信息独立保留
    run('UPDATE reservation_rooms SET guest_name=?, guest_phone=?, guest_id_card=? WHERE id=?', name, phone, idCard, row.id);
  } else {
    let arr = [];
    try { arr = JSON.parse(row.cohabitors || '[]'); } catch { /* */ }
    if (!arr[idx - 1]) throw new AppError('同住人不存在');
    arr[idx - 1] = { name, id_card: idCard, phone };
    run('UPDATE reservation_rooms SET cohabitors=? WHERE id=?', JSON.stringify(arr), row.id);
  }
  res.json({ ok: true });
}));

// ============ 更新某房间单元的入住人/同住人（详情页内联新增同住人） ============
router.put('/reservations/:id/rooms/:unitId/cohabitors', wrap((req, res) => {
  const row = get('SELECT * FROM reservation_rooms WHERE id=? AND reservation_id=?', req.params.unitId, req.params.id);
  if (!row) throw new AppError('在住房间不存在', 404);
  const cohabitors = Array.isArray(req.body.cohabitors) ? req.body.cohabitors : [];
  if (!cohabitors.length) throw new AppError('请至少保留一位同住人' );
  cohabitors.forEach((c, j) => validateOccupantImpl(c, `同住人${j + 1}`));
  const clean = cohabitors.map((c) => ({
    name: String(c.guest_name ?? c.name ?? '').trim(),
    id_card: String(c.guest_id_card ?? c.id_card ?? '').trim().toUpperCase(),
    phone: String(c.guest_phone ?? c.phone ?? '').trim(),
  }));
  run('UPDATE reservation_rooms SET cohabitors=? WHERE id=?', JSON.stringify(clean), row.id);
  res.json({ ok: true });
}));

// ============ 修改某个房间子单的房间信息（房价/离店日期/备注）——仅作用于当前房间，不回写父订单 ============
router.put('/reservations/:id/rooms/:unitId/room-info', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (isTerminal(r.status)) throw new AppError('该状态的订单不可修改');
  const row = get('SELECT * FROM reservation_rooms WHERE id=? AND reservation_id=?', req.params.unitId, r.id);
  if (!row) throw new AppError('房间子单不存在', 404);
  if (row.status !== 'checked_in') throw new AppError('仅可修改在住房间的房间信息');

  const isHourly = r.booking_type === '钟点房';
  const start = (r.actual_check_in && String(r.actual_check_in).slice(0, 10)) || r.check_in_date;
  let checkOut = req.body.check_out_date || row.check_out_date || r.check_out_date;
  if (isHourly) checkOut = start;
  else if (checkOut <= start) throw new AppError('离店日期必须晚于入住日期');
  const rate = req.body.rate != null ? Math.max(0, Number(req.body.rate) || 0) : (Number(row.rate) || 0);
  const remark = req.body.remark != null ? String(req.body.remark) : (row.remark || '');

  // 逐晚价覆盖：接受 {date:price} 或 [{date,price}]；仅保留住宿期内（钟点房仅当晚）的有效价
  let rates = row.rates || '{}';
  if (req.body.rates !== undefined) {
    const src = Array.isArray(req.body.rates)
      ? Object.fromEntries(req.body.rates.filter((x) => x && x.date).map((x) => [x.date, Number(x.price)]))
      : (req.body.rates && typeof req.body.rates === 'object' ? req.body.rates : {});
    const map = {};
    for (const [d, p] of Object.entries(src)) {
      const price = Number(p);
      const inRange = isHourly ? d === start : (d >= start && d < checkOut);
      if (inRange && Number.isFinite(price) && price >= 0) map[d] = price;
    }
    rates = JSON.stringify(map);
  }

  run('UPDATE reservation_rooms SET check_out_date=?, rate=?, rates=?, remark=? WHERE id=?', checkOut, rate, rates, remark, row.id);

  // 仅对账「已完成夜晚」房费（改价后按新价重算已过夜次）；不提前计当夜及以后
  syncRoomCharges(r.id, r.guest_id, elapsedRoomUnits(r));
  res.json({ ok: true });
}));

// ============ 排房（仅分配房间，不办理入住） ============
router.post('/reservations/:id/assign', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (r.status !== 'reserved' && r.status !== 'checked_in') throw new AppError('该状态不可排房');
  const assignments = Array.isArray(req.body.assignments) ? req.body.assignments : [];
  if (!assignments.length) throw new AppError('请选择要排的房间');
  const lines = safeParseLines(r);
  const used = new Set();
  for (const a of assignments) {
    const rowId = Number(a.row_id);
    const roomId = Number(a.room_id);
    const row = get('SELECT * FROM reservation_rooms WHERE id=? AND reservation_id=?', rowId, r.id);
    if (!row) throw new AppError('排房单元不存在');
    if (row.status !== 'pending') throw new AppError('该房间单元已入住或已处理');
    if (!roomId) throw new AppError('请选择房间');
    if (used.has(roomId)) throw new AppError('同一房间不能重复分配');
    if (!isRoomAvailable(roomId, r.id)) throw new AppError('房间不可用或已被占用');
    const line = lines[row.line_index] || lines[0] || {};
    const lineTypeId = row.room_type_id || line.room_type_id || null;
    if (lineTypeId) {
      const room = get('SELECT type_id FROM rooms WHERE id=?', roomId);
      if (room && Number(room.type_id) !== Number(lineTypeId)) throw new AppError('所选房间与预订房型不符');
    }
    used.add(roomId);
    run('UPDATE reservation_rooms SET room_id=? WHERE id=?', roomId, rowId);
  }
  res.json({ ok: true });
}));

// ============ 入住（支持分批，按 reservation_rooms.id 引用） ============
router.post('/reservations/:id/check-in', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (r.status !== 'reserved') throw new AppError('订单当前状态不可办理入住');

  const rooms = Array.isArray(req.body.rooms) ? req.body.rooms : null;
  if (!rooms || !rooms.length) throw new AppError('请选择要入住的房间');
  if (rooms.some((u) => !u || !u.id)) throw new AppError('入住房间标识缺失');

  const lines = safeParseLines(r);
  const ns = [];
  for (const u of rooms) {
    const rowId = Number(u.id);
    const row = get('SELECT * FROM reservation_rooms WHERE id=? AND reservation_id=?', rowId, r.id);
    if (!row) throw new AppError('入住房间不存在');
    if (row.status !== 'pending') throw new AppError(`房间${row.room_no ? `（${row.room_no}）` : ''}已入住`);
    const roomId = Number(u.room_id);
    if (!roomId) throw new AppError('请选择要入住的房间');
    if (!isRoomAvailable(roomId, r.id)) throw new AppError('该房间不可用或已被占用');
    const line = lines[row.line_index] || lines[0] || {};
    const lineTypeId = line.room_type_id || null;
    if (lineTypeId) {
      const room = get('SELECT type_id FROM rooms WHERE id=?', roomId);
      if (room && Number(room.type_id) !== Number(lineTypeId)) throw new AppError('所选房间与预订房型不符');
    }
    if (u.rate != null) row.rate = Number(u.rate);
    const occ = validateOccupantImpl(u, '入住人');
    const cohabitors = Array.isArray(u.cohabitors)
      ? u.cohabitors.map((c, j) => validateOccupantImpl(c, `同住人${j + 1}`))
      : [];
    ns.push({ row, roomId, ...occ, cohabitors: JSON.stringify(cohabitors) });
  }

  // 逐间写入：置为已入住（持久化该间房入住房价覆盖）
  for (const n of ns) {
    run(
      "UPDATE reservation_rooms SET status='checked_in', room_id=?, guest_name=?, guest_id_card=?, guest_phone=?, cohabitors=?, rate=? WHERE id=?",
      n.roomId, n.name, n.idCard, n.phone, n.cohabitors, n.row.rate || 0, n.row.id
    );
  }

  // 回写 reservations：仅更新展示首间房号与入住时间；预定人信息保留原值，入住人记录在各房间单元上
  if (!r.actual_check_in) run('UPDATE reservations SET actual_check_in=? WHERE id=?', now(), r.id);
  const firstAssigned = get('SELECT room_id FROM reservation_rooms WHERE reservation_id=? AND room_id IS NOT NULL ORDER BY id LIMIT 1', r.id);
  if (firstAssigned) run('UPDATE reservations SET room_id=? WHERE id=?', firstAssigned.room_id, r.id);

  // 入住不自动产生消费；每日房费由夜审在夜审时间统一补计（钟点房于退房时结算）

  // 全部入住则订单状态切为 checked_in
  const pending = get("SELECT COUNT(*) AS c FROM reservation_rooms WHERE reservation_id=? AND status='pending'", r.id).c;
  if (pending === 0) run("UPDATE reservations SET status='checked_in' WHERE id=?", r.id);

  res.json({ ok: true, checked_in_rooms: ns.length, pending_rooms: pending });
}));

// ============ 退房结算信息（预览实际夜数与预计余额） ============
router.get('/reservations/:id/checkout-info', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  // 部分入住时父单仍为 reserved，只要仍有在住子单即可预览（整单口径）
  if (isTerminal(r.status) || !hasCheckedInUnit(r.id)) throw new AppError('当前无可退房间');
  const checkoutDate = req.query.actual_check_out || today();
  const start = r.actual_check_in ? r.actual_check_in.slice(0, 10) : r.check_in_date;
  const actualNights = r.booking_type === '钟点房' ? (r.nights || 1) : Math.max(0, nightsBetween(start, checkoutDate));
  const rc = get(`SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS s FROM folio_items WHERE reservation_id=? AND item_type='room_charge'`, r.id);
  const targetTotal = round2(occupiedRoomUnits(r, checkoutDate).reduce((s, u) => s + u.amount, 0));
  const chargeDelta = round2(targetTotal - rc.s);
  const currentBalance = getBalance(r.id);
  const projectedBalance = round2(currentBalance + chargeDelta);
  const depositBalance = getDepositBalance(r.id);
  const unsettled = unsettledCharges(r.id);
  res.json({
    unsettled_charges: unsettled.total,
    unsettled_count: unsettled.count,
    current_balance: currentBalance,
    projected_balance: projectedBalance,
    charge_delta: chargeDelta,
    deposit_balance: depositBalance,
    // 押金可抵扣金额（抵扣后剩余应补）
    deposit_applied: round2(Math.min(depositBalance, Math.max(0, projectedBalance))),
    actual_nights: actualNights,
    check_in: start,
    check_out: checkoutDate,
    rate: r.rate,
  });
}));

// ============ 单间退房（提前离店）——其余房间继续在住，共享账单 ============
// 最后一间在住退房且无待入住子单时，自动触发整单结算；若仍有待入住子单则订单保持未结束
router.post('/reservations/:id/rooms/:unitId/check-out', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (isTerminal(r.status)) throw new AppError('该订单已结束，不可办理退房');
  const unitId = Number(req.params.unitId);
  const row = get('SELECT * FROM reservation_rooms WHERE id=? AND reservation_id=?', unitId, r.id);
  if (!row) throw new AppError('在住房间不存在');
  if (row.status !== 'checked_in') throw new AppError('该房间未在住或已退房');
  const { payments = [], refund = null, actual_check_out, use_deposit = true, deposit_refund_method = '现金' } = req.body;
  const checkoutDate = actual_check_out || today();
  const roomNo = getRoomNo(row.room_id);

  // 全程事务：任何一步失败（含挂账账户校验）都整体回滚，避免订单半退房
  const out = withTx(() => {
    // 1) 该间置为已退 + 实际离店日 + 房间置脏
    run("UPDATE reservation_rooms SET status='checked_out', actual_check_out=? WHERE id=?", checkoutDate, unitId);
    if (row.room_id) run("UPDATE rooms SET status='dirty' WHERE id=?", row.room_id);

    // 2) 共享账务账单记一条备注（该间离店）
    addFolioItem({ reservationId: r.id, guestId: r.guest_id, itemType: 'info', category: '退房', description: `房间${roomNo}退房 ${checkoutDate}` });

    // 3) 仅对账「已完成夜晚」房费：本间计至实际离店日，其余在住间只保留已过夜次
    //（不按预离日提前计当夜及以后，剩余夜次交由夜审到点补计）
    syncRoomCharges(r.id, r.guest_id, elapsedRoomUnits(r));

    // 4) 统计剩余在住房间
    const remaining = get("SELECT COUNT(*) AS c FROM reservation_rooms WHERE reservation_id=? AND status='checked_in'", r.id).c;
    if (remaining > 0) {
      return { ok: true, final_balance: getBalance(r.id), remaining_rooms: remaining };
    }

    // 4.5) 已无在住房间但仍有待入住子单：不整单结算，订单回到「已预订」
    const pending = get("SELECT COUNT(*) AS c FROM reservation_rooms WHERE reservation_id=? AND status='pending'", r.id).c;
    if (pending > 0) {
      if (r.status === 'checked_in') run("UPDATE reservations SET status='reserved' WHERE id=?", r.id);
      return { ok: true, final_balance: getBalance(r.id), remaining_rooms: 0, order_open: true, pending_rooms: pending };
    }

    // 5) 最后一间退房 → 整单结算（押金/收款/退款/挂账 + 订单已退）
    assertNoOverAr(r.id);
    settleFolio(r, { payments, refund, use_deposit, deposit_refund_method });
    assertAllSettled(r.id);
    run("UPDATE reservations SET status='checked_out', actual_check_out=? WHERE id=?", checkoutDate, r.id);
    const rr = q('SELECT room_id FROM reservation_rooms WHERE reservation_id=?', r.id);
    for (const x of rr) if (x.room_id) run("UPDATE rooms SET status='dirty' WHERE id=?", x.room_id);
    if (!rr.length && r.room_id) run("UPDATE rooms SET status='dirty' WHERE id=?", r.room_id);

    return { ok: true, final_balance: getBalance(r.id), remaining_rooms: 0 };
  });
  return res.json(out);
}));

// ============ 整单退房 ============
router.post('/reservations/:id/check-out', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (isTerminal(r.status) || !hasCheckedInUnit(r.id)) throw new AppError('当前无可退房间');
  const { payments = [], refund = null, actual_check_out, use_deposit = true, deposit_refund_method = '现金' } = req.body;
  const checkoutDate = actual_check_out || today();

  // 全程事务：任何一步失败（含挂账账户校验/过度挂账）都整体回滚，避免订单半退房
  const final_balance = withTx(() => closeOrderTx(r, { payments, refund, use_deposit, deposit_refund_method, checkoutDate }));
  res.json({ ok: true, final_balance });
}));

// ============ 续住：结账退房旧单 -> 按来源预订单/新建单续住当前房间与入住人 ============
// body: { source_reservation_id?（空=新建续住单）, check_out_date, booking_type?, rates:[{date,price}], remark?,
//         payments, refund, use_deposit, deposit_refund_method }
// 口径：保留当前在住子单入住人（含同住人）；以当前在住房间为准覆盖新单房型/房间/日期；旧单手动结账退房
router.post('/reservations/:id/rooms/:unitId/renew', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (isTerminal(r.status)) throw new AppError('该订单已结束，不可续住');
  const unit = get('SELECT * FROM reservation_rooms WHERE id=? AND reservation_id=?', Number(req.params.unitId), r.id);
  if (!unit) throw new AppError('在住房间不存在', 404);
  if (unit.status !== 'checked_in') throw new AppError('仅可对在住房间办理续住');
  if (!unit.room_id) throw new AppError('该房间尚未分配房号');
  if (unitCounts(r.id).checked_in > 1) throw new AppError('该订单还有其他在住房间，请先逐间退房后再续住');

  const room = get('SELECT * FROM rooms WHERE id=?', unit.room_id);
  if (!room) throw new AppError('房间不存在', 404);

  const ci = today();
  // 续住前置条件：当前房间预离日必须为今日（离店日 = 今日）
  const oldCo = String(unit.check_out_date || r.check_out_date || '').slice(0, 10);
  if (oldCo !== ci) throw new AppError(`仅可对今日离店的房间办理续住（当前预离 ${oldCo || '未设置'}）`);
  const occupant = {
    name: unit.guest_name || r.guest_name || '',
    idCard: unit.guest_id_card || '',
    phone: unit.guest_phone || '',
  };
  const cohabitors = unit.cohabitors || '[]';

  const srcId = req.body.source_reservation_id ? Number(req.body.source_reservation_id) : null;
  if (srcId === Number(r.id)) throw new AppError('来源预订单不能是被续订单本身');
  let src = null;
  if (srcId) {
    src = get('SELECT * FROM reservations WHERE id=?', srcId);
    if (!src) throw new AppError('来源预订单不存在', 404);
    if (src.status !== 'reserved') throw new AppError('来源预订单必须为「已预订」状态');
    const sc = unitCounts(src.id);
    if (sc.checked_in > 0 || sc.checked_out > 0) throw new AppError('来源预订单已有入住/退房记录，不可作为续住单');
    if (unitInfos(src).length !== 1) throw new AppError('来源预订单需为单间订单，暂不支持多间续住');
    // 续住前置条件：来源预订单入住日必须为今日（今日 = 续住单入住日）
    if (String(src.check_in_date || '').slice(0, 10) !== ci) throw new AppError(`来源预订单的入住日期须为今日（该单入住 ${src.check_in_date || '-'}），方可续住`);
  }

  const { payments = [], refund = null, use_deposit = true, deposit_refund_method = '现金' } = req.body;

  // 新单参数：
  //  · 选用来源预订单 -> 完全沿用该预订单自身的房型/日期/房价（不可编辑），房间取当前在住房间
  //  · 新建续住单   -> 房型取当前在住房间实际房型，日期/房价由入参决定
  let nBookingType; let nCi; let nCo; let nNights; let nRoomTypeId;
  let nLines; let nLinesJson; let nRatesTop; let nTotal; let nFirstRate;
  if (src) {
    nBookingType = src.booking_type || '全日房';
    nCi = src.check_in_date;
    nCo = src.check_out_date;
    nNights = src.nights || (nBookingType === '钟点房' ? 1 : Math.max(1, nightsBetween(nCi, nCo)));
    nLines = safeParseLines(src);
    nLinesJson = JSON.stringify(nLines);
    nRatesTop = src.rates || '{}';
    nTotal = src.total_amount || 0;
    nRoomTypeId = src.room_type_id || (nLines[0] && nLines[0].room_type_id) || room.type_id || unit.room_type_id || null;
    nFirstRate = 0;
  } else {
    nBookingType = req.body.booking_type || '全日房';
    const isHourly = nBookingType === '钟点房';
    nCi = ci;
    nCo = isHourly ? ci : (req.body.check_out_date || addDays(ci, 1));
    if (!isHourly && nCo <= ci) throw new AppError('离店日期必须晚于今日');
    nNights = isHourly ? 1 : Math.max(1, nightsBetween(ci, nCo));
    nRoomTypeId = room.type_id || unit.room_type_id || null;
    const dates = [];
    for (let i = 0; i < nNights; i++) dates.push(addDays(ci, i));
    const provided = Array.isArray(req.body.rates) ? req.body.rates : [];
    const fallbackRate = round2(roomRate(r, unit, ci));
    const rateMap = {};
    for (const d of dates) {
      const hit = provided.find((x) => x && String(x.date) === d);
      rateMap[d] = round2(hit && Number(hit.price) > 0 ? Number(hit.price) : fallbackRate);
    }
    if (!dates.length || !Object.values(rateMap).some((p) => p > 0)) throw new AppError('请设置续住房价');
    nFirstRate = rateMap[dates[0]];
    nLines = [{ room_type_id: nRoomTypeId, rooms: 1, rate: nFirstRate, rates: JSON.stringify(rateMap) }];
    nLinesJson = JSON.stringify(nLines);
    nRatesTop = JSON.stringify(rateMap);
    nTotal = round2(Object.values(rateMap).reduce((s, p) => s + p, 0));
  }

  const out = withTx(() => {
    // 1) 结账退房旧单（整单，手动收款口径）
    closeOrderTx(r, { payments, refund, use_deposit, deposit_refund_method, checkoutDate: ci });

    // 2) 释放后确认原房间可用（排除来源预订单自身）
    if (!isRoomAvailable(unit.room_id, src ? src.id : null)) throw new AppError('原房间不可用，无法续住');

    // 3) 落地新单
    let targetId; let targetNo;
    if (src) {
      // 复用来源预订单：保留其房型/日期/房价/预定人；仅房间指向当前在住房间、子单入住人改为当前在住人
      run(
        `UPDATE reservations SET room_id=?, renew_from_order_no=?, status='checked_in', actual_check_in=?, actual_check_out=NULL
         WHERE id=?`,
        unit.room_id, r.order_no, now(), src.id
      );
      const row = get('SELECT * FROM reservation_rooms WHERE reservation_id=? ORDER BY id LIMIT 1', src.id);
      if (!row) throw new AppError('来源预订单房间单元缺失');
      run(
        `UPDATE reservation_rooms SET status='checked_in', room_id=?, guest_name=?, guest_id_card=?, guest_phone=?,
           cohabitors=?, rate=0, rates='{}', check_out_date=NULL, actual_check_out=NULL WHERE id=?`,
        unit.room_id, occupant.name, occupant.idCard, occupant.phone, cohabitors, row.id
      );
      targetId = src.id;
      targetNo = src.order_no;
    } else {
      // 新建续住单：订单头=当前入住人；来源渠道沿用旧单，续住来源记旧单号；子单房价留空走线路价
      const order_no = genOrderNo();
      const rid = Number(run(
        `INSERT INTO reservations
          (order_no, guest_id, guest_name, guest_phone, guest_id_card, room_type_id, room_id,
           check_in_date, check_out_date, nights, adults, rate, rooms, total_amount,
           status, booking_type, source, source_order_no, renew_from_order_no, remark, rates, lines, actual_check_in)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        order_no, r.guest_id, occupant.name, occupant.phone, occupant.idCard, nRoomTypeId, unit.room_id,
        nCi, nCo, nNights, r.adults || 1, nFirstRate, 1, nTotal,
        'checked_in', nBookingType, r.source || '散客', r.source_order_no || '', r.order_no,
        req.body.remark != null ? String(req.body.remark) : '', nRatesTop, nLinesJson, now()
      ).lastInsertRowid);
      run(
        `INSERT INTO reservation_rooms
          (reservation_id, room_id, room_type_id, line_index, guest_name, guest_id_card, guest_phone, cohabitors, rate, rates, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        rid, unit.room_id, nRoomTypeId, 0, occupant.name, occupant.idCard, occupant.phone, cohabitors, 0, '{}', 'checked_in'
      );
      targetId = rid;
      targetNo = order_no;
    }

    return { ok: true, order_id: targetId, order_no: targetNo, final_balance: getBalance(r.id) };
  });
  res.json(out);
}));

// ============ 取消 ============
router.post('/reservations/:id/cancel', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (r.status !== 'reserved') throw new AppError('仅预订状态可取消');
  const inHouse = get("SELECT COUNT(*) AS c FROM reservation_rooms WHERE reservation_id=? AND status='checked_in'", r.id).c;
  if (inHouse > 0) throw new AppError('已有房间入住，无法取消');
  run("UPDATE reservations SET status='cancelled' WHERE id=?", r.id);
  res.json({ ok: true });
}));

// ============ 恢复预定 ============
router.post('/reservations/:id/restore', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (r.status !== 'cancelled') throw new AppError('仅已取消状态可恢复预定');
  run("UPDATE reservations SET status='reserved' WHERE id=?", r.id);
  res.json({ ok: true });
}));

// ============ 未到 ============
router.post('/reservations/:id/no-show', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (r.status !== 'reserved') throw new AppError('仅预订状态可标记未到');
  const inHouse = get("SELECT COUNT(*) AS c FROM reservation_rooms WHERE reservation_id=? AND status='checked_in'", r.id).c;
  if (inHouse > 0) throw new AppError('已有房间入住，无法标记未到');
  run("UPDATE reservations SET status='no_show' WHERE id=?", r.id);
  res.json({ ok: true });
}));

// ============ 换房（按子单定位，支持多间订单换指定房） ============
router.post('/reservations/:id/change-room', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (isTerminal(r.status) || !hasCheckedInUnit(r.id)) throw new AppError('当前无可换房房间');
  const { new_room_id, reason = '', unit_id } = req.body;
  if (!new_room_id) throw new AppError('请选择新房间');

  // 定位在住子单：优先显式 unit_id，否则取第一间在住
  const unit = unit_id
    ? get('SELECT * FROM reservation_rooms WHERE id=? AND reservation_id=?', Number(unit_id), r.id)
    : get("SELECT * FROM reservation_rooms WHERE reservation_id=? AND status='checked_in' ORDER BY id LIMIT 1", r.id);
  if (!unit) throw new AppError('在住房间不存在');
  if (unit.status !== 'checked_in') throw new AppError('该房间未在住，不可换房');
  if (!unit.room_id) throw new AppError('该房间尚未分配房号');
  if (Number(new_room_id) === Number(unit.room_id)) throw new AppError('新房间与原房间相同');
  if (!isRoomAvailable(new_room_id, r.id)) throw new AppError('新房间不可用或已被占用');

  const oldRoomNo = getRoomNo(unit.room_id);
  const newRoomNo = getRoomNo(new_room_id);
  run('UPDATE reservation_rooms SET room_id=? WHERE id=?', new_room_id, unit.id);
  // 父单展示房号：换的若是父单指向的首间，同步更新父单 room_id
  if (Number(r.room_id) === Number(unit.room_id)) run('UPDATE reservations SET room_id=? WHERE id=?', new_room_id, r.id);
  run("UPDATE rooms SET status='dirty' WHERE id=?", unit.room_id);
  addFolioItem({
    reservationId: r.id, guestId: r.guest_id, itemType: 'info', category: '换房',
    description: `换房：${oldRoomNo} → ${newRoomNo}${reason ? '（' + reason + '）' : ''}`,
  });
  res.json({ ok: true });
}));

module.exports = router;
