// 账务管理：客账 / 流水 / 营业报表
const express = require('express');
const { q, get, run } = require('../db');
const { AppError, wrap } = require('../errors');
const { addFolioItem, getBalance } = require('../folio');
const { addDays, nightsBetween, round2 } = require('../utils');

const router = express.Router();

// ============ 客账明细 ============
router.get('/finance/folio', wrap((req, res) => {
  const { reservation_id } = req.query;
  if (!reservation_id) throw new AppError('缺少 reservation_id');
  const r = get('SELECT * FROM reservations WHERE id=?', reservation_id);
  if (!r) throw new AppError('订单不存在', 404);
  const items = q('SELECT * FROM folio_items WHERE reservation_id=? ORDER BY id', reservation_id);
  res.json({ reservation: r, items, balance: getBalance(reservation_id) });
}));

// ============ 加账/付款/调整 ============
router.post('/finance/items', wrap((req, res) => {
  const { reservation_id, item_type, category = '', description = '', amount, method = '' } = req.body;
  if (!reservation_id) throw new AppError('缺少 reservation_id');
  const r = get('SELECT * FROM reservations WHERE id=?', reservation_id);
  if (!r) throw new AppError('订单不存在', 404);
  if (amount === undefined || isNaN(amount)) throw new AppError('金额必须为数字');
  const amt = round2(Number(amount));

  if (item_type === 'payment') {
    // 前台传正数，入账为负（减少应收）
    addFolioItem({
      reservationId: reservation_id, guestId: r.guest_id, itemType: 'payment',
      category: category || `${method}收款`,
      description: description || '收款',
      amount: -amt, method,
    });
  } else if (item_type === 'adj') {
    addFolioItem({ reservationId: reservation_id, guestId: r.guest_id, itemType: 'adj', category: category || '调整', description: description || '账务调整', amount: amt, method });
  } else {
    addFolioItem({ reservationId: reservation_id, guestId: r.guest_id, itemType: 'extra_charge', category: category || '杂费', description: description || '杂费', amount: amt, method });
  }
  res.json({ ok: true, balance: getBalance(reservation_id) });
}));

// ============ 冲销明细 ============
router.delete('/finance/items/:id', wrap((req, res) => {
  const item = get('SELECT * FROM folio_items WHERE id=?', req.params.id);
  if (!item) throw new AppError('明细不存在', 404);
  run('DELETE FROM folio_items WHERE id=?', req.params.id);
  res.json({ ok: true, balance: getBalance(item.reservation_id) });
}));

// ============ 账务流水 ============
router.get('/finance/transactions', wrap((req, res) => {
  const { start, end, keyword } = req.query;
  const conds = [];
  const params = [];
  if (start) { conds.push("f.created_at >= ?"); params.push(start + ' 00:00:00'); }
  if (end) { conds.push("f.created_at <= ?"); params.push(end + ' 23:59:59'); }
  if (keyword) {
    conds.push('(f.description LIKE ? OR f.category LIKE ? OR f.method LIKE ? OR r.order_no LIKE ? OR r.guest_name LIKE ?)');
    const k = `%${keyword}%`;
    params.push(k, k, k, k, k);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const list = q(`SELECT f.*, r.order_no, r.guest_name, rm.room_no
                  FROM folio_items f
                  LEFT JOIN reservations r ON r.id=f.reservation_id
                  LEFT JOIN rooms rm ON rm.id=r.room_id
                  ${where} ORDER BY f.id DESC`, ...params);
  const totalAmount = round2(list.reduce((s, x) => s + x.amount, 0));
  res.json({ list, totalAmount });
}));

// ============ 营业报表 ============
router.get('/finance/report', wrap((req, res) => {
  const { start, end } = req.query;
  if (!start || !end) throw new AppError('缺少日期范围');
  const items = q(`SELECT f.* FROM folio_items f
                   WHERE date(f.created_at) >= ? AND date(f.created_at) <= ?
                   ORDER BY date(f.created_at), f.id`, start, end);

  let roomRevenue = 0, extraRevenue = 0, adjTotal = 0, paymentTotal = 0, refundTotal = 0;
  const chargeByCategory = {};
  const paymentByMethod = {};
  const byDate = {};

  for (const it of items) {
    const d = it.created_at.slice(0, 10);
    if (!byDate[d]) byDate[d] = { room: 0, extra: 0, payment: 0 };
    if (it.item_type === 'room_charge') {
      roomRevenue += it.amount;
      byDate[d].room += it.amount;
      chargeByCategory['房费'] = (chargeByCategory['房费'] || 0) + it.amount;
    } else if (it.item_type === 'extra_charge') {
      extraRevenue += it.amount;
      byDate[d].extra += it.amount;
      chargeByCategory[it.category || '杂费'] = (chargeByCategory[it.category || '杂费'] || 0) + it.amount;
    } else if (it.item_type === 'adj') {
      adjTotal += it.amount;
      chargeByCategory[it.category || '调整'] = (chargeByCategory[it.category || '调整'] || 0) + it.amount;
    } else if (it.item_type === 'payment') {
      if (it.amount < 0) {
        paymentTotal += -it.amount;
        byDate[d].payment += -it.amount;
        const m = it.method || '其他';
        paymentByMethod[m] = (paymentByMethod[m] || 0) + -it.amount;
      } else {
        refundTotal += it.amount;
      }
    }
  }

  // 间夜/入住率（统计范围内每日在住房间数，多间按 reservation_rooms 计）
  const stays = q(`SELECT r.*, (SELECT COUNT(*) FROM reservation_rooms rr WHERE rr.reservation_id=r.id) AS assigned_rooms
                   FROM reservations r WHERE r.status IN ('checked_in','checked_out')`);
  let nightsSold = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const occ = stays.reduce((sum, s) => {
      const ci = s.actual_check_in ? s.actual_check_in.slice(0, 10) : s.check_in_date;
      const co = s.actual_check_out ? s.actual_check_out.slice(0, 10) : s.check_out_date;
      if (ci <= d && co > d) return sum + Math.max(1, s.assigned_rooms || 1);
      return sum;
    }, 0);
    nightsSold += occ;
  }
  const days = Math.max(1, nightsBetween(start, end) + 1);
  const totalRooms = get('SELECT COUNT(*) AS c FROM rooms').c || 1;
  const occupancy = days > 0 ? (nightsSold / (totalRooms * days) * 100) : 0;
  const adr = nightsSold > 0 ? roomRevenue / nightsSold : 0;

  // 按日序列
  const daily = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const x = byDate[d] || { room: 0, extra: 0, payment: 0 };
    daily.push({ date: d, room: round2(x.room), extra: round2(x.extra), payment: round2(x.payment) });
  }

  res.json({
    start, end,
    room_revenue: round2(roomRevenue),
    extra_revenue: round2(extraRevenue),
    adj_total: round2(adjTotal),
    charge_total: round2(roomRevenue + extraRevenue),
    payment_total: round2(paymentTotal),
    refund_total: round2(refundTotal),
    nights_sold: nightsSold,
    occupancy_rate: Math.round(occupancy * 10) / 10,
    adr: Math.round(adr * 100) / 100,
    chargeByCategory: Object.entries(chargeByCategory).map(([category, amount]) => ({ category, amount: round2(amount) })),
    paymentByMethod: Object.entries(paymentByMethod).map(([method, amount]) => ({ method, amount: round2(amount) })),
    daily,
  });
}));

module.exports = router;
