// 客账逐笔结账：消费/收款按笔配对核销（folio_allocations），挂账按笔转入 AR
// 口径：
//   结账只决定「哪笔钱对哪笔消费」，不改变金额与余额（余额仍由 amount 求和得出）
//   挂 AR 不产生收款行，改由消费行的消费侧分配承载 —— 该部分不再计入客人应收
//   已挂 AR 的消费在客账内不可再操作（不可配对、不可冲销、不可撤销）
const { run, get, q } = require('./db');
const { withTx } = require('./tx');
const { round2, now } = require('./utils');
const { AppError } = require('./errors');
const { currentBusinessDate } = require('./accounting');
const { createArEntryTx } = require('./ar');

const EPS_C = 1; // 0.01 元（厘位容差）
const cents = (n) => Math.round((Number(n) || 0) * 100);
const yuan = (c) => round2(c / 100);

// 可参与手工配对的侧别：charge=消费侧，payment=收款侧，null=不参与
//   押金（deposit）、备注（info）、退款/找零（payment 正数）不参与
//   退房时自动生成的「押金抵扣」是 payment 负数且 method='押金'，参与
//   挂账（method='挂账'）为历史遗留收款行，不参与手工配对
function settleSide(item) {
  const amt = Number(item.amount) || 0;
  if (Math.abs(amt) < 0.005) return null;
  const t = item.item_type;
  if (t === 'info' || t === 'deposit') return null;
  if (t === 'payment') {
    if (item.method === '挂账') return null;
    return amt < 0 ? 'payment' : null;
  }
  if (t === 'adj') return amt > 0 ? 'charge' : 'payment';
  if (t === 'room_charge' || t === 'extra_charge') return amt > 0 ? 'charge' : null;
  return null;
}

// 状态：整笔由挂账结清 -> 挂AR（客账内锁定）；其余按已结比例
function statusOf(capC, allocC, arAllocC) {
  const full = allocC >= capC - EPS_C;
  if (full && arAllocC > 0) return 'ar';
  if (allocC < EPS_C) return 'open';
  if (full) return 'settled';
  return 'partial';
}

// 某订单全部明细的结账态：{ item, side, capC, allocC, remainingC, arAllocC, status, locked }
function itemStates(reservationId) {
  const items = q('SELECT * FROM folio_items WHERE reservation_id=? ORDER BY id', reservationId);
  const allocs = q(
    `SELECT al.item_id, COALESCE(SUM(al.amount),0) AS allocated,
            COALESCE(SUM(CASE WHEN st.kind='ar' THEN al.amount ELSE 0 END),0) AS ar_alloc
     FROM folio_allocations al JOIN folio_settlements st ON st.id=al.settlement_id
     WHERE al.item_id IN (SELECT id FROM folio_items WHERE reservation_id=?)
     GROUP BY al.item_id`,
    reservationId
  );
  const byItem = new Map(allocs.map((a) => [a.item_id, a]));
  return items.map((item) => {
    const a = byItem.get(item.id) || { allocated: 0, ar_alloc: 0 };
    const capC = cents(Math.abs(Number(item.amount)));
    const allocC = cents(a.allocated);
    const arAllocC = cents(a.ar_alloc);
    const remainingC = Math.max(0, capC - allocC);
    return {
      item,
      side: settleSide(item),
      capC, allocC, arAllocC,
      remainingC,
      status: statusOf(capC, allocC, arAllocC),
      // 整笔已由挂账结清：客账内不可再操作；仍有未结余量的（部分挂账）仍可继续结账
      locked: arAllocC > 0 && remainingC <= EPS_C,
    };
  });
}

// 回写 settle_status 冗余列
function refreshStatuses(reservationId) {
  for (const s of itemStates(reservationId)) {
    if (s.item.settle_status !== s.status) {
      run('UPDATE folio_items SET settle_status=? WHERE id=?', s.status, s.item.id);
    }
  }
}

// 未结消费合计（退房闸门 / 前端提示）：只统计消费侧未结部分
function unsettledCharges(reservationId) {
  const states = itemStates(reservationId).filter((s) => s.side === 'charge' && s.remainingC > 0);
  return {
    total: yuan(states.reduce((n, s) => n + s.remainingC, 0)),
    count: states.length,
    items: states.map((s) => ({ id: s.item.id, description: s.item.description, remaining: yuan(s.remainingC) })),
  };
}

function newSettlement(reservationId, kind, { arAccountId = null, cityLedgerId = null, amount = 0, remark = '' } = {}) {
  return Number(run(
    `INSERT INTO folio_settlements (reservation_id, kind, ar_account_id, city_ledger_id, amount, remark, business_date)
     VALUES (?,?,?,?,?,?,?)`,
    reservationId, kind, arAccountId, cityLedgerId, amount, remark, currentBusinessDate()
  ).lastInsertRowid);
}

function allocate(settlementId, itemId, side, amountC) {
  run(
    'INSERT INTO folio_allocations (settlement_id, item_id, side, amount) VALUES (?,?,?,?)',
    settlementId, itemId, side, yuan(amountC)
  );
}

// 瀑布分配：收款池依次冲抵各消费的未结额；直接扣减入参 state 的 remainingC（便于分轮分配）
function waterfall(settlementId, charges, payments) {
  let moved = 0;
  for (const c of charges) {
    if (c.remainingC <= 0) continue;
    for (const p of payments) {
      if (c.remainingC <= 0) break;
      if (p.remainingC <= 0) continue;
      const take = Math.min(c.remainingC, p.remainingC);
      if (take <= 0) continue;
      allocate(settlementId, c.item.id, 'charge', take);
      allocate(settlementId, p.item.id, 'payment', take);
      c.remainingC -= take;
      p.remainingC -= take;
      moved += take;
    }
  }
  return moved;
}

// 挂账金额冲抵消费：只有消费侧分配（无收款行）
function arAllocate(settlementId, charges, amountC) {
  let left = amountC;
  let moved = 0;
  for (const c of charges) {
    if (left <= 0) break;
    if (c.remainingC <= 0) continue;
    const take = Math.min(c.remainingC, left);
    if (take <= 0) continue;
    allocate(settlementId, c.item.id, 'charge', take);
    c.remainingC -= take;
    left -= take;
    moved += take;
  }
  return moved;
}

// 从结账态列表里挑出指定 id 的行并校验
function pick(states, ids, side, label) {
  const set = new Set((ids || []).map(Number));
  const out = states.filter((s) => set.has(s.item.id));
  if (out.length !== set.size) throw new AppError(`所选${label}不属于该订单`);
  for (const s of out) {
    if (s.locked) throw new AppError(`所选${label}已挂 AR，不能在客账中操作`);
    if (s.side !== side) throw new AppError(`所选${label}中有不可参与结账的明细`);
    if (s.remainingC <= 0) throw new AppError(`所选${label}已结清`);
  }
  if (!out.length) throw new AppError(`请先勾选${label}`);
  return out;
}

// 手工结账：勾选的消费与收款两侧合计必须相等
function settleTx({ reservationId, chargeIds, paymentIds, remark = '' }) {
  const r = get('SELECT * FROM reservations WHERE id=?', reservationId);
  if (!r) throw new AppError('订单不存在', 404);
  return withTx(() => {
    const states = itemStates(reservationId);
    const charges = pick(states, chargeIds, 'charge', '消费');
    const payments = pick(states, paymentIds, 'payment', '收款');
    const chargeC = charges.reduce((n, s) => n + s.remainingC, 0);
    const payC = payments.reduce((n, s) => n + s.remainingC, 0);
    if (chargeC !== payC) {
      throw new AppError(`所选消费 ¥${yuan(chargeC).toFixed(2)} 与收款 ¥${yuan(payC).toFixed(2)} 金额不相等，无法结账`);
    }
    const sid = newSettlement(reservationId, 'settle', { amount: yuan(chargeC), remark });
    waterfall(sid, charges, payments);
    refreshStatuses(reservationId);
    return { ok: true, settlement_id: sid, amount: yuan(chargeC), items: charges.length + payments.length };
  });
}

// 按笔挂账到 AR：金额 = 所选消费未结额合计；只生成应收台账 + 消费侧分配，不产生收款行
function postToArTx({ reservationId, chargeIds, arAccountId, remark = '' }) {
  const r = get('SELECT * FROM reservations WHERE id=?', reservationId);
  if (!r) throw new AppError('订单不存在', 404);
  if (['cancelled', 'no_show', 'checked_out'].includes(r.status)) throw new AppError('该订单已结束，不可再挂账');
  return withTx(() => {
    const states = itemStates(reservationId);
    const charges = pick(states, chargeIds, 'charge', '消费');
    const amountC = charges.reduce((n, s) => n + s.remainingC, 0);
    if (amountC <= 0) throw new AppError('挂账金额必须大于 0');
    const out = createArEntryTx({
      reservationId, guestId: r.guest_id, guestName: r.guest_name,
      arAccountId, amount: yuan(amountC), remark,
    });
    const sid = newSettlement(reservationId, 'ar', {
      arAccountId: out.ar_account_id, cityLedgerId: out.entry_id, amount: yuan(amountC), remark,
    });
    arAllocate(sid, charges, amountC);
    refreshStatuses(reservationId);
    return { ...out, settlement_id: sid, charge_count: charges.length };
  });
}

// 撤销结账：仅限手工结账批次；挂账批次须在 AR 账户中处理（转账等）
function revokeSettlementTx(settlementId) {
  const s = get('SELECT * FROM folio_settlements WHERE id=?', settlementId);
  if (!s) throw new AppError('结账批次不存在', 404);
  if (s.revoked_at) throw new AppError('该批次已撤销');
  if (s.kind === 'ar') throw new AppError('挂账批次不能撤销，请在「AR 账户」中处理（可转账到其他账户）');
  return withTx(() => {
    run('DELETE FROM folio_allocations WHERE settlement_id=?', s.id);
    run('UPDATE folio_settlements SET revoked_at=? WHERE id=?', now(), s.id);
    refreshStatuses(s.reservation_id);
    return { ok: true, reservation_id: s.reservation_id, kind: s.kind };
  });
}

// 退房自动整单结账：① 押金抵扣/现金等收款冲抵 ② 本单未关联批次的应收台账冲抵剩余（转「挂AR」）
function autoSettleTx(reservationId) {
  return withTx(() => {
    const states = itemStates(reservationId);
    const charges = states.filter((s) => s.side === 'charge' && s.remainingC > 0);
    const cashPays = states.filter((s) => s.side === 'payment' && s.remainingC > 0);
    let moved = 0;
    if (cashPays.length) {
      const sid = newSettlement(reservationId, 'settle', { amount: 0, remark: '退房自动结账' });
      const m = waterfall(sid, charges, cashPays);
      if (m > 0) { run('UPDATE folio_settlements SET amount=? WHERE id=?', yuan(m), sid); moved += m; }
      else run('DELETE FROM folio_settlements WHERE id=?', sid);
    }
    // 退房结算时生成的挂账台账（尚未关联结账批次）冲抵剩余消费
    const entries = q(
      `SELECT * FROM city_ledger cl
       WHERE cl.reservation_id=? AND cl.amount - cl.settled_amount > 0.005
         AND NOT EXISTS (SELECT 1 FROM folio_settlements s WHERE s.city_ledger_id=cl.id AND s.revoked_at IS NULL)`,
      reservationId
    );
    for (const e of entries) {
      const sid = newSettlement(reservationId, 'ar', {
        arAccountId: e.ar_account_id, cityLedgerId: e.id, amount: 0, remark: '退房自动结账',
      });
      const m = arAllocate(sid, charges, cents(e.amount - e.settled_amount));
      if (m > 0) { run('UPDATE folio_settlements SET amount=? WHERE id=?', yuan(m), sid); moved += m; }
      else run('DELETE FROM folio_settlements WHERE id=?', sid);
    }
    refreshStatuses(reservationId);
    return { moved: yuan(moved), unsettled: unsettledCharges(reservationId) };
  });
}

module.exports = {
  settleSide, statusOf, itemStates, refreshStatuses, unsettledCharges,
  settleTx, postToArTx, revokeSettlementTx, autoSettleTx,
};
