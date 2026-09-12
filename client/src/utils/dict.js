// 系统设置 · 字典缓存（消费类别 / 收款类别 / 收款方式 / 客源渠道）
// 数据在「系统设置」页维护；各页下拉统一从这里取候选值
import { reactive } from 'vue';
import http from '../api';

// 接口返回前的兜底候选（与 server/db.js seedDicts 默认值一致）
const DEFAULTS = {
  charge_category: ['迷你吧', '洗衣', '电话', '赔偿', '早餐', '其他'],
  payment_category: ['房费', '杂费', '预付'],
  payment_method: ['现金', '银行卡', '微信', '支付宝', '挂账'],
  source: ['散客', '美团', '携程', '飞猪', '京东', '小程序'],
};
const KINDS = Object.keys(DEFAULTS);

const fallback = (kind) => DEFAULTS[kind].map((name, i) => ({
  id: 0,
  kind,
  name,
  sort_order: i + 1,
  status: 'active',
  system: kind === 'payment_method' && name === '挂账' ? 1 : 0,
  remark: '',
}));

export const dict = reactive(Object.fromEntries(KINDS.map((k) => [k, fallback(k)])));

let loaded = false;

export async function loadDicts(force = false) {
  if (loaded && !force) return dict;
  try {
    const data = await http.get('/settings/dicts');
    for (const k of KINDS) if (Array.isArray(data[k])) dict[k] = data[k];
    loaded = true;
  } catch { /* 已提示；保留兜底候选 */ }
  return dict;
}

// 切店/登出时清空缓存，恢复兜底候选，避免沿用上一家店的字典
export function resetDicts() {
  loaded = false;
  for (const k of KINDS) dict[k] = fallback(k);
}

export function dictEntries(kind) {
  return (dict[kind] || []).filter((d) => d.status === 'active');
}

export function dictOptions(kind) {
  return dictEntries(kind).map((d) => d.name);
}

// 普通收款/退款/押金方式：不含系统内置的「挂账」（挂账必须走 AR 账户）
export function nonArMethods() {
  return dictEntries('payment_method').filter((d) => !d.system).map((d) => d.name);
}
