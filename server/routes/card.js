// 门锁制卡 / 读卡
const express = require('express');
const { q, get, run } = require('../db');
const { AppError, wrap } = require('../errors');
const card = require('../card');

const router = express.Router();

function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
}

function asInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function clockNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function roomById(id) {
  const room = get('SELECT * FROM rooms WHERE id=?', id);
  if (!room) throw new AppError('房间不存在', 404);
  return room;
}

function findRoomByLockNo(lockNo) {
  if (!/^\d{7}$/.test(String(lockNo || ''))) return null;
  return q('SELECT * FROM rooms').find((r) => card.resolveLockNo(r) === String(lockNo)) || null;
}

// 该门锁房号当前对应的在住订单/单元
function findActiveStay(roomId) {
  if (!roomId) return null;
  return get(
    `SELECT rr.id AS unit_id, rr.guest_name, rr.check_out_date, r.id AS reservation_id, r.order_no,
            r.status AS reservation_status, r.guest_name AS reservation_guest
     FROM reservation_rooms rr JOIN reservations r ON r.id=rr.reservation_id
     WHERE rr.room_id=? AND rr.status='checked_in' AND r.status NOT IN ('cancelled','no_show','checked_out')
     ORDER BY rr.id DESC LIMIT 1`,
    roomId
  ) || null;
}

function validLockNo(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return '';
  if (!/^\d{7}$/.test(s)) throw new AppError('门锁房号必须为 7 位数字（楼号2+楼层2+房号2+副房1）');
  return s;
}

// ============ 配置 ============
router.get('/card/config', wrap(async (req, res) => {
  let version = '';
  let error = '';
  try {
    version = await card.toolVersion();
  } catch (e) {
    error = e.message;
  }
  res.json({
    enabled: card.cardEnabled(),
    port: card.cardPort(),
    sub: card.cardSub(),
    building: card.cardBuilding(),
    db_user: card.setting('card_db_user', ''),
    db_password_set: !!card.setting('card_db_password', ''),
    available: !!version,
    version,
    error,
  });
}));

router.put('/card/config', wrap((req, res) => {
  const { enabled, port, sub, building, db_user, db_password } = req.body;
  if (enabled !== undefined) setSetting('card_enabled', enabled ? '1' : '0');
  if (port !== undefined) {
    const p = asInt(port, 0);
    if (p < 0 || p > 99) throw new AppError('串口号需在 0~99 之间（0=不设置）');
    setSetting('card_port', p);
  }
  if (sub !== undefined) {
    const s = asInt(sub, -1);
    if (s < 0 || s > 9) throw new AppError('副房号需在 0~9 之间');
    setSetting('card_sub', s);
  }
  if (building !== undefined) {
    const b = String(building).trim();
    if (!/^\d{1,2}$/.test(b)) throw new AppError('楼号必须为 1~2 位数字');
    setSetting('card_building', b.padStart(2, '0'));
  }
  if (db_user !== undefined) setSetting('card_db_user', String(db_user || ''));
  if (db_password !== undefined) setSetting('card_db_password', String(db_password || ''));
  res.json({ ok: true });
}));

// ============ 房间门锁房号 ============
router.get('/card/rooms', wrap((req, res) => {
  const rows = q(`SELECT r.id, r.room_no, r.floor, r.lock_no, t.name AS type_name
                  FROM rooms r LEFT JOIN room_types t ON t.id=r.type_id
                  ORDER BY r.floor, r.room_no`);
  res.json(rows.map((r) => ({
    ...r,
    lock_no: String(r.lock_no || ''),
    auto_lock_no: card.autoLockNo(r),
  })));
}));

router.put('/card/rooms/:id', wrap((req, res) => {
  const room = roomById(req.params.id);
  const lockNo = validLockNo(req.body.lock_no);
  run('UPDATE rooms SET lock_no=? WHERE id=?', lockNo, room.id);
  res.json({ ok: true, lock_no: lockNo || card.autoLockNo(room) });
}));

// ============ 客人卡制卡 ============
router.post('/card/write-guest', wrap(async (req, res) => {
  const {
    reservation_id, unit_id, room_id, guest_name,
    card_type = 0, special_room_list = '', begin_time, end_time,
    ex_card_mess = '',
  } = req.body;
  const f1 = asInt(req.body.floor1);
  const f2 = asInt(req.body.floor2);
  const f3 = asInt(req.body.floor3);

  if (!reservation_id) throw new AppError('缺少订单');
  const r = get('SELECT * FROM reservations WHERE id=?', reservation_id);
  if (!r) throw new AppError('订单不存在', 404);

  const unit = unit_id
    ? get('SELECT * FROM reservation_rooms WHERE id=? AND reservation_id=?', unit_id, r.id)
    : null;
  const roomId = room_id || (unit && unit.room_id);
  if (!roomId) throw new AppError('请选择要制卡的房间');
  const room = roomById(roomId);
  const lockNo = card.resolveLockNo(room);

  const name = String(guest_name || (unit && unit.guest_name) || r.guest_name || '').trim();
  const begin = card.formatCardTime(begin_time || r.check_in_date, '1400');
  const rawEnd = end_time || (unit && unit.check_out_date) || r.check_out_date;
  const rawEndTime = card.formatCardTime(rawEnd, '1200');
  if (!begin || begin.length !== 10) throw new AppError('开始时间格式不正确');
  if (rawEnd && !rawEndTime) throw new AppError('结束时间格式不正确');
  // 结束须晚于开始（同日 / 0 间夜自动顺延一天），否则厂商返回 -1
  const { end } = card.ensureValidWindow(begin, rawEndTime);

  const special = String(special_room_list || '').replace(/\D/g, '').slice(0, 9);
  const guestCardType = asInt(card_type) === 1 ? 1 : 0;

  const logBase = {
    action: 'guest', reservation_id: r.id, room_id: room.id, room_no: room.room_no, lock_no: lockNo,
    card_type: 39, guest_name: name, begin_time: begin, end_time: end,
    special_room_list: special, floor1: f1, floor2: f2, floor3: f3,
  };

  const result = await card.invoke('writeGuestCard', [name, guestCardType, lockNo, special, begin, end, f1, f2, f3, String(ex_card_mess || '')]);
  const cardNo = result.data && result.data.cardNo != null ? asInt(result.data.cardNo) : null;
  if (!result.ok) {
    card.logCard({ ...logBase, card_no: null, result_code: result.code, result_msg: result.message });
    throw new AppError(result.message);
  }
  card.logCard({ ...logBase, card_no: cardNo, result_code: 0, result_msg: '成功' });

  res.json({
    ok: true, card_no: cardNo, lock_no: lockNo, room_no: room.room_no,
    guest_name: name, begin_time: begin, end_time: end, card_type: guestCardType,
  });
}));

// ============ 读卡 ============
router.post('/card/read', wrap(async (req, res) => {
  const result = await card.invoke('readCard', []);
  if (!result.ok) {
    res.json({ ok: false, code: result.code, message: result.message });
    return;
  }
  const d = result.data || {};
  const lockNo = d.roomNo || '';
  const cardType = asInt(d.cardType);
  const room = findRoomByLockNo(lockNo);
  const stay = room ? findActiveStay(room.id) : null;
  res.json({
    ok: true, code: 0,
    card: {
      card_type: cardType,
      card_type_text: card.CARD_TYPE_TEXT[cardType] || (cardType ? '未知卡类型' : ''),
      card_no: asInt(d.cardNo),
      batch: asInt(d.batch),
      lock_no: lockNo,
      room_no: room ? room.room_no : '',
      begin_time: d.begin || '',
      end_time: d.end || '',
      special_room_list: asInt(d.special),
      floor1: asInt(d.floor1),
      floor2: asInt(d.floor2),
      floor3: asInt(d.floor3),
      ex_card_mess: d.exCardMess || '',
    },
    room: room ? { id: room.id, room_no: room.room_no, floor: room.floor } : null,
    stay: stay || null,
  });
}));

// ============ 退房（销卡） ============
router.post('/card/checkout', wrap(async (req, res) => {
  const { room_id, card_no } = req.body;
  let result;
  let logBase;
  if (card_no != null && card_no !== '') {
    result = await card.invoke('checkout2', [asInt(card_no)]);
    logBase = { action: 'checkout2', card_no: asInt(card_no) };
  } else {
    if (!room_id) throw new AppError('请选择房间或输入卡号');
    const room = roomById(room_id);
    const lockNo = card.resolveLockNo(room);
    result = await card.invoke('checkout', [lockNo]);
    logBase = { action: 'checkout', room_id: room.id, room_no: room.room_no, lock_no: lockNo };
  }
  if (!result.ok) {
    card.logCard({ ...logBase, result_code: result.code, result_msg: result.message });
    throw new AppError(result.message);
  }
  card.logCard({ ...logBase, result_code: 0, result_msg: '成功' });
  res.json({ ok: true });
}));

// ============ 管理卡 ============
router.post('/card/management', wrap(async (req, res) => {
  const { action } = req.body;
  const limitedRaw = req.body.limited_time;
  const limited = limitedRaw ? card.formatCardTime(limitedRaw, '2359') : '';
  if (limitedRaw && !limited) throw new AppError('有效期格式不正确');

  const special = String(req.body.special_room_list || '').replace(/\D/g, '').slice(0, 9);
  const roomLockNo = () => {
    if (req.body.lock_no) return validLockNo(req.body.lock_no);
    if (req.body.room_id) return card.resolveLockNo(roomById(req.body.room_id));
    throw new AppError('请选择房间或输入门锁房号');
  };

  let result;
  let logBase = { action, begin_time: limited, end_time: '', special_room_list: special };
  switch (action) {
    case 'master':
    case 'emergency':
      result = await card.invoke(action, [limited]);
      break;
    case 'multi_floor': {
      const building = asInt(req.body.building_no, asInt(card.cardBuilding()));
      result = await card.invoke('multiFloor', [limited, building, asInt(req.body.floor1), asInt(req.body.floor2), special]);
      logBase.floor1 = asInt(req.body.floor1);
      logBase.floor2 = asInt(req.body.floor2);
      break;
    }
    case 'employee':
      result = await card.invoke('employee', [limited, special]);
      break;
    case 'clock': {
      const t = req.body.time ? `${card.formatCardTime(req.body.time, '0000')}00` : clockNow();
      result = await card.invoke('clock', [t]);
      break;
    }
    case 'room_lock_no': {
      const lockNo = roomLockNo();
      result = await card.invoke('roomLockNo', [lockNo]);
      logBase.lock_no = lockNo;
      break;
    }
    case 'passage_lock_no': {
      const lockNo = roomLockNo();
      result = await card.invoke('passageLockNo', [lockNo, asInt(req.body.passage_type), special]);
      logBase.lock_no = lockNo;
      break;
    }
    case 'special_room_lock_no': {
      const lockNo = roomLockNo();
      result = await card.invoke('specialRoomLockNo', [lockNo, asInt(req.body.special_room_type)]);
      logBase.lock_no = lockNo;
      break;
    }
    case 'report_loss':
      result = await card.invoke('reportLoss', [asInt(req.body.card_no)]);
      logBase.card_no = asInt(req.body.card_no);
      break;
    case 'release':
      result = await card.invoke('release', [asInt(req.body.card_no)]);
      logBase.card_no = asInt(req.body.card_no);
      break;
    case 'clear':
      result = await card.invoke('clear', []);
      break;
    case 'card_sn': {
      result = await card.invoke('cardSN', []);
      if (result.ok) {
        card.logCard({ ...logBase, result_code: 0, result_msg: '成功' });
        res.json({ ok: true, sn: asInt(result.data.sn) });
        return;
      }
      break;
    }
    default:
      throw new AppError('不支持的管理卡操作');
  }

  const cardNo = result.data && result.data.cardNo != null ? asInt(result.data.cardNo) : null;
  if (!result.ok) {
    card.logCard({ ...logBase, card_no: null, result_code: result.code, result_msg: result.message });
    throw new AppError(result.message);
  }
  card.logCard({ ...logBase, card_no: cardNo, result_code: 0, result_msg: '成功' });
  res.json({ ok: true, card_no: cardNo });
}));

// ============ 制卡记录 ============
router.get('/card/logs', wrap((req, res) => {
  const page = Math.max(1, asInt(req.query.page, 1));
  const pageSize = Math.min(100, Math.max(1, asInt(req.query.pageSize, 20)));
  const where = [];
  const params = [];
  if (req.query.action) { where.push('action=?'); params.push(req.query.action); }
  if (req.query.keyword) {
    where.push('(room_no LIKE ? OR lock_no LIKE ? OR guest_name LIKE ? OR CAST(card_no AS TEXT) LIKE ?)');
    const k = `%${req.query.keyword}%`;
    params.push(k, k, k, k);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = get(`SELECT COUNT(*) AS c FROM card_logs ${clause}`, ...params).c;
  const list = q(
    `SELECT * FROM card_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`,
    ...params, pageSize, (page - 1) * pageSize
  );
  res.json({ list, total, page, pageSize });
}));

module.exports = router;
