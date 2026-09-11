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

// 可用房（未维修、无未结束订单）——兼容旧的 reservation.room_id 与新 reservation_rooms
router.get('/rooms/available', wrap((req, res) => {
  const rooms = q(`SELECT r.*, t.name AS type_name FROM rooms r
                   LEFT JOIN room_types t ON t.id=r.type_id
                   WHERE r.status != 'ooo' ORDER BY r.floor, r.room_no`);
  const taken = q(`SELECT DISTINCT room_id FROM reservations WHERE status IN ('reserved','checked_in') AND room_id IS NOT NULL`);
  const taken2 = q(`SELECT DISTINCT rr.room_id FROM reservation_rooms rr
                    JOIN reservations r ON r.id=rr.reservation_id
                    WHERE r.status IN ('reserved','checked_in') AND rr.room_id IS NOT NULL`);
  const takenSet = new Set([...taken, ...taken2].map((x) => x.room_id));
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
  const active2 = get("SELECT COUNT(*) AS c FROM reservation_rooms rr JOIN reservations r ON r.id=rr.reservation_id WHERE rr.room_id=? AND r.status IN ('reserved','checked_in')", req.params.id);
  if (active.c > 0 || active2.c > 0) throw new AppError('该房间存在未结束的订单，无法删除');
  run('DELETE FROM rooms WHERE id=?', req.params.id);
  res.json({ ok: true });
}));

// 客房状态：clean / dirty / ooo（维修，可带备注）/ locked（锁房，仅空房且须填原因）
router.put('/rooms/:id/status', wrap((req, res) => {
  const { status, remark } = req.body;
  if (!['clean', 'dirty', 'ooo', 'locked'].includes(status)) throw new AppError('无效的客房状态');
  const room = get('SELECT * FROM rooms WHERE id=?', req.params.id);
  if (!room) throw new AppError('房间不存在', 404);
  if (status === 'locked') {
    // 仅空房可锁：该房不得存在在住/预抵占用
    const busy = get(
      `SELECT 1 FROM reservation_rooms rr JOIN reservations r ON r.id=rr.reservation_id
       WHERE rr.room_id=? AND rr.status IN ('pending','checked_in')
         AND r.status NOT IN ('cancelled','no_show','checked_out') LIMIT 1`,
      room.id
    ) || get(
      `SELECT 1 FROM reservations WHERE room_id=? AND status IN ('reserved','checked_in')
         AND NOT EXISTS (SELECT 1 FROM reservation_rooms rr WHERE rr.reservation_id=reservations.id) LIMIT 1`,
      room.id
    );
    if (busy) throw new AppError('仅空房可锁房');
    if (!String(remark || '').trim()) throw new AppError('请填写锁房原因');
  }
  if (remark != null) run('UPDATE rooms SET status=?, remark=? WHERE id=?', status, String(remark), room.id);
  else run('UPDATE rooms SET status=? WHERE id=?', status, room.id);
  res.json({ ok: true });
}));

// ============ 房态图 ============
router.get('/room-status', wrap((req, res) => {
  const date = req.query.date || today();
  const rooms = q(`SELECT r.*, t.name AS type_name, t.base_price AS type_price
                   FROM rooms r LEFT JOIN room_types t ON t.id=r.type_id
                   ORDER BY r.floor, r.room_no`);
  // 按每间状态驱动（分批入住）：rr.status=checked_in → 占；pending 且已分配房 → 预抵
  // 终态父单（已取消/未到/已退）不出现在房态图上
  // unit_guest_name / unit_cohabitors：该间实际入住人与同住人，供房态方块显示入住人
  const inHouse = q(
    `SELECT r.*, rr.room_id AS assigned_room_id, rr.id AS unit_id, rr.status AS unit_status,
            rr.guest_name AS unit_guest_name, rr.cohabitors AS unit_cohabitors,
            rr.check_out_date AS unit_check_out_date
     FROM reservations r
     JOIN reservation_rooms rr ON rr.reservation_id=r.id
     WHERE rr.status='checked_in' AND rr.room_id IS NOT NULL AND r.status NOT IN ('cancelled','no_show','checked_out')`
  );
  const expected = q(
    `SELECT r.*, rr.room_id AS assigned_room_id, rr.id AS unit_id, rr.status AS unit_status,
            rr.guest_name AS unit_guest_name, rr.cohabitors AS unit_cohabitors
     FROM reservations r
     JOIN reservation_rooms rr ON rr.reservation_id=r.id
     WHERE rr.status='pending' AND rr.room_id IS NOT NULL AND r.check_in_date <= ? AND r.check_out_date > ?
       AND r.status NOT IN ('cancelled','no_show','checked_out')`,
    date, date
  );
  // 兼容旧的、无子行的预订（按 reservations.status + room_id 回退）
  const legacyIn = q(
    `SELECT r.*, r.room_id AS assigned_room_id FROM reservations r
     WHERE r.status='checked_in' AND r.room_id IS NOT NULL AND r.id NOT IN (SELECT DISTINCT reservation_id FROM reservation_rooms)`
  );
  const legacyExp = q(
    `SELECT r.*, r.room_id AS assigned_room_id FROM reservations r
     WHERE r.status='reserved' AND r.room_id IS NOT NULL AND r.check_in_date <= ? AND r.check_out_date > ? AND r.id NOT IN (SELECT DISTINCT reservation_id FROM reservation_rooms)`,
    date, date
  );

  // 父单的子单统计（供前端按派生状态判断，不再依赖父 status 猜占用）
  const allIds = [...new Set([...inHouse, ...expected, ...legacyIn, ...legacyExp].map((x) => x.id))];
  const countMap = {};
  if (allIds.length) {
    const ph = allIds.map(() => '?').join(',');
    for (const c of q(
      `SELECT reservation_id,
              COALESCE(SUM(CASE WHEN status='checked_in' THEN 1 ELSE 0 END),0) AS cin,
              COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) AS pend
       FROM reservation_rooms WHERE reservation_id IN (${ph}) GROUP BY reservation_id`,
      ...allIds
    )) countMap[c.reservation_id] = { cin: c.cin, pend: c.pend };
  }
  const decorate = (x, fallback) => {
    const c = countMap[x.id] || fallback;
    x.checked_in_units = c.cin;
    x.pending_units = c.pend;
    x.has_checked_in = c.cin > 0;
    x.unit_status = x.unit_status || (fallback.cin > 0 ? 'checked_in' : 'pending');
    return x;
  };

  const byRoomIn = {};
  const byRoomExp = {};
  [...inHouse.map((x) => decorate(x, { cin: 1, pend: 0 })), ...legacyIn.map((x) => decorate(x, { cin: 1, pend: 0 }))]
    .forEach((x) => { const room = x.assigned_room_id || x.room_id; if (room) byRoomIn[room] = x; });
  [...expected.map((x) => decorate(x, { cin: 0, pend: 1 })), ...legacyExp.map((x) => decorate(x, { cin: 0, pend: 1 }))]
    .forEach((x) => { const room = x.assigned_room_id || x.room_id; if (room) byRoomExp[room] = x; });

  const result = rooms.map((room) => {
    const item = { room, eff_status: '', reservation: null, balance: null };
    if (room.status === 'ooo') {
      item.eff_status = 'ooo';
    } else if (room.status === 'locked') {
      item.eff_status = 'locked';
    } else if (byRoomIn[room.id]) {
      const stay = byRoomIn[room.id];
      item.reservation = stay;
      item.balance = getBalance(stay.id);
      const stayOut = stay.unit_check_out_date || stay.check_out_date;
      item.eff_status = stayOut === date ? 'due_out' : (room.status === 'clean' ? 'occupied_clean' : 'occupied_dirty');
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
