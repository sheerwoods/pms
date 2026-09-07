// 订单管理 + 入住/退房/取消/未到/换房
const express = require('express');
const { q, get, run } = require('../db');
const { AppError, wrap } = require('../errors');
const { addFolioItem, getBalance, getFolio, syncRoomCharges } = require('../folio');
const { genOrderNo, nightsBetween, today, now, addDays, round2 } = require('../utils');

const router = express.Router();

function getRoomNo(id) {
  if (!id) return '-';
  const r = get('SELECT room_no FROM rooms WHERE id=?', id);
  return r ? r.room_no : '-';
}

// 房间是否可用（未被占用/维修）
function isRoomAvailable(roomId, excludeResId = null) {
  if (!roomId) return false;
  const room = get('SELECT * FROM rooms WHERE id=?', roomId);
  if (!room || room.status === 'ooo') return false;
  const active = get(
    "SELECT id FROM reservations WHERE room_id=? AND status IN ('reserved','checked_in') AND id != ? LIMIT 1",
    roomId, excludeResId || 0
  );
  return !active;
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

function parseRates(s) {
  try { return JSON.parse(s && s.rates ? s.rates : '{}'); } catch { return {}; }
}

function safeParseLines(r) {
  try {
    const arr = r.lines ? JSON.parse(r.lines) : [];
    if (Array.isArray(arr) && arr.length) return arr;
  } catch { /* fall through */ }
  return [{ room_type_id: r.room_type_id || null, rooms: r.rooms || 1, rate: r.rate || 0, rates: r.rates || '{}' }];
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

// 展开为房费单元：每个 房型×每晚×每间 一条
function lineUnits(lines, dates) {
  const units = [];
  for (const ln of lines) {
    const map = parseRates(ln);
    const fb = Number(ln.rate) || 0;
    const rooms = Math.max(1, Number(ln.rooms) || 1);
    for (const d of dates) {
      const price = map[d] != null ? map[d] : fb;
      for (let m = 0; m < rooms; m++) units.push({ date: d, amount: price });
    }
  }
  return units;
}

// 从存量订单取实际入住期间的房费单元
function reservationUnits(r, startDate, nights) {
  const lines = safeParseLines(r);
  const dates = [];
  for (let i = 0; i < nights; i++) dates.push(addDays(startDate, i));
  return lineUnits(lines, dates);
}

// 入住时生成房费明细（每个 房型×每晚×每间 一条）
function postCheckIn(rid, guestId, units) {
  for (const u of units) {
    addFolioItem({ reservationId: rid, guestId, itemType: 'room_charge', category: '房费', description: `房费(${u.date})`, amount: u.amount });
  }
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
  if (status) { conds.push('r.status = ?'); params.push(status); }
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
  const list = q(`SELECT r.*, rm.room_no, t.name AS type_name,
                    (SELECT COALESCE(SUM(amount),0) FROM folio_items fi WHERE fi.reservation_id=r.id) AS balance
                  FROM reservations r
                  LEFT JOIN rooms rm ON rm.id=r.room_id
                  LEFT JOIN room_types t ON t.id=r.room_type_id
                  ${where}
                  ORDER BY r.id DESC LIMIT ? OFFSET ?`, ...params, Number(pageSize), offset);
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
  r.balance = getBalance(r.id);
  r.folio = getFolio(r.id);
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
    guest_id, guest_name, guest_phone,
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
    else gid = Number(run('INSERT INTO guests (name, phone) VALUES (?,?)', guest_name, guest_phone || '').lastInsertRowid);
  } else if (guest_phone) {
    run('UPDATE guests SET phone=? WHERE id=?', guest_phone, gid);
  }

  const status = auto_checkin ? 'checked_in' : 'reserved';
  const order_no = genOrderNo();
  const rid = Number(run(
    `INSERT INTO reservations
      (order_no, guest_id, guest_name, guest_phone, room_type_id, room_id,
       check_in_date, check_out_date, nights, adults, rate, rooms, total_amount,
       status, booking_type, source, source_order_no, remark, rates, lines, actual_check_in)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    order_no, gid, guest_name, guest_phone || '', first.room_type_id, b.room_id || null,
    ci, co, nights, adults, first.rate, first.rooms, total,
    status, booking_type, source, source_order_no, remark, first.rates, linesJson, auto_checkin ? now() : null
  ).lastInsertRowid);

  if (auto_checkin) {
    postCheckIn(rid, gid, lineUnits(lines, p.dates));
  }
  res.json({ id: rid, order_no });
}));

// ============ 修改订单（含续住/调价/换房） ============
router.put('/reservations/:id', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (['checked_out', 'cancelled', 'no_show'].includes(r.status)) throw new AppError('该状态的订单不可修改');
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

  // 在住订单按新日期/房型/间数同步房费（钟点房固定 1 晚）
  if (r.status === 'checked_in') {
    const start = r.actual_check_in ? r.actual_check_in.slice(0, 10) : check_in_date;
    const targetNights = isHourly ? 1 : Math.max(0, nightsBetween(start, check_out_date));
    syncRoomCharges(r.id, r.guest_id, reservationUnits({ ...r, lines: linesJson }, start, targetNights));
  }
  res.json({ ok: true });
}));

// ============ 入住 ============
router.post('/reservations/:id/check-in', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (r.status !== 'reserved') throw new AppError('仅预订状态可办理入住');
  const { room_id } = req.body;
  if (!room_id) throw new AppError('请选择房间');
  if (!isRoomAvailable(room_id, r.id)) throw new AppError('该房间不可用或已被占用');

  run("UPDATE reservations SET room_id=?, status='checked_in', actual_check_in=? WHERE id=?", room_id, now(), r.id);
  postCheckIn(r.id, r.guest_id, reservationUnits(r, r.check_in_date, r.nights));
  res.json({ ok: true });
}));

// ============ 退房结算信息（预览实际夜数与预计余额） ============
router.get('/reservations/:id/checkout-info', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (r.status !== 'checked_in') throw new AppError('仅在住状态可办理退房');
  const checkoutDate = req.query.actual_check_out || today();
  const start = r.actual_check_in ? r.actual_check_in.slice(0, 10) : r.check_in_date;
  const actualNights = r.booking_type === '钟点房' ? (r.nights || 1) : Math.max(0, nightsBetween(start, checkoutDate));
  const rc = get(`SELECT COUNT(*) AS c, COALESCE(SUM(amount),0) AS s FROM folio_items WHERE reservation_id=? AND item_type='room_charge'`, r.id);
  const targetTotal = round2(reservationUnits(r, start, actualNights).reduce((s, u) => s + u.amount, 0));
  const chargeDelta = round2(targetTotal - rc.s);
  const currentBalance = getBalance(r.id);
  res.json({
    current_balance: currentBalance,
    projected_balance: round2(currentBalance + chargeDelta),
    charge_delta: chargeDelta,
    actual_nights: actualNights,
    check_in: start,
    check_out: checkoutDate,
    rate: r.rate,
  });
}));

// ============ 退房 ============
router.post('/reservations/:id/check-out', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (r.status !== 'checked_in') throw new AppError('仅在住状态可办理退房');
  const { payments = [], refund = null, actual_check_out } = req.body;
  const checkoutDate = actual_check_out || today();
  const start = r.actual_check_in ? r.actual_check_in.slice(0, 10) : r.check_in_date;
  const actualNights = r.booking_type === '钟点房' ? (r.nights || 1) : Math.max(0, nightsBetween(start, checkoutDate));

  // 按实际夜数(或固定1晚)调平各房型房费
  syncRoomCharges(r.id, r.guest_id, reservationUnits(r, start, actualNights));

  // 收款
  for (const p of payments || []) {
    const amt = Number(p.amount) || 0;
    if (amt > 0) {
      addFolioItem({ reservationId: r.id, guestId: r.guest_id, itemType: 'payment', category: `${p.method}收款`, description: '结账收款', amount: -amt, method: p.method });
    }
  }
  // 退款（找零）
  if (refund && Number(refund.amount) > 0) {
    addFolioItem({ reservationId: r.id, guestId: r.guest_id, itemType: 'payment', category: '退款', description: '退款找零', amount: Number(refund.amount), method: refund.method || '现金' });
  }

  run("UPDATE reservations SET status='checked_out', actual_check_out=? WHERE id=?", checkoutDate, r.id);
  if (r.room_id) run("UPDATE rooms SET status='dirty' WHERE id=?", r.room_id);

  res.json({ ok: true, final_balance: getBalance(r.id) });
}));

// ============ 取消 ============
router.post('/reservations/:id/cancel', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (!['reserved', 'checked_in'].includes(r.status)) throw new AppError('当前状态不可取消');
  run("UPDATE reservations SET status='cancelled' WHERE id=?", r.id);
  res.json({ ok: true });
}));

// ============ 未到 ============
router.post('/reservations/:id/no-show', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (r.status !== 'reserved') throw new AppError('仅预订状态可标记未到');
  run("UPDATE reservations SET status='no_show' WHERE id=?", r.id);
  res.json({ ok: true });
}));

// ============ 换房 ============
router.post('/reservations/:id/change-room', wrap((req, res) => {
  const r = get('SELECT * FROM reservations WHERE id=?', req.params.id);
  if (!r) throw new AppError('订单不存在', 404);
  if (r.status !== 'checked_in') throw new AppError('仅在住状态可换房');
  const { new_room_id, reason = '' } = req.body;
  if (!new_room_id) throw new AppError('请选择新房间');
  if (Number(new_room_id) === Number(r.room_id)) throw new AppError('新房间与原房间相同');
  if (!isRoomAvailable(new_room_id, r.id)) throw new AppError('新房间不可用或已被占用');

  const oldRoomNo = getRoomNo(r.room_id);
  const newRoomNo = getRoomNo(new_room_id);
  run('UPDATE reservations SET room_id=? WHERE id=?', new_room_id, r.id);
  if (r.room_id) run("UPDATE rooms SET status='dirty' WHERE id=?", r.room_id);
  addFolioItem({
    reservationId: r.id, guestId: r.guest_id, itemType: 'info', category: '换房',
    description: `换房：${oldRoomNo} → ${newRoomNo}${reason ? '（' + reason + '）' : ''}`,
  });
  res.json({ ok: true });
}));

module.exports = router;
