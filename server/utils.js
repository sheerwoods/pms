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

// 生成订单号 RSV+时间戳+自增序号（保证唯一）
let orderSeq = 0;
function genOrderNo() {
  const d = new Date();
  orderSeq = (orderSeq + 1) % 10000;
  const base = `RSV${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return base + pad(orderSeq, 4);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = { fmt, today, now, addDays, nightsBetween, genOrderNo, round2 };
