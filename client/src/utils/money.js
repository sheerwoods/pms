// 账务统一显示口径（账户视角）
//   收款 / 收取押金 = 红 +
//   消费 / 退款 / 退还押金 = 绿 −
//   账户余额 = 收款 − 消费；>0 应退客人（红），<0 客人欠款（绿），=0 已结清
import { fmtMoney } from './format';

const EPS = 0.005;

// 金额显示：{ sign, text, cls }
export function moneyView(amount) {
  const n = Number(amount) || 0;
  if (n < -EPS) return { sign: '+', text: fmtMoney(Math.abs(n)), cls: 'amt-in' };
  if (n > EPS) return { sign: '−', text: fmtMoney(n), cls: 'amt-out' };
  return { sign: '', text: fmtMoney(0), cls: 'amt-zero' };
}

// 账户余额显示：{ label, sign, text, cls }
export function balanceView(accountBalance) {
  const n = Number(accountBalance) || 0;
  if (n > EPS) return { label: '应退客人', sign: '+', text: fmtMoney(n), cls: 'bal-credit' };
  if (n < -EPS) return { label: '客人欠款', sign: '−', text: fmtMoney(-n), cls: 'bal-due' };
  return { label: '已结清', sign: '', text: fmtMoney(0), cls: 'bal-settled' };
}

// 分录语义类型 -> 文案 / 标签色
export const ITEM_KIND = {
  room_charge: { text: '房费', tag: 'primary' },
  extra_charge: { text: '杂费', tag: 'warning' },
  adj: { text: '调整', tag: 'danger' },
  payment: { text: '收款', tag: 'success' },
  refund: { text: '退款', tag: 'warning' },
  deposit_in: { text: '收押金', tag: 'info' },
  deposit_out: { text: '退押金', tag: 'info' },
  deposit_offset: { text: '押金抵扣', tag: 'info' },
  city_ledger: { text: '挂账', tag: 'danger' },
  info: { text: '备注', tag: 'info' },
};

// 兼容：优先用服务端 kind，回退 item_type
export function itemKindOf(row) {
  if (!row) return 'info';
  return row.kind || row.item_type || 'info';
}
export const itemKindText = (k) => ITEM_KIND[k]?.text || k;
export const itemKindTag = (k) => ITEM_KIND[k]?.tag || '';
