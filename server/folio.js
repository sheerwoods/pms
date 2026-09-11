// 客账（folio）相关业务函数
const { run, get, q } = require('./db');
const { withTx } = require('./tx');
const { AppError } = require('./errors');
const { addDays } = require('./utils');
const { getAuditTime, currentBusinessDate, businessDateOf } = require('./accounting');

// 金额正负：消费为正、收款为负。business_date 为营业日
function addFolioItem({
  reservationId, guestId = null, itemType, category = '', description = '',
  amount = 0, method = '', roomUnitId = null, createdAt = null, businessDate = null,
}) {
  const bd = businessDate || (createdAt ? businessDateOf(createdAt) : currentBusinessDate());
  if (createdAt) {
    return Number(run(
      'INSERT INTO folio_items (reservation_id, guest_id, item_type, category, description, amount, method, room_unit_id, business_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      reservationId, guestId, itemType, category, description, amount, method, roomUnitId, bd, createdAt
    ).lastInsertRowid);
  }
  return Number(run(
    'INSERT INTO folio_items (reservation_id, guest_id, item_type, category, description, amount, method, room_unit_id, business_date) VALUES (?,?,?,?,?,?,?,?,?)',
    reservationId, guestId, itemType, category, description, amount, method, roomUnitId, bd
  ).lastInsertRowid);
}

// 应收余额（欠款）：不含押金与备注
function getBalance(reservationId) {
  const r = get(
    "SELECT COALESCE(SUM(amount),0) AS bal FROM folio_items WHERE reservation_id=? AND item_type NOT IN ('deposit','info')",
    reservationId
  );
  return Math.round((r.bal || 0) * 100) / 100;
}

// 押金余额（收取为正、退还为负）
function getDepositBalance(reservationId) {
  const r = get(
    "SELECT COALESCE(SUM(amount),0) AS s FROM folio_items WHERE reservation_id=? AND item_type='deposit'",
    reservationId
  );
  return Math.round(-(r.s || 0) * 100) / 100;
}

function getFolio(reservationId) {
  return q('SELECT * FROM folio_items WHERE reservation_id=? ORDER BY id', reservationId);
}

// 确保房费明细与 units 一致（多退少补）；units = [{date, amount, roomUnitId}]（每个房型×每晚×每间一条）
// 房费营业日 = 该晚日期；命中同(日期,房间)的旧行时沿用其 created_at，避免改写历史流水时间
// 已参与逐笔结账的旧行按同键迁移分配；键消失（早退减夜）且已结账则拒绝，避免结账记录悬空
function syncRoomCharges(reservationId, guestId, units) {
  const existing = getFolio(reservationId).filter((i) => i.item_type === 'room_charge');
  // 目标签名：日期+金额+房间归属，避免金额/夜数一致但归属变化时被提前返回
  const sig = (u) => `${u.date}|${Math.round(u.amount * 100)}|${u.roomUnitId ?? ''}`;
  const currentSig = existing.map((i) => `${i.description.replace(/^房费\(|\)$/g, '')}|${Math.round(i.amount * 100)}|${i.room_unit_id ?? ''}`);
  const targetSig = units.map(sig);
  if (currentSig.length === targetSig.length && currentSig.join(',') === targetSig.join(',')) return;

  const auditTime = getAuditTime();
  const keyOf = (date, unitId) => `${date}|${unitId ?? ''}`;
  const oldByKey = {};
  for (const i of existing) {
    const d = String(i.description || '').replace(/^房费\(|\)$/g, '');
    oldByKey[keyOf(d, i.room_unit_id)] = i;
  }
  const targetKeys = new Set(units.map((u) => keyOf(u.date, u.roomUnitId)));

  withTx(() => {
    for (const [key, old] of Object.entries(oldByKey)) {
      if (targetKeys.has(key)) continue;
      const used = get('SELECT COUNT(*) AS c FROM folio_allocations WHERE item_id=?', old.id).c;
      if (used > 0) throw new AppError(`房费(${key.split('|')[0]})已参与结账/挂账，请先撤销结账后再调整房费`);
    }
    // 先插新行再迁移分配，最后删旧行（folio_allocations 外键指向明细，不能先删）
    const created = units.map((u) => ({
      old: oldByKey[keyOf(u.date, u.roomUnitId)],
      id: addFolioItem({
        reservationId,
        guestId,
        itemType: 'room_charge',
        category: '房费',
        description: `房费(${u.date})`,
        amount: u.amount,
        roomUnitId: u.roomUnitId ?? null,
        businessDate: u.date,                          // 第 N 晚 -> 营业日 N
        createdAt: (oldByKey[keyOf(u.date, u.roomUnitId)] || {}).created_at || `${addDays(u.date, 1)} ${auditTime}:00`,
      }),
    }));
    for (const c of created) {
      if (!c.old) continue;
      if (c.old.settle_status !== 'open') run('UPDATE folio_items SET settle_status=? WHERE id=?', c.old.settle_status, c.id);
      run('UPDATE folio_allocations SET item_id=? WHERE item_id=?', c.id, c.old.id);
    }
    for (const i of existing) run('DELETE FROM folio_items WHERE id=?', i.id);
  });
}

module.exports = { addFolioItem, getBalance, getDepositBalance, getFolio, syncRoomCharges };
