// 门店配置：加载并校验 config/stores.json（跟随 git，部署时同步）
// 校验不通过直接抛错拒绝启动，避免半残状态运行。
const fs = require('fs');
const path = require('path');
const { isPasswordHash } = require('../auth/session');

const CONFIG_PATH = process.env.PMS_CONFIG || path.join(__dirname, '..', '..', 'config', 'stores.json');
const CONFIG_DIR = path.dirname(CONFIG_PATH);
const KEY_RE = /^[a-z0-9_-]+$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// roomPlanFile 相对配置文件所在目录解析；也允许内联 roomTypes/rooms
function loadRoomPlan(store, problems) {
  if (!store.roomPlanFile) return { roomTypes: store.roomTypes, rooms: store.rooms };
  const file = path.resolve(CONFIG_DIR, store.roomPlanFile);
  if (!fs.existsSync(file)) {
    problems.push(`门店 ${store.key} 的 roomPlanFile 不存在：${file}`);
    return { roomTypes: [], rooms: [] };
  }
  try {
    const plan = readJson(file);
    return { roomTypes: plan.roomTypes, rooms: plan.rooms };
  } catch (e) {
    problems.push(`门店 ${store.key} 的 roomPlanFile 解析失败：${e.message}`);
    return { roomTypes: [], rooms: [] };
  }
}

function loadMachineConfig() {
  const file = path.join(CONFIG_DIR, 'machine.json');
  if (!fs.existsSync(file)) return {};
  try { return readJson(file); } catch (e) {
    console.warn(`[config] machine.json 解析失败，忽略：${e.message}`);
    return {};
  }
}

// PMS_STORE_KEYS 可只启用配置中的部分门店（一店一实例部署时用）
function selectedKeys(all) {
  const raw = (process.env.PMS_STORE_KEYS || '').trim();
  const wanted = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : null;
  return all.filter((s) => {
    if (s.enabled === false) return false;
    if (wanted && !wanted.includes(s.key)) return false;
    return true;
  });
}

function loadStores() {
  if (!fs.existsSync(CONFIG_PATH)) throw new Error(`门店配置文件不存在：${CONFIG_PATH}`);
  let raw;
  try { raw = readJson(CONFIG_PATH); } catch (e) { throw new Error(`门店配置解析失败：${e.message}`); }

  const problems = [];
  if (!raw || !Array.isArray(raw.stores) || !raw.stores.length) problems.push('stores 必须是非空数组');

  const all = Array.isArray(raw?.stores) ? raw.stores : [];
  const keys = new Set();
  const usernames = new Set();

  for (const s of all) {
    if (!s || typeof s !== 'object') { problems.push('存在非法的门店条目'); continue; }
    if (typeof s.key !== 'string' || !KEY_RE.test(s.key)) problems.push(`门店 key 非法（须匹配 ${KEY_RE}）：${s.key}`);
    else if (keys.has(s.key)) problems.push(`门店 key 重复：${s.key}`);
    else keys.add(s.key);
    if (!s.name) problems.push(`门店 ${s.key} 缺少 name`);

    const acc = s.account || {};
    if (!acc.username) problems.push(`门店 ${s.key} 缺少 account.username`);
    else if (usernames.has(acc.username)) problems.push(`登录账号重复：${acc.username}`);
    else usernames.add(acc.username);
    if (!isPasswordHash(acc.passwordHash)) problems.push(`门店 ${s.key} 的 account.passwordHash 格式非法（请用 npm run hash-password 生成）`);

    const plan = loadRoomPlan(s, problems);
    if (!Array.isArray(plan.roomTypes) || !plan.roomTypes.length) problems.push(`门店 ${s.key} 的 roomTypes 为空`);
    if (!Array.isArray(plan.rooms) || !plan.rooms.length) problems.push(`门店 ${s.key} 的 rooms 为空`);

    const typeNames = new Set((plan.roomTypes || []).map((t) => t && t.name));
    const roomNos = new Set();
    for (const r of plan.rooms || []) {
      if (!r || !r.roomNo) { problems.push(`门店 ${s.key} 存在缺少 roomNo 的房间`); continue; }
      const no = String(r.roomNo);
      if (roomNos.has(no)) problems.push(`门店 ${s.key} 房号重复：${no}`);
      else roomNos.add(no);
      if (!typeNames.has(r.type)) problems.push(`门店 ${s.key} 房间 ${no} 引用了未声明的房型「${r.type}」`);
    }

    s._roomTypes = plan.roomTypes || [];
    s._rooms = plan.rooms || [];
  }

  if (problems.length) {
    throw new Error(`门店配置校验失败（${CONFIG_PATH}）：\n  - ${problems.join('\n  - ')}`);
  }

  const enabled = selectedKeys(all);
  if (!enabled.length) throw new Error('没有启用任何门店，请检查 config/stores.json 与 PMS_STORE_KEYS');
  legacyStore = typeof raw.legacyStore === 'string' ? raw.legacyStore : null;
  return enabled;
}

let legacyStore = null;
const stores = loadStores();
const machine = loadMachineConfig();

function listStores() { return stores; }
function findStore(key) { return stores.find((s) => s.key === key) || null; }
function findAccount(username) { return stores.find((s) => s.account.username === username) || null; }
function storeConfigPath() { return CONFIG_PATH; }
function machineConfig() { return machine; }
// 遗留 data/pms.db 归属的门店（配置显式声明，避免多店时猜测）
function legacyStoreKey() { return legacyStore; }

module.exports = {
  listStores, findStore, findAccount, storeConfigPath, machineConfig, legacyStoreKey, CONFIG_DIR,
};
