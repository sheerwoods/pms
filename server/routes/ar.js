// AR 应收账款账户：账户建档 / 挂账 / 回款核销
const express = require('express');
const { q, get, run } = require('../db');
const { withTx } = require('../tx');
const { AppError, wrap } = require('../errors');
const { round2 } = require('../utils');
const { getBalance } = require('../folio');
const {
  genAccountCode, getAccount, accountTotals, applyReceiptTx,
} = require('../ar');
const { postToArTx } = require('../settlement');

const router = express.Router();
const CL_BD = 'COALESCE(cl.business_date, date(cl.created_at))';

// ============ 账户列表 ============
router.get('/ar/accounts', wrap((req, res) => {
  const { status, keyword } = req.query;
  const conds = [];
  const params = [];
  if (status) { conds.push('a.status=?'); params.push(status); }
  if (keyword) {
    const k = `%${keyword}%`;
    conds.push('(a.name LIKE ? OR a.code LIKE ? OR a.contact LIKE ? OR a.phone LIKE ?)');
    params.push(k, k, k, k);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const list = q(
    `SELECT a.*,
            COALESCE(SUM(CASE WHEN cl.status='open' THEN cl.amount-cl.settled_amount ELSE 0 END),0) AS outstanding,
            COUNT(cl.id) AS entry_count
     FROM ar_accounts a
     LEFT JOIN city_ledger cl ON cl.ar_account_id=a.id
     ${where} GROUP BY a.id
     ORDER BY (a.status='active') DESC, a.id DESC`,
    ...params
  ).map((x) => ({ ...x, outstanding: round2(x.outstanding) }));
  const totalOutstanding = round2(list.filter((x) => x.status === 'active').reduce((s, x) => s + x.outstanding, 0));
  res.json({ list, totalOutstanding });
}));

// ============ 新建账户 ============
router.post('/ar/accounts', wrap((req, res) => {
  const { code = '', name, contact = '', phone = '', remark = '' } = req.body;
  const nm = String(name || '').trim();
  if (!nm) throw new AppError('账户名称必填');
  const custom = String(code || '').trim();
  let id;
  try {
    id = Number(run(
      'INSERT INTO ar_accounts (code, name, contact, phone, remark) VALUES (?,?,?,?,?)',
      custom || null, nm, contact, phone, remark
    ).lastInsertRowid);
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) throw new AppError('账户编号已存在');
    throw e;
  }
  if (!custom) run('UPDATE ar_accounts SET code=? WHERE id=?', genAccountCode(id), id);
  res.json({ ok: true, id, account: getAccount(id) });
}));

// ============ 编辑 / 停用启用 ============
router.put('/ar/accounts/:id', wrap((req, res) => {
  const a = getAccount(req.params.id);
  if (!a) throw new AppError('AR 账户不存在', 404);
  const { name, contact, phone, remark, status, code } = req.body;
  const nm = name === undefined ? a.name : String(name).trim();
  if (!nm) throw new AppError('账户名称必填');
  const st = status === undefined ? a.status : (status === 'disabled' ? 'disabled' : 'active');
  const cd = code === undefined ? a.code : (String(code).trim() || a.code);
  try {
    run(
      'UPDATE ar_accounts SET name=?, contact=?, phone=?, remark=?, status=?, code=? WHERE id=?',
      nm, contact ?? a.contact, phone ?? a.phone, remark ?? a.remark, st, cd, a.id
    );
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) throw new AppError('账户编号已存在');
    throw e;
  }
  res.json({ ok: true, account: getAccount(a.id) });
}));

// ============ 账户详情（明细 + 回款） ============
router.get('/ar/accounts/:id', wrap((req, res) => {
  const a = getAccount(req.params.id);
  if (!a) throw new AppError('AR 账户不存在', 404);
  const entries = q(
    `SELECT cl.*, ROUND(cl.amount-cl.settled_amount,2) AS outstanding, r.order_no, rm.room_no
     FROM city_ledger cl
     LEFT JOIN reservations r ON r.id=cl.reservation_id
     LEFT JOIN rooms rm ON rm.id=r.room_id
     WHERE cl.ar_account_id=? ORDER BY cl.business_date DESC, cl.id DESC`,
    a.id
  );
  const receipts = q('SELECT * FROM ar_receipts WHERE ar_account_id=? ORDER BY id DESC', a.id);
  const allocs = q(
    `SELECT al.*, cl.reservation_id, cl.business_date AS entry_bdate, r.order_no
     FROM ar_allocations al
     JOIN city_ledger cl ON cl.id=al.entry_id
     LEFT JOIN reservations r ON r.id=cl.reservation_id
     WHERE al.receipt_id IN (SELECT id FROM ar_receipts WHERE ar_account_id=?)
     ORDER BY al.receipt_id DESC, al.id`,
    a.id
  );
  const byReceipt = {};
  for (const x of allocs) (byReceipt[x.receipt_id] = byReceipt[x.receipt_id] || []).push(x);
  res.json({
    account: a,
    totals: accountTotals(a.id),
    entries,
    receipts: receipts.map((rp) => ({ ...rp, allocations: byReceipt[rp.id] || [] })),
  });
}));

// ============ 账户回款（FIFO 自动核销） ============
router.post('/ar/accounts/:id/receipt', wrap((req, res) => {
  const id = Number(req.params.id);
  const out = applyReceiptTx({ arAccountId: id, amount: req.body.amount, method: req.body.method || '', remark: req.body.remark || '' });
  res.json({ ...out, totals: accountTotals(id) });
}));

// ============ 应收明细（扁平） ============
router.get('/ar/entries', wrap((req, res) => {
  const { status, account_id, keyword, start, end } = req.query;
  const conds = [];
  const params = [];
  if (status) { conds.push('cl.status=?'); params.push(status); }
  if (account_id) { conds.push('cl.ar_account_id=?'); params.push(account_id); }
  if (start) { conds.push(`${CL_BD} >= ?`); params.push(start); }
  if (end) { conds.push(`${CL_BD} <= ?`); params.push(end); }
  if (keyword) {
    const k = `%${keyword}%`;
    conds.push('(a.name LIKE ? OR cl.guest_name LIKE ? OR r.order_no LIKE ?)');
    params.push(k, k, k);
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const list = q(
    `SELECT cl.*, ${CL_BD} AS bdate, ROUND(cl.amount-cl.settled_amount,2) AS outstanding,
            a.name AS account_name, a.code AS account_code, a.status AS account_status,
            r.order_no, rm.room_no
     FROM city_ledger cl
     LEFT JOIN ar_accounts a ON a.id=cl.ar_account_id
     LEFT JOIN reservations r ON r.id=cl.reservation_id
     LEFT JOIN rooms rm ON rm.id=r.room_id
     ${where} ORDER BY cl.id DESC`,
    ...params
  );
  const totalOpen = round2(list.filter((x) => x.status === 'open').reduce((s, x) => s + x.outstanding, 0));
  res.json({ list, totalOpen });
}));

// ============ 多笔明细核销（勾选同额配对，金额须等于所选未结合计） ============
router.post('/ar/entries/batch-settle', wrap((req, res) => {
  const ids = [...new Set((req.body.entry_ids || []).map(Number).filter(Boolean))];
  if (!ids.length) throw new AppError('请先勾选应收明细');
  const rows = q(`SELECT * FROM city_ledger WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  if (rows.length !== ids.length) throw new AppError('应收明细不存在', 404);
  const accounts = [...new Set(rows.map((x) => x.ar_account_id))];
  if (accounts.length !== 1 || !accounts[0]) throw new AppError('所选明细须属于同一 AR 账户');
  const out = applyReceiptTx({
    arAccountId: accounts[0], amount: req.body.amount,
    method: req.body.method || '', remark: req.body.remark || '',
    entryIds: ids, exact: true,
  });
  res.json({ ...out, totals: accountTotals(accounts[0]) });
}));

// ============ 单笔明细核销 ============
router.post('/ar/entries/:id/settle', wrap((req, res) => {
  const e = get('SELECT * FROM city_ledger WHERE id=?', req.params.id);
  if (!e) throw new AppError('应收明细不存在', 404);
  if (!e.ar_account_id) throw new AppError('该明细未归属 AR 账户');
  const out = applyReceiptTx({
    arAccountId: e.ar_account_id, amount: req.body.amount,
    method: req.body.method || '', remark: req.body.remark || '', entryId: e.id,
  });
  res.json({ ...out, entry: get('SELECT * FROM city_ledger WHERE id=?', e.id) });
}));

// ============ 删除明细（回滚误挂；已有核销需先冲销回款） ============
router.delete('/ar/entries/:id', wrap((req, res) => {
  const e = get('SELECT * FROM city_ledger WHERE id=?', req.params.id);
  if (!e) throw new AppError('应收明细不存在', 404);
  const fromFolio = get('SELECT * FROM folio_settlements WHERE city_ledger_id=? AND revoked_at IS NULL', e.id);
  if (fromFolio) throw new AppError('该应收由客账挂账生成，请在客账中「撤销结账」后再操作');
  const allocs = get('SELECT COUNT(*) AS c FROM ar_allocations WHERE entry_id=?', e.id).c;
  if (allocs > 0) throw new AppError('该应收已有回款核销，请先冲销回款');
  withTx(() => {
    run('DELETE FROM city_ledger WHERE id=?', e.id);
    if (e.folio_item_id) run('DELETE FROM folio_items WHERE id=?', e.folio_item_id);
  });
  res.json({ ok: true });
}));

// ============ 客账按笔挂账（金额 = 所选消费未结额合计） ============
router.post('/ar/charge', wrap((req, res) => {
  const { reservation_id, ar_account_id, charge_ids, remark = '' } = req.body;
  const r = get('SELECT * FROM reservations WHERE id=?', reservation_id);
  if (!r) throw new AppError('订单不存在', 404);
  const out = postToArTx({
    reservationId: r.id, chargeIds: charge_ids, arAccountId: ar_account_id, remark,
  });
  res.json({ ...out, balance: getBalance(r.id) });
}));

module.exports = router;
