// 房型 / 房间 / 房态图
const express = require('express');
const { q, get, run } = require('../db');
const { AppError, wrap } = require('../errors');
const { getBalance } = require('../folio');
const { today } = require('../utils');

const router = express.Router();

// ============ 房型 ============
router.get('/room-types', wrap((req, res) => {
  res.json(q('SELECT * FROM room_types ORDER BY id'));
}));

router.post('/room-types', wrap((req, res) => {
  const { name, base_price = 0, remark = '' } = req.body;
  if (!name) throw new AppError('房型名称必填');
  const r = run('INSERT INTO room_types (name, base_price, remark) VALUES (?,?,?)', name, base_price, remark);
  res.json({ id: Number(r.lastInsertRowid) });
}));

router.put('/room-types/:id', wrap((req, res) => {
  const { name, base_price, remark } = req.body;
  if (!name) throw new AppError('房型名称必填');
  run('UPDATE room_types SET name=?, base_price=?, remark=? WHERE id=?', name, base_price ?? 0, remark ?? '', req.params.id);
  res.json({ ok: true });
}));

router.delete('/room-types/:id', wrap((req, res) => {
  const used = get('SELECT COUNT(*) AS c FROM rooms WHERE type_id=?', req.params.id);
  if (used.c > 0) throw new AppError('该房型下仍有房间，无法删除');
  run('DELETE FROM room_types WHERE id=?', req.params.id);
  res.json({ ok: true });
}));

// ============ 房间 ============
router.get('/rooms', wrap((req, res) => {
  res.json(q(`SELECT r.*, t.name AS type_name, t.base_price AS type_price
              FROM rooms r LEFT JOIN room_types t ON t.id=r.type_id
              ORDER BY r.floor, r.room_no`));
}));

// 可用房（未维修、无未结束订单）
router.get('/rooms/available', wrap((req, res) => {
  const rooms = q(`SELECT r.*, t.name AS type_name FROM rooms r
                   LEFT JOIN room_types t ON t.id=r.type_id
                   WHERE r.status != 'ooo' ORDER BY r.floor, r.room_no`);
  const taken = q(`SELECT DISTINCT room_id FROM reservations WHERE status IN ('reserved','checked_in') AND room_id IS NOT NULL`);
  const takenSet = new Set(taken.map((x) => x.room_id));
  res.json(rooms.filter((x) => !takenSet.has(x.id)));
}));

router.post('/rooms', wrap((req, res) => {
  const { room_no, floor = 1, type_id, status = 'clean', remark = '' } = req.body;
  if (!room_no) throw new AppError('房间号必填');
  if (get('SELECT id FROM rooms WHERE room_no=?', room_no)) throw new AppError('房间号已存在');
  const r = run('INSERT INTO rooms (room_no, floor, type_id, status, remark) VALUES (?,?,?,?,?)', room_no, floor, type_id, status, remark);
  res.json({ id: Number(r.lastInsertRowid) });
}));

router.put('/rooms/:id', wrap((req, res) => {
  const { room_no, floor, type_id, status, remark } = req.body;
  if (!room_no) throw new AppError('房间号必填');
  run('UPDATE rooms SET room_no=?, floor=?, type_id=?, status=?, remark=? WHERE id=?', room_no, floor, type_id, status ?? 'clean', remark ?? '', req.params.id);
  res.json({ ok: true });
}));

router.delete('/rooms/:id', wrap((req, res) => {
  const active = get("SELECT COUNT(*) AS c FROM reservations WHERE room_id=? AND status IN ('reserved','checked_in')", req.params.id);
  if (active.c > 0) throw new AppError('该房间存在未结束的订单，无法删除');
  run('DELETE FROM rooms WHERE id=?', req.params.id);
  res.json({ ok: true });
}));

// 客房状态：clean / dirty / ooo
router.put('/rooms/:id/status', wrap((req, res) => {
  const { status } = req.body;
  if (!['clean', 'dirty', 'ooo'].includes(status)) throw new AppError('无效的客房状态');
  run('UPDATE rooms SET status=? WHERE id=?', status, req.params.id);
  res.json({ ok: true });
}));

// ============ 房态图 ============
router.get('/room-status', wrap((req, res) => {
  const date = req.query.date || today();
  const rooms = q(`SELECT r.*, t.name AS type_name, t.base_price AS type_price
                   FROM rooms r LEFT JOIN room_types t ON t.id=r.type_id
                   ORDER BY r.floor, r.room_no`);
  const inHouse = q(`SELECT * FROM reservations WHERE status='checked_in' AND room_id IS NOT NULL`);
  const expected = q(`SELECT * FROM reservations WHERE status='reserved' AND room_id IS NOT NULL AND check_in_date <= ? AND check_out_date > ?`, date, date);

  const byRoomIn = {};
  const byRoomExp = {};
  inHouse.forEach((x) => (byRoomIn[x.room_id] = x));
  expected.forEach((x) => (byRoomExp[x.room_id] = x));

  const result = rooms.map((room) => {
    const item = { room, eff_status: '', reservation: null, balance: null };
    if (room.status === 'ooo') {
      item.eff_status = 'ooo';
    } else if (byRoomIn[room.id]) {
      const stay = byRoomIn[room.id];
      item.reservation = stay;
      item.balance = getBalance(stay.id);
      item.eff_status = stay.check_out_date === date ? 'due_out' : (room.status === 'clean' ? 'occupied_clean' : 'occupied_dirty');
    } else if (byRoomExp[room.id]) {
      item.reservation = byRoomExp[room.id];
      item.eff_status = 'expected';
    } else {
      item.eff_status = room.status === 'clean' ? 'vacant_clean' : 'vacant_dirty';
    }
    return item;
  });
  res.json({ date, rooms: result });
}));

module.exports = router;
