// 可嵌套事务：外层 withTx 包裹，内层事务自动降级为无操作，避免 SQLite 嵌套 BEGIN 报错
const { db } = require('./db');

let depth = 0;

function begin() {
  if (depth === 0) db.exec('BEGIN');
  depth += 1;
}
function commit() {
  depth -= 1;
  if (depth === 0) db.exec('COMMIT');
}
function rollback() {
  if (depth > 0) {
    depth = 0;
    db.exec('ROLLBACK');
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
