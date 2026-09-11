// 账务管理：客账 / 流水 / 应收台账 / 营业报表
// 口径：金额正=消费(应收增加)，负=收款(应收减少)；营业日 = business_date
const express = require('express');
const { q, get, run } = require('../db');
const { withTx } = require('../tx');
const { AppError, wrap } = require('../errors');
const { addFolioItem, getBalance, getDepositBalance } = require('../folio');
const { addDays, nightsBetween, round2 } = require('../utils');
const { folioSummary, itemKind } = require('../accounting');
const { itemStates, unsettledCharges, settleTx, revokeSettlementTx } = require('../settlement');

const router = express.Router();

// 营业日兜底表达式（分表别名，避免 JOIN 后列名歧义）
const F_BD = 'COALESCE(f.business_date, date(f.created_at))';

// 本单有效结账批次（含配对明细），供前端展示与撤销
function listSettlements(reservationId) {
  const rows = q('SELECT * FROM folio_settlements WHERE reservation_id=? AND revoked_at IS NULL ORDER BY id DESC', reservationId);
  if (!rows.length) return [];
  const allocs = q(
    `SELECT al.*, f.item_type, f.category, f.description, f.method, f.amount
     FROM folio_allocations al
     JOIN folio_items f ON f.id=al.item_id
     WHERE al.settlement_id IN (SELECT id FROM folio_settlements WHERE reservation_id=? AND revoked_at IS NULL)
     ORDER BY al.id`,
    reservationId
  );
  const bySettlement = {};
  for (const a of allocs) (bySettlement[a.settlement_id] = bySettlement[a.settlement_id] || []).push(a);
  return rows.map((s) => ({ ...s, allocations: bySettlement[s.id] || [] }));
}

// ============ 客账明细 ============
router.get('/finance/folio', wrap((req, res) => {
  const { reservation_id } = req.query;
  if (!reservation_id) throw new AppError('缺少 reservation_id');
  const r = get('SELECT * FROM reservations WHERE id=?', reservation_id);
  if (!r) throw new AppError('订单不存在', 404);
  const items = itemStates(reservation_id).map((s) => ({
    ...s.item,
    kind: itemKind(s.item),
    settle_status: s.status,
    settle_side: s.side,                                  // charge / payment / null（不参与配对）
    settled_amount: round2(s.allocC / 100),
    unsettled_amount: s.side ? round2(s.remainingC / 100) : 0,
  }));
  res.json({
    reservation: r,
    items,
    summary: folioSummary(items),
    balance: getBalance(reservation_id),                 // 应收（欠款）
    deposit_balance: getDepositBalance(reservation_id),  // 押金余额
    unsettled_charges: unsettledCharges(reservation_id), // 未结消费（退房闸门）
    settlements: listSettlements(reservation_id),
  });
}));

// ============ 逐笔结账 / 撤销结账 ============
router.post('/finance/settle', wrap((req, res) => {
  const { reservation_id, charge_ids, payment_ids, remark = '' } = req.body;
  if (!reservation_id) throw new AppError('缺少 reservation_id');
  res.json(settleTx({ reservationId: reservation_id, chargeIds: charge_ids, paymentIds: payment_ids, remark }));
}));

router.post('/finance/settlements/:id/revoke', wrap((req, res) => {
  res.json(revokeSettlementTx(req.params.id));
}));

// ============ 加账/收款/退款/押金/调整 ============
router.post('/finance/items', wrap((req, res) => {
  const { reservation_id, item_type, category = '', description = '', amount, method = '' } = req.body;
  if (!reservation_id) throw new AppError('缺少 reservation_id');
  const r = get('SELECT * FROM reservations WHERE id=?', reservation_id);
  if (!r) throw new AppError('订单不存在', 404);
  if (amount === undefined || isNaN(amount)) throw new AppError('金额必须为数字');
  // 挂账必须走 AR 账户（/ar/charge），否则会产生无台账的游离应收
  if (method === '挂账') throw new AppError('挂账请使用「挂账到 AR 账户」并选择账户');
  const amt = round2(Number(amount));
  const common = { reservationId: reservation_id, guestId: r.guest_id };

  if (item_type === 'payment') {
    // 收款：前台传正数，入账为负（减少应收）
    addFolioItem({ ...common, itemType: 'payment', category: category || `${method}收款`, description: description || '收款', amount: -amt, method });
  } else if (item_type === 'refund') {
    // 退款：入账为正（增加应收）
    addFolioItem({ ...common, itemType: 'payment', category: category || '退款', description: description || '退款', amount: amt, method });
  } else if (item_type === 'deposit') {
    // 收取押金：入账为负（押金专户，不计应收）
    addFolioItem({ ...common, itemType: 'deposit', category: category || '押金', description: description || '收取押金', amount: -amt, method });
  } else if (item_type === 'deposit_refund') {
    // 退还押金：入账为正
    addFolioItem({ ...common, itemType: 'deposit', category: category || '退押金', description: description || '退还押金', amount: amt, method });
  } else if (item_type === 'adj') {
    addFolioItem({ ...common, itemType: 'adj', category: category || '调整', description: description || '账务调整', amount: amt, method });
  } else {
    addFolioItem({ ...common, itemType: 'extra_charge', category: category || '杂费', description: description || '杂费', amount: amt, method });
  }
  res.json({ ok: true, balance: getBalance(reservation_id), deposit_balance: getDepositBalance(reservation_id) });
}));

// ============ 冲销明细 ============
router.delete('/finance/items/:id', wrap((req, res) => {
  const item = get('SELECT * FROM folio_items WHERE id=?', req.params.id);
  if (!item) throw new AppError('明细不存在', 404);

  // 已参与逐笔结账/挂账的明细不可直接冲销，须先撤销对应批次
  const allocated = get('SELECT COALESCE(SUM(amount),0) AS s FROM folio_allocations WHERE item_id=?', item.id).s;
  if (Math.abs(allocated) > 0.005) throw new AppError('该笔已参与结账/挂账，请先「撤销结账」后再冲销');

  // 挂账付款：连同 AR 应收明细一并回滚；已有回款核销则拒绝（绝不自动级联冲销已收现金）
  if (item.item_type === 'payment' && item.method === '挂账') {
    const linked = get('SELECT * FROM city_ledger WHERE folio_item_id=?', item.id);
    if (linked) {
      const allocs = get('SELECT COUNT(*) AS c FROM ar_allocations WHERE entry_id=?', linked.id).c;
      if (allocs > 0 || Number(linked.settled_amount) > 0.005) {
        throw new AppError('该笔挂账已有回款核销，请先在「应收账款」冲销回款');
      }
      withTx(() => {
        run('DELETE FROM city_ledger WHERE id=?', linked.id);
        run('DELETE FROM folio_items WHERE id=?', item.id);
      });
      return res.json({ ok: true, balance: getBalance(item.reservation_id), deposit_balance: getDepositBalance(item.reservation_id) });
    }
    // legacy：无 folio_item_id 关联时保守拦截
    const open = get("SELECT COUNT(*) AS c FROM city_ledger WHERE reservation_id=? AND ar_account_id IS NOT NULL", item.reservation_id).c;
    if (open > 0) throw new AppError('该笔挂账已生成应收台账，请先在「应收账款」删除对应明细');
  }

  run('DELETE FROM folio_items WHERE id=?', req.params.id);
  res.json({ ok: true, balance: getBalance(item.reservation_id), deposit_balance: getDepositBalance(item.reservation_id) });
}));

// ============ 账务流水 ============
router.get('/finance/transactions', wrap((req, res) => {
  const { start, end, keyword } = req.query;
  const conds = [];
  const params = [];
  if (start) { conds.push(`${F_BD} >= ?`); params.push(start); }
  if (end) { conds.push(`${F_BD} <= ?`); params.push(end); }
  if (keyword) {
    conds.push('(f.description LIKE ? OR f.category LIKE ? OR f.method LIKE ? OR r.order_no LIKE ? OR r.guest_name LIKE ?)');
    const k = `%${keyword}%`;
    params.push(k, k, k, k, k);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const list = q(`SELECT f.*, ${F_BD} AS bdate, r.order_no, r.guest_name, rm.room_no
                  FROM folio_items f
                  LEFT JOIN reservations r ON r.id=f.reservation_id
                  LEFT JOIN rooms rm ON rm.id=r.room_id
                  ${where} ORDER BY f.id DESC`, ...params)
    .map((it) => ({ ...it, kind: itemKind(it) }));
  const totalAmount = round2(list.reduce((s, x) => s + x.amount, 0));
  res.json({ list, totalAmount });
}));

// 应收账款（挂账台账）的查询/核销已迁移至 /ar/*（AR 账户模块）

// ============ 营业报表 ============
router.get('/finance/report', wrap((req, res) => {
  const { start, end } = req.query;
  if (!start || !end) throw new AppError('缺少日期范围');
  const items = q(`SELECT f.*, ${F_BD} AS bdate FROM folio_items f
                   WHERE ${F_BD} >= ? AND ${F_BD} <= ?
                   ORDER BY bdate, f.id`, start, end);

  let roomRevenue = 0, extraRevenue = 0, adjTotal = 0;
  let paymentTotal = 0, refundTotal = 0, cityLedgerTotal = 0;
  let depositIn = 0, depositOut = 0;
  const chargeByCategory = {};
  const paymentByMethod = {};
  const byDate = {};

  for (const it of items) {
    const d = it.bdate;
    if (!byDate[d]) byDate[d] = { room: 0, extra: 0, payment: 0, refund: 0 };
    const kind = itemKind(it);
    if (kind === 'room_charge') {
      roomRevenue += it.amount;
      byDate[d].room += it.amount;
      chargeByCategory['房费'] = (chargeByCategory['房费'] || 0) + it.amount;
    } else if (kind === 'extra_charge') {
      extraRevenue += it.amount;
      byDate[d].extra += it.amount;
      const c = it.category || '杂费';
      chargeByCategory[c] = (chargeByCategory[c] || 0) + it.amount;
    } else if (kind === 'adj') {
      adjTotal += it.amount;                            // 调整独立列示，不进收入分类
    } else if (kind === 'payment') {
      paymentTotal += -it.amount;
      byDate[d].payment += -it.amount;
      const m = it.method || '其他';
      paymentByMethod[m] = (paymentByMethod[m] || 0) + -it.amount;
    } else if (kind === 'refund') {
      refundTotal += it.amount;
      byDate[d].refund += it.amount;
    } else if (kind === 'city_ledger') {
      cityLedgerTotal += -it.amount;                    // 挂账应收，不计实收
    } else if (kind === 'deposit_in') {
      depositIn += -it.amount;
    } else if (kind === 'deposit_out') {
      depositOut += it.amount;
    }
    // deposit_offset 既非实收也非收入，忽略
  }

  // AR 回款（客户还款到账户）单独列示，不并入实收/净收，避免双计
  const arReceiptTotal = get(
    "SELECT COALESCE(SUM(amount),0) AS s FROM ar_receipts WHERE COALESCE(business_date, date(created_at)) >= ? AND COALESCE(business_date, date(created_at)) <= ?",
    start, end
  ).s;

  // 间夜/入住率：营业日 d 统计该晚在住子单数（ci <= d && co > d）
  const stayUnits = q(
    `SELECT COALESCE(r.actual_check_in, r.check_in_date) AS in_at,
            COALESCE(rr.actual_check_out, r.check_out_date) AS out_at
     FROM reservation_rooms rr JOIN reservations r ON r.id=rr.reservation_id
     WHERE rr.status IN ('checked_in','checked_out')`
  ).map((u) => ({ ci: String(u.in_at).slice(0, 10), co: String(u.out_at).slice(0, 10) }));
  let nightsSold = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    let occ = 0;
    for (const u of stayUnits) if (u.ci <= d && u.co > d) occ += 1;
    nightsSold += occ;
  }
  const days = Math.max(1, nightsBetween(start, end) + 1);
  const totalRooms = get('SELECT COUNT(*) AS c FROM rooms').c || 1;
  const availableNights = totalRooms * days;
  const occupancy = availableNights > 0 ? (nightsSold / availableNights * 100) : 0;
  const adr = nightsSold > 0 ? roomRevenue / nightsSold : 0;
  const revpar = availableNights > 0 ? roomRevenue / availableNights : 0;

  const daily = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const x = byDate[d] || { room: 0, extra: 0, payment: 0, refund: 0 };
    daily.push({ date: d, room: round2(x.room), extra: round2(x.extra), payment: round2(x.payment), refund: round2(x.refund) });
  }

  res.json({
    start, end,
    room_revenue: round2(roomRevenue),
    extra_revenue: round2(extraRevenue),
    adj_total: round2(adjTotal),
    charge_total: round2(roomRevenue + extraRevenue),
    payment_total: round2(paymentTotal),
    refund_total: round2(refundTotal),
    net_receipt: round2(paymentTotal - refundTotal),
    city_ledger_total: round2(cityLedgerTotal),
    ar_receipt_total: round2(arReceiptTotal),
    deposit_in: round2(depositIn),
    deposit_out: round2(depositOut),
    deposit_balance: round2(depositIn - depositOut),
    nights_sold: nightsSold,
    occupancy_rate: Math.round(occupancy * 10) / 10,
    adr: Math.round(adr * 100) / 100,
    revpar: Math.round(revpar * 100) / 100,
    chargeByCategory: Object.entries(chargeByCategory).map(([category, amount]) => ({ category, amount: round2(amount) })),
    paymentByMethod: Object.entries(paymentByMethod).map(([method, amount]) => ({ method, amount: round2(amount) })),
    daily,
  });
}));

module.exports = router;
