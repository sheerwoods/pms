// 通用工具函数
function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

// Date -> 'YYYY-MM-DD'
function fmt(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function today() {
  return fmt(new Date());
}

// 'YYYY-MM-DD HH:MM:SS'
function now() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 日期字符串加减天数
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return fmt(d);
}

// 两个日期之间的夜数
function nightsBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

// 生成订单号：时间戳+自增序号（保证唯一，长度 16 位）
let orderSeq = 0;
function genOrderNo() {
  const d = new Date();
  orderSeq = (orderSeq + 1) % 10000;
  const base = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
  return base + pad(orderSeq, 4);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// 'HH:MM' -> 分钟数
function timeToMinutes(hhmm, def = 0) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return def;
  return (Number(m[1]) || 0) * 60 + (Number(m[2]) || 0);
}

// 交易时间 'YYYY-MM-DD HH:MM:SS' 归属营业日：>= 夜审时间取当日，否则取前一日
function businessDateOf(ts, auditMinutes = 0) {
  const s = String(ts || '').slice(0, 10);
  if (!s) return today();
  const min = timeToMinutes(String(ts || '').slice(11, 16), 0);
  return min >= auditMinutes ? s : addDays(s, -1);
}

module.exports = { fmt, today, now, addDays, nightsBetween, genOrderNo, round2, timeToMinutes, businessDateOf };
