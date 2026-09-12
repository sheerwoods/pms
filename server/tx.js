// 可嵌套事务：外层 withTx 包裹，内层事务自动降级为无操作，避免 SQLite 嵌套 BEGIN 报错。
// 深度必须按门店分别计数 —— 多家店共用一个进程，若共用计数器，
// A 店的 BEGIN 会让 B 店跳过自己的事务，A 的 COMMIT/ROLLBACK 还会错结到 B 店。
const { getDb, currentStoreKey } = require('./stores/registry');

const depths = new Map();

function begin() {
  const key = currentStoreKey() || '';
  const depth = depths.get(key) || 0;
  if (depth === 0) getDb().exec('BEGIN');
  depths.set(key, depth + 1);
}
function commit() {
  const key = currentStoreKey() || '';
  const depth = Math.max(0, (depths.get(key) || 1) - 1);
  depths.set(key, depth);
  if (depth === 0) getDb().exec('COMMIT');
}
function rollback() {
  const key = currentStoreKey() || '';
  if ((depths.get(key) || 0) > 0) {
    depths.set(key, 0);
    getDb().exec('ROLLBACK');
  }
}

// 同步执行 fn；抛错则整体回滚
function withTx(fn) {
  begin();
  try {
    const out = fn();
    commit();
    return out;
  } catch (e) {
    rollback();
    throw e;
  }
}

module.exports = { withTx };
