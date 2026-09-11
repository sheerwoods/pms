// 房价解析与某晚房价计算（供订单、夜审共用，保持单一数据源）
// 约定：lines = [{ room_type_id, rooms, rate, rates:{date:price} | JSON 字符串 }]

// 解析某一线路的「每晚房价表」：rates 可能是对象或 JSON 字符串
function parseRates(s) {
  try { return JSON.parse(s && s.rates ? s.rates : '{}'); } catch { return {}; }
}

// 归一化订单的线路：优先 r.lines（JSON 字符串/数组），否则回退顶层房型字段
function safeParseLines(r) {
  try {
    const arr = r.lines ? JSON.parse(r.lines) : [];
    if (Array.isArray(arr) && arr.length) return arr;
  } catch { /* fall through */ }
  return [{ room_type_id: r.room_type_id || null, rooms: r.rooms || 1, rate: r.rate || 0, rates: r.rates || '{}' }];
}

// 某间房在某晚的房价：优先该间房入住时确认的覆盖价（row.rate>0），否则用该行线路价表，再回退线路价
// `r` = 订单（需含 lines），`row` = reservation_rooms 行（需含 rate / line_index）
function roomRate(r, row, date) {
  if (row.rate && Number(row.rate) > 0) return Number(row.rate);
  const lines = safeParseLines(r);
  const ln = lines[row.line_index] || lines[0] || {};
  const map = parseRates(ln);
  if (map[date] != null) return Number(map[date]);
  return Number(ln.rate) || 0;
}

module.exports = { parseRates, safeParseLines, roomRate };
