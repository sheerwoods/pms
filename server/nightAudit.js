// 夜审：为所有在住「全日房」补计每日房费。
// 规则：入住时不自动产生消费；夜审在夜审时间（默认 06:00）自动/手动为每个在住全日房
// 补计从入住日到「昨日」之间缺失的晚次房费（最近的已完成夜晚），可重复执行（幂等）。
const { q, get, run } = require('./db');
const { addFolioItem } = require('./folio');
const { today, addDays, round2 } = require('./utils');
const { roomRate } = require('./rates');
const accounting = require('./accounting');

const KEY_TIME = 'night_audit_time';
const KEY_LAST = 'last_audit_date';

function getSetting(key, def) {
  const row = get('SELECT value FROM settings WHERE key=?', key);
  return row ? row.value : def;
}

function setSetting(key, value) {
  run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, value);
}

// 夜审时间 / 营业日统一由 accounting 提供
function getAuditTime() { return accounting.getAuditTime(); }
function auditTimeMinutes() { return accounting.auditTimeMinutes(); }
function businessDate() { return accounting.currentBusinessDate(); }
function getLastAuditDate() { return getSetting(KEY_LAST, ''); }
function setAuditTime(t) { setSetting(KEY_TIME, t); }

// 收集本次夜审应补的房费明细：每个在住全日房，从入住日到「最近已完成夜晚」缺失的晚次
function collectPending() {
  const bd = businessDate();
  // 最近已完成夜晚：营业日 - 1。夜审补计截至昨晚；若今日入住则区间为空。
  const lastNight = addDays(bd, -1);
  const rows = q(`
    SELECT rr.id AS unit_id, rr.reservation_id, rr.line_index, rr.rate,
           r.guest_id, r.check_in_date, r.actual_check_in, r.lines
    FROM reservation_rooms rr
    JOIN reservations r ON r.id = rr.reservation_id
    WHERE rr.status='checked_in' AND rr.room_id IS NOT NULL AND r.booking_type != '钟点房'
  `);
  const pending = [];
  for (const row of rows) {
    const start = (row.actual_check_in && String(row.actual_check_in).slice(0, 10)) || row.check_in_date;
    if (start > lastNight) continue; // 今日入住，尚无已完成夜晚
    const existing = q(
      "SELECT description FROM folio_items WHERE reservation_id=? AND item_type='room_charge' AND room_unit_id=?",
      row.reservation_id, row.unit_id
    );
    const have = new Set(existing.map((x) => String(x.description || '')));
    let d = start;
    while (d <= lastNight) {
      const desc = `房费(${d})`;
      if (!have.has(desc)) {
        pending.push({
          unit_id: row.unit_id,
          reservation_id: row.reservation_id,
          guest_id: row.guest_id,
          date: d,
          amount: round2(roomRate(row, row, d)),
        });
      }
      d = addDays(d, 1);
    }
  }
  return { business_date: bd, last_night: lastNight, pending, units: new Set(pending.map((x) => x.unit_id)).size };
}

// 执行夜审（自动/手动共用）
function runNightAudit() {
  const { business_date, last_night, pending, units } = collectPending();
  const auditTime = getAuditTime(); // HH:MM
  for (const p of pending) {
    // 消费时间 = 该晚次对应的夜审时刻（次日凌晨夜审时间），而非固定中午
    const postedAt = `${addDays(p.date, 1)} ${auditTime}:00`;
    addFolioItem({
      reservationId: p.reservation_id,
      guestId: p.guest_id,
      itemType: 'room_charge',
      category: '房费',
      description: `房费(${p.date})`,
      amount: p.amount,
      roomUnitId: p.unit_id,
      businessDate: p.date,   // 第 N 晚房费 -> 营业日 N
      createdAt: postedAt,
    });
  }
  setSetting(KEY_LAST, business_date);
  return { ok: true, business_date, last_night, audit_time: auditTime, posted_items: pending.length, audited_units: units };
}

// 定时触发判定：到达/超过夜审时间，且当日尚未执行
function isDue() {
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < auditTimeMinutes()) return false;
  return getLastAuditDate() !== today();
}

// 启动定时检查（默认每 60 秒一次）；进程启动后先补一次以满足「服务器晚启动」的catch-up
function startScheduler(intervalMs = 60 * 1000) {
  const check = () => { try { if (isDue()) runNightAudit(); } catch (e) { console.error('[nightAudit]', e); } };
  setTimeout(check, 10 * 1000); // 启动后 10 秒首检
  setInterval(check, intervalMs);
}

module.exports = {
  getAuditTime, getLastAuditDate, setAuditTime,
  businessDate, collectPending, runNightAudit, isDue, startScheduler,
};
