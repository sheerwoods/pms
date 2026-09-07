// 客账（folio）相关业务函数
const { run, get, q } = require('./db');

function addFolioItem({ reservationId, guestId = null, itemType, category = '', description = '', amount = 0, method = '' }) {
  return Number(run(
    'INSERT INTO folio_items (reservation_id, guest_id, item_type, category, description, amount, method) VALUES (?,?,?,?,?,?,?)',
    reservationId, guestId, itemType, category, description, amount, method
  ).lastInsertRowid);
}

function getBalance(reservationId) {
  const r = get('SELECT COALESCE(SUM(amount),0) AS bal FROM folio_items WHERE reservation_id=?', reservationId);
  return Math.round((r.bal || 0) * 100) / 100;
}

function getFolio(reservationId) {
  return q('SELECT * FROM folio_items WHERE reservation_id=? ORDER BY id', reservationId);
}

// 确保房费明细与 units 一致（多退少补）；units = [{date, amount}]（每个房型×每晚×每间一条）
function syncRoomCharges(reservationId, guestId, units) {
  const existing = getFolio(reservationId).filter((i) => i.item_type === 'room_charge');
  const currentTotal = existing.reduce((s, i) => s + i.amount, 0);
  const targetTotal = Math.round(units.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  if (existing.length === units.length && Math.abs(currentTotal - targetTotal) < 0.005) return;

  for (const i of existing) run('DELETE FROM folio_items WHERE id=?', i.id);
  for (const u of units) {
    addFolioItem({
      reservationId,
      guestId,
      itemType: 'room_charge',
      category: '房费',
      description: `房费(${u.date})`,
      amount: u.amount,
    });
  }
}

module.exports = { addFolioItem, getBalance, getFolio, syncRoomCharges };
