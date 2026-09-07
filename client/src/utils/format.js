export const fmtMoney = (n) => `¥${Number(n || 0).toFixed(2)}`;

export function fmtDateTime(s) {
  if (!s) return '-';
  return String(s).replace('T', ' ').slice(0, 16);
}

export function fmtDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

export function nightsBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
}

// 房态图 状态 -> 文案/颜色
export const ROOM_STATUS = {
  vacant_clean: { text: '空净', color: '#2f9e44', bg: '#ebfbee' },
  vacant_dirty: { text: '空脏', color: '#868e96', bg: '#f1f3f5' },
  occupied_clean: { text: '占净', color: '#1c7ed6', bg: '#e7f5ff' },
  occupied_dirty: { text: '占脏', color: '#7048e8', bg: '#f3f0ff' },
  ooo: { text: '维修', color: '#e03131', bg: '#fff5f5' },
  expected: { text: '预抵', color: '#e8590c', bg: '#fff4e6' },
  due_out: { text: '预离', color: '#e07f00', bg: '#fff8e1' },
};

// 订单状态
export const RES_STATUS = {
  reserved: { text: '已预订', type: 'warning' },
  checked_in: { text: '在住', type: 'success' },
  checked_out: { text: '已退', type: 'info' },
  cancelled: { text: '已取消', type: 'danger' },
  no_show: { text: '未到', type: 'danger' },
};

export const PAY_METHODS = ['现金', '银行卡', '微信', '支付宝', '挂账'];

export const RES_SOURCES = ['散客', '美团', '携程', '飞猪', '京东', '小程序'];

export const ROOM_KINDS = ['全日房', '钟点房'];
