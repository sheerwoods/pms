// 门店数据库注册表：一店一个 SQLite 文件 + 按请求解析所属库。
// 隔离是「打开了哪个文件」的物理属性，而不是查询写法的纪律问题。
const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const als = new AsyncLocalStorage();
const handles = new Map();   // key -> DatabaseSync

function dataDir() {
  return process.env.PMS_DATA_DIR || path.join(__dirname, '..', '..', 'data');
}
function storesDir() { return path.join(dataDir(), 'stores'); }
function storeFile(key) { return path.join(storesDir(), `${key}.db`); }
function legacyFile() { return path.join(dataDir(), 'pms.db'); }

// 在指定门店上下文中同步执行 fn；期间所有 q/get/run 都落在该店数据库
function runWithStore(key, fn) {
  return als.run({ key }, fn);
}
function currentStoreKey() {
  const ctx = als.getStore();
  return ctx ? ctx.key : null;
}

// 失效安全：没有门店上下文一律抛错，绝不回退到某个默认库
function getDb() {
  const key = currentStoreKey();
  if (!key) throw new Error('NO_STORE_CONTEXT: 数据库访问缺少门店上下文');
  const db = handles.get(key);
  if (!db) throw new Error(`UNKNOWN_STORE: 门店 ${key} 未打开`);
  return db;
}

function hasStore(key) { return handles.has(key); }
function openKeys() { return [...handles.keys()]; }

function openStore(key) {
  if (handles.has(key)) return handles.get(key);
  fs.mkdirSync(storesDir(), { recursive: true });
  const db = new DatabaseSync(storeFile(key));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  handles.set(key, db);
  return db;
}

function closeAll() {
  for (const db of handles.values()) { try { db.close(); } catch { /* 忽略 */ } }
  handles.clear();
}

// 旧库认领：只有一个留存的 pms.db 时，把它归入指定门店，订单数据原样保留。
// 永不删除 pms.db；归属不明确时拒绝猜测。
function adoptLegacy(enabledKeys, configuredKey) {
  fs.mkdirSync(storesDir(), { recursive: true });
  const existing = fs.readdirSync(storesDir()).filter((f) => f.endsWith('.db'));
  if (existing.length) return;
  const legacy = legacyFile();
  if (!fs.existsSync(legacy)) return;

  // 归属来源：config/stores.json 的 legacyStore → 环境变量 → 仅配置一家店时默认该店
  const forced = (configuredKey || process.env.PMS_LEGACY_STORE || '').trim();
  const target = forced || (enabledKeys.length === 1 ? enabledKeys[0] : '');
  if (!target) {
    console.warn('[stores] 检测到遗留 data/pms.db，但启用了多家门店，未自动认领。');
    console.warn('[stores] 如需把现有数据归入某家店，请设置 PMS_LEGACY_STORE=<门店key> 后重启；pms.db 未被改动。');
    return;
  }
  if (!enabledKeys.includes(target)) {
    console.warn(`[stores] PMS_LEGACY_STORE=${target} 不在启用门店中，跳过认领。`);
    return;
  }

  try {
    const db = new DatabaseSync(legacy);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
  } catch (e) {
    console.warn(`[stores] 遗留库 checkpoint 失败：${e.message}`);
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const from = legacy + suffix;
    if (fs.existsSync(from)) fs.renameSync(from, storeFile(target) + suffix);
  }
  console.log(`[stores] 已把遗留 data/pms.db 认领为门店 ${target}（订单数据保留）`);
}

module.exports = {
  runWithStore, currentStoreKey, getDb, hasStore, openKeys,
  openStore, closeAll, adoptLegacy, storeFile, storesDir, dataDir,
};
