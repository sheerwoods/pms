// AR 应收账款账户：挂账事务 / 回款核销（FIFO 或单笔）/ 校验
const { run, get, q } = require('./db');
const { withTx } = require('./tx');
const { round2, now } = require('./utils');
const { AppError } = require('./errors');
const { currentBusinessDate } = require('./accounting');

const cents = (n) => Math.round((Number(n) || 0) * 100);
const yuan = (c) => round2(c / 100);

function genAccountCode(id) {
  return `AR${String(id).padStart(4, '0')}`;
}

function getAccount(id) {
  return get('SELECT * FROM ar_accounts WHERE id=?', id);
}

// 挂账前校验：账户必须存在且启用
function requireActiveAccount(id) {
  const a = getAccount(id);
  if (!a) throw new AppError('AR 账户不存在', 404);
  if (a.status !== 'active') throw new AppError(`AR 账户「${a.name}」已停用，不可挂账`);
  return a;
}

// 账户合计：总量 / 已核销 / 未结
function accountTotals(arAccountId) {
  const r = get(
    `SELECT COALESCE(SUM(amount),0) AS total,
            COALESCE(SUM(settled_amount),0) AS settled,
            COALESCE(SUM(CASE WHEN status='open' THEN amount-settled_amount ELSE 0 END),0) AS outstanding
     FROM city_ledger WHERE ar_account_id=?`,
    arAccountId
  );
  return { total: round2(r.total), settled: round2(r.settled), outstanding: round2(r.outstanding) };
}

// 挂账到 AR 账户：只生成应收明细，不产生客账收款行
// 客账侧由「消费行挂 AR」承载（folio_allocations 消费侧分配），应收余额相应减少
function createArEntryTx({ reservationId, guestId, guestName, arAccountId, amount, remark = '' }) {
  const acct = requireActiveAccount(arAccountId);
  const amt = round2(amount);
  if (!(amt > 0)) throw new AppError('挂账金额必须大于 0');
  const bd = currentBusinessDate();
  return withTx(() => {
    const entryId = Number(run(
      `INSERT INTO city_ledger
         (reservation_id, guest_id, guest_name, company, amount, business_date, ar_account_id, remark)
       VALUES (?,?,?,?,?,?,?,?)`,
      reservationId, guestId, guestName || '', acct.name, amt, bd, acct.id, remark
    ).lastInsertRowid);
    return { entry_id: entryId, ar_account_id: acct.id, amount: amt, account_name: acct.name };
  });
}

// 回款/核销：entryId=单笔明细；entryIds=指定多笔（同额配对）；否则按营业日 FIFO 冲销最早未结明细
// exact=true 时要求回款金额与所选明细未结合计完全相等
function applyReceiptTx({ arAccountId, amount, method = '', remark = '', entryId = null, entryIds = null, exact = false }) {
  const acct = getAccount(arAccountId);
  if (!acct) throw new AppError('AR 账户不存在', 404);
  const amtC = cents(amount);
  if (amtC <= 0) throw new AppError('回款金额必须大于 0');

  let entries;
  if (entryId) {
    const e = get('SELECT * FROM city_ledger WHERE id=? AND ar_account_id=?', entryId, arAccountId);
    if (!e) throw new AppError('应收明细不存在或不属于该账户', 404);
    if (cents(e.settled_amount) >= cents(e.amount)) throw new AppError('该明细已结清');
    entries = [e];
  } else if (entryIds && entryIds.length) {
    const ids = [...new Set(entryIds.map(Number))];
    entries = q(
      `SELECT * FROM city_ledger WHERE ar_account_id=? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY business_date ASC, id ASC`,
      arAccountId, ...ids
    );
    if (entries.length !== ids.length) throw new AppError('所选应收明细不存在或不属于该账户', 404);
    const done = entries.find((e) => cents(e.settled_amount) >= cents(e.amount));
    if (done) throw new AppError(`所选明细（${done.remark || '#' + done.id}）已结清`);
  } else {
    entries = q(
      "SELECT * FROM city_ledger WHERE ar_account_id=? AND status='open' AND amount-settled_amount > 0.005 ORDER BY business_date ASC, id ASC",
      arAccountId
    );
  }
  const openC = entries.reduce((s, e) => s + (cents(e.amount) - cents(e.settled_amount)), 0);
  if (openC <= 0) throw new AppError('该账户暂无未结应收');
  if (amtC > openC) {
    throw new AppError(`回款金额 ¥${yuan(amtC).toFixed(2)} 超过未结合计 ¥${yuan(openC).toFixed(2)}`);
  }
  if (exact && amtC !== openC) {
    throw new AppError(`所选明细未结合计 ¥${yuan(openC).toFixed(2)}，与付款金额 ¥${yuan(amtC).toFixed(2)} 不相等`);
  }

  const bd = currentBusinessDate();
  return withTx(() => {
    const receiptId = Number(run(
      'INSERT INTO ar_receipts (ar_account_id, amount, method, remark, business_date) VALUES (?,?,?,?,?)',
      arAccountId, yuan(amtC), method, remark, bd
    ).lastInsertRowid);

    let left = amtC;
    for (const e of entries) {
      if (left <= 0) break;
      const remain = cents(e.amount) - cents(e.settled_amount);
      const take = Math.min(remain, left);
      if (take <= 0) continue;
      const newSettled = cents(e.settled_amount) + take;
      const status = newSettled >= cents(e.amount) ? 'settled' : 'open';
      run(
        'UPDATE city_ledger SET settled_amount=?, status=?, settled_at=?, settled_method=? WHERE id=?',
        yuan(newSettled), status, now(), method, e.id
      );
      run('INSERT INTO ar_allocations (receipt_id, entry_id, amount) VALUES (?,?,?)', receiptId, e.id, yuan(take));
      left -= take;
    }
    if (left !== 0) throw new AppError('回款核销未能完全分配');
    return { ok: true, receipt_id: receiptId, allocated: yuan(amtC - left) };
  });
}

// 过度挂账护栏：某订单挂账总额不得超过其消费总额（防止降价/早退后重复退款）
function assertNoOverAr(reservationId) {
  const ar = get('SELECT COALESCE(SUM(amount),0) AS s FROM city_ledger WHERE reservation_id=?', reservationId).s || 0;
  const charges = get(
    "SELECT COALESCE(SUM(amount),0) AS s FROM folio_items WHERE reservation_id=? AND item_type IN ('room_charge','extra_charge','adj')",
    reservationId
  ).s || 0;
  if (cents(ar) > cents(charges)) {
    throw new AppError(
      `该订单挂账 ¥${round2(ar).toFixed(2)} 超过消费 ¥${round2(charges).toFixed(2)}，请先在「应收账款」冲销多挂部分再退房`
    );
  }
}

module.exports = {
  genAccountCode, getAccount, requireActiveAccount, accountTotals,
  createArEntryTx, applyReceiptTx, assertNoOverAr,
};
