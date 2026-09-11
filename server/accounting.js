// 账务统一口径：营业日 / 分录分类 / 客账汇总
// 约定：folio_items.amount 正=消费(应收增加)，负=收款(应收减少)
//   账户视角：收款=红 +，消费=绿 −；账户余额 = 收款 − 消费（不含押金）
const { get } = require('./db');
const { now, round2, timeToMinutes, businessDateOf: bdOf } = require('./utils');

const DEFAULT_AUDIT_TIME = '06:00';

// ---- 夜审时间 / 营业日 ----
function getAuditTime() {
  const row = get("SELECT value FROM settings WHERE key='night_audit_time'");
  return row && row.value ? row.value : DEFAULT_AUDIT_TIME;
}

function auditTimeMinutes() {
  return timeToMinutes(getAuditTime(), 6 * 60);
}

// 交易时间 -> 营业日
function businessDateOf(ts) {
  return bdOf(ts, auditTimeMinutes());
}

function currentBusinessDate() {
  return businessDateOf(now());
}

// ---- 分录分类 ----
// 真实收款方式：挂账=应收台账、押金=押金专户，均不计入实收
const NON_CASH_METHODS = ['挂账', '押金'];
function isRealReceipt(method) {
  return !NON_CASH_METHODS.includes(String(method || ''));
}

// 分录语义类型
function itemKind(item) {
  const t = item.item_type;
  const amt = Number(item.amount) || 0;
  const method = String(item.method || '');
  if (t === 'room_charge') return 'room_charge';
  if (t === 'extra_charge') return 'extra_charge';
  if (t === 'adj') return 'adj';
  if (t === 'deposit') return amt > 0 ? 'deposit_out' : 'deposit_in';
  if (t === 'payment') {
    if (method === '挂账') return 'city_ledger';
    if (method === '押金') return 'deposit_offset';
    return amt > 0 ? 'refund' : 'payment';
  }
  return 'info';
}

// ---- 客账汇总 ----
// charges=房费+杂费；payments=实收；refunds=退款；cityLedger=挂账应收；
// depositBalance=押金余额；receivable=应收(欠款)；accountBalance=账户余额(收款−消费)
function folioSummary(items) {
  const s = {
    roomCharge: 0, extraCharge: 0, adj: 0, charges: 0,
    payments: 0, refunds: 0, cityLedger: 0,
    depositIn: 0, depositOut: 0, depositBalance: 0,
    receivable: 0, accountBalance: 0, settled: true,
  };
  for (const it of items || []) {
    const amt = Number(it.amount) || 0;
    switch (itemKind(it)) {
      case 'room_charge': s.roomCharge += amt; s.receivable += amt; break;
      case 'extra_charge': s.extraCharge += amt; s.receivable += amt; break;
      case 'adj': s.adj += amt; s.receivable += amt; break;
      case 'payment': s.payments += -amt; s.receivable += amt; break;
      case 'refund': s.refunds += amt; s.receivable += amt; break;
      case 'city_ledger': s.cityLedger += -amt; s.receivable += amt; break;
      case 'deposit_offset': s.receivable += amt; break; // 押金抵扣：减应收，不计实收
      case 'deposit_in': s.depositIn += -amt; break;
      case 'deposit_out': s.depositOut += amt; break;
      default: break; // info 不参与金额
    }
  }
  s.charges = round2(s.roomCharge + s.extraCharge);
  s.depositBalance = round2(s.depositIn - s.depositOut);
  s.receivable = round2(s.receivable);
  s.accountBalance = round2(-s.receivable);
  s.settled = Math.abs(s.receivable) < 0.005;
  for (const k of ['roomCharge', 'extraCharge', 'adj', 'payments', 'refunds', 'cityLedger', 'depositIn', 'depositOut']) {
    s[k] = round2(s[k]);
  }
  return s;
}

module.exports = {
  DEFAULT_AUDIT_TIME,
  getAuditTime, auditTimeMinutes,
  businessDateOf, currentBusinessDate,
  isRealReceipt, itemKind, folioSummary,
};
