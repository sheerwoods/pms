// 门锁制卡桥接：调用 32 位 CardTool.exe，由它 P/Invoke es200601.dll
// 说明：es200601.dll 为 32 位，x64 的 Node 无法直接加载，故走子进程助手
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { AppError } = require('./errors');
const { get, run } = require('./db');
const { machineConfig } = require('./stores/config');

const VENDOR_DIR = path.join(__dirname, '..', 'vendor', 'es200601');
const TOOL_PATH = path.join(VENDOR_DIR, 'CardTool.exe');

// 读卡返回的卡类型表（厂商文档）
const CARD_TYPE_TEXT = {
  1: '扇区卡', 10: '原始卡', 11: '密码卡', 12: '房号卡', 13: '时钟卡', 14: '设置卡',
  15: '总清卡', 16: '禁止卡', 17: '挂失卡', 18: '解挂卡', 19: '记录卡',
  30: '紧急卡', 31: '总控卡', 32: '区间卡', 33: '多层卡', 34: '楼层卡', 35: '员工卡',
  36: '常开卡', 37: '一次卡', 38: '备用卡', 39: '客人卡', 40: '预订客人卡',
};

const CODE_TEXT = {
  0: '成功', '-1': '日期/时间格式错误（有效期结束须晚于开始）', '-2': '写卡失败', '-3': '楼号错误', '-4': '楼层错误',
  '-5': '房号错误', '-6': '卡号错误', '-7': '读卡失败，请确认卡片已放好且设备正常',
  '-8': '门锁系统未登记该房号（查询房间批次失败），请在门锁系统中登记房间或修改本房门锁房号',
  '-9': '特殊房号错误', '-10': '非本系统卡片', '-100': '门锁数据库未打开', '-101': '连接门锁数据库失败（门锁数据库未响应，请检查门锁系统数据库服务）',
  '-102': '关闭门锁数据库失败', '-103': '门锁数据库未创建', '-200': '打开写卡器串口失败，请检查串口设置',
  '-201': '连接数据采集器失败', '-202': '无效数据', '-300': '卡块错误',
};

function codeText(code) {
  return CODE_TEXT[code] || CODE_TEXT[String(code)] || `制卡操作失败（错误码 ${code}）`;
}

// ---------------- 系统设置 ----------------
// 硬件设置（启用/串口/门锁库账号）属于机器而非门店：config/machine.json 优先，
// 未定义时回退到本店 settings。门店级的楼栋号/副房号仍走各店自己的 settings。
function setting(key, def = '') {
  const m = (machineConfig() || {}).card || {};
  if (key === 'card_enabled' && m.enabled !== undefined) return m.enabled ? '1' : '0';
  // 串口：仅在 machine.json 显式指定了非 0 值时覆盖，否则沿用本店设置（0 = 不改动门锁系统配置）
  if (key === 'card_port' && Number(m.port) > 0) return String(m.port);
  if (key === 'card_db_user' && m.dbUser) return String(m.dbUser);
  if (key === 'card_db_password' && m.dbPassword) return String(m.dbPassword);
  const r = get('SELECT value FROM settings WHERE key=?', key);
  return r && r.value != null ? r.value : def;
}

function cardEnabled() {
  return setting('card_enabled', '1') === '1';
}

// 写卡器串口：0/空 表示不主动设置，沿用门锁系统自身的发卡机配置
function cardPort() {
  const n = parseInt(setting('card_port', '0'), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 子进程超时（毫秒）：厂商 DLL 内部连接/查询超时可达 15~30s。
// 若 PMS 先于 DLL 杀掉子进程，就拿不到厂商返回的真实错误码（如 -101 门锁数据库连接失败），
// 前台只会看到笼统的「超时」。故默认放宽到 45s，可用 config/machine.json 的 card.timeoutMs 覆盖。
const CARD_TIMEOUT_DEFAULT = 45000;
function cardTimeoutMs() {
  const m = (machineConfig() || {}).card || {};
  const n = parseInt(m.timeoutMs, 10);
  if (!Number.isFinite(n)) return CARD_TIMEOUT_DEFAULT;
  return Math.min(180000, Math.max(5000, n));
}

// 副房号（门锁房号末位）。厂商系统实际按 1 起编，默认 1
function cardSub() {
  const n = parseInt(setting('card_sub', '1'), 10);
  return Number.isFinite(n) && n >= 0 && n <= 9 ? n : 1;
}

function cardBuilding() {
  const s = String(setting('card_building', '01') || '01').replace(/\D/g, '');
  return s ? s.slice(-2).padStart(2, '0') : '01';
}

// ---------------- 房号映射 ----------------
function pad2(v) {
  return String(Number(v) || 0).padStart(2, '0').slice(-2);
}

// 按规则生成 7 位门锁房号：楼号2 + 楼层2 + 房号后2位 + 副房1
function autoLockNo(room) {
  const no = String(room.room_no || '');
  const trailing = (no.match(/(\d+)$/) || [''])[0];
  const roomPart = (trailing.slice(-2) || '0').padStart(2, '0');
  return `${cardBuilding()}${pad2(room.floor)}${roomPart}${cardSub()}`;
}

// 房间最终门锁房号：手工覆盖优先
function resolveLockNo(room) {
  const override = String(room.lock_no || '').trim();
  if (/^\d{7}$/.test(override)) return override;
  return autoLockNo(room);
}

function parseLockNo(lockNo) {
  const s = String(lockNo || '');
  if (!/^\d{7}$/.test(s)) return null;
  return { building: s.slice(0, 2), floor: s.slice(2, 4), room: s.slice(4, 6), sub: s.slice(6, 7) };
}

// ---------------- 时间格式 ----------------
// 统一转为厂商要求的 'YYMMDDHHmm'；入参可为日期/日期时间；dateOnly 补默认时分
function formatCardTime(input, defaultHHmm = '1200') {
  if (!input) return '';
  const s = String(input).trim();
  if (/^\d{10}$/.test(s)) return s;                    // 已是 YYMMDDHHmm
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return '';
  const yy = m[1].slice(2);
  const hh = m[4] != null ? m[4] : defaultHHmm.slice(0, 2);
  const mm = m[5] != null ? m[5] : defaultHHmm.slice(2, 4);
  return `${yy}${m[2]}${m[3]}${hh}${mm}`;
}

// 钟点房固定时长（小时），与前端房态/订单展示一致
const HOURLY_HOURS = 3;

// 在 'YYMMDDHHmm' 上顺延小时
function shiftCardHours(t, hours) {
  const s = String(t || '');
  if (!/^\d{10}$/.test(s)) return '';
  const dt = new Date(2000 + Number(s.slice(0, 2)), Number(s.slice(2, 4)) - 1, Number(s.slice(4, 6)),
    Number(s.slice(6, 8)), Number(s.slice(8, 10)));
  dt.setHours(dt.getHours() + hours);
  const p = (n) => String(n).padStart(2, '0');
  return `${String(dt.getFullYear()).slice(2)}${p(dt.getMonth() + 1)}${p(dt.getDate())}${p(dt.getHours())}${p(dt.getMinutes())}`;
}

// 在 'YYMMDDHHmm' 上顺延天数
function shiftCardTime(t, days) {
  const s = String(t || '');
  if (!/^\d{10}$/.test(s)) return '';
  const dt = new Date(2000 + Number(s.slice(0, 2)), Number(s.slice(2, 4)) - 1, Number(s.slice(4, 6)),
    Number(s.slice(6, 8)), Number(s.slice(8, 10)));
  dt.setDate(dt.getDate() + days);
  const p = (n) => String(n).padStart(2, '0');
  return `${String(dt.getFullYear()).slice(2)}${p(dt.getMonth() + 1)}${p(dt.getDate())}${p(dt.getHours())}${p(dt.getMinutes())}`;
}

// 保证有效期结束晚于开始；同日 / 0 间夜时结束顺延一天，避免厂商返回 -1
function ensureValidWindow(begin, end) {
  const b = String(begin || '');
  if (!/^\d{10}$/.test(b)) return { begin: b, end: String(end || '') };
  let e = String(end || '');
  if (!/^\d{10}$/.test(e) || e <= b) e = shiftCardTime(b, 1);
  return { begin: b, end: e };
}

// ---------------- 子进程协议 ----------------
function enc(v) {
  return Buffer.from(String(v == null ? '' : v), 'utf8').toString('base64');
}

function dec(b64) {
  try {
    return Buffer.from(String(b64 || ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

let buildTried = false;
function ensureTool() {
  if (fs.existsSync(TOOL_PATH)) return;
  if (!buildTried) {
    buildTried = true;
    try {
      const build = require('../scripts/build-cardtool');
      const r = build();
      if (!r.ok) console.warn(`[card] 制卡助手构建失败：${r.reason}`);
    } catch (e) {
      console.warn(`[card] 制卡助手构建异常：${e.message}`);
    }
  }
  if (!fs.existsSync(TOOL_PATH)) {
    throw new AppError('制卡助手不可用：未找到或未成功编译 vendor/es200601/CardTool.exe');
  }
}

function parseResult(line, stderr) {
  const parts = String(line || '').trim().split(' ');
  if (parts[0] === 'OK') {
    const data = {};
    for (const kv of parts.slice(2)) {
      const i = kv.indexOf('=');
      if (i > 0) data[kv.slice(0, i)] = dec(kv.slice(i + 1));
    }
    return { ok: true, code: Number(parts[1]), data };
  }
  if (parts[0] === 'ERR') {
    const data = {};
    for (const kv of parts.slice(3)) {
      const i = kv.indexOf('=');
      if (i > 0) data[kv.slice(0, i)] = dec(kv.slice(i + 1));
    }
    const code = Number(parts[1]);
    // 已知厂商错误码用统一中文文案；助手自身错误（-9xx）用其返回值
    const known = CODE_TEXT[code] || CODE_TEXT[String(code)];
    return { ok: false, code, message: known || dec(parts[2]) || '制卡操作失败', data };
  }
  return { ok: false, code: -997, message: (stderr || '').trim() || '制卡助手返回异常', data: {} };
}

// 一台机器只有一个读卡器/串口：把并发调用串行化，避免多店同时制卡抢占端口。
// 队列是进程级的（机器级），与门店无关。
let cardQueue = Promise.resolve();
function callCard(cmd, args, opts) {
  const run = () => rawCallCard(cmd, args, opts);
  const next = cardQueue.then(run, run);
  cardQueue = next.then(() => {}, () => {});
  return next;
}

// 执行一条命令；args 为除 user/pass/port 外的业务参数（按厂商函数顺序）
function rawCallCard(cmd, args, { timeout = cardTimeoutMs() } = {}) {
  return new Promise((resolve, reject) => {
    try { ensureTool(); } catch (e) { reject(e); return; }
    const child = spawn(TOOL_PATH, [], { cwd: VENDOR_DIR, windowsHide: true });
    let out = '';
    let err = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* 忽略 */ }
      const secs = Math.round(timeout / 1000);
      reject(new AppError(
        `制卡超时（${secs} 秒无响应）：写卡器或门锁数据库未响应。` +
        '请检查写卡器连接与门锁系统数据库服务，查看 vendor/es200601/log 最新日志确认原因'
      ));
    }, timeout);
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new AppError(`无法启动制卡助手：${e.message}`));
    });
    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const line = out.trim().split(/\r?\n/).filter(Boolean).pop() || '';
      resolve(parseResult(line, err));
    });
    const user = setting('card_db_user', '');
    const pass = setting('card_db_password', '');
    const fields = [cmd, enc(user), enc(pass), enc(cardPort()), ...args.map(enc)];
    child.stdin.write(fields.join(' ') + '\n');
    child.stdin.end();
  });
}

// 启用校验后调用，返回原始结果（含 code/message），由调用方决定如何处理错误
async function invoke(cmd, args) {
  if (!cardEnabled()) throw new AppError('门锁制卡功能未启用，请在「系统设置 → 门锁制卡」中开启');
  return callCard(cmd, args);
}

// 启用校验 + 调用，失败即抛业务错误
async function runCard(cmd, args) {
  const r = await invoke(cmd, args);
  if (!r.ok) throw new AppError(r.message || codeText(r.code));
  return r.data || {};
}

// 查询 DLL 版本（不需数据库/设备）
async function toolVersion() {
  const r = await callCard('version', []);
  return r.ok ? String(r.data.version || '') : '';
}

// ---------------- 制卡日志 ----------------
function logCard(entry) {
  try {
    run(
      `INSERT INTO card_logs (action, reservation_id, room_id, room_no, lock_no, card_type, card_no,
        guest_name, begin_time, end_time, special_room_list, floor1, floor2, floor3, result_code, result_msg, operator)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      entry.action || '', entry.reservation_id || null, entry.room_id || null,
      entry.room_no || '', entry.lock_no || '', entry.card_type == null ? null : Number(entry.card_type),
      entry.card_no == null ? null : Number(entry.card_no), entry.guest_name || '',
      entry.begin_time || '', entry.end_time || '', entry.special_room_list || '',
      Number(entry.floor1) || 0, Number(entry.floor2) || 0, Number(entry.floor3) || 0,
      Number(entry.result_code) || 0, entry.result_msg || '', entry.operator || ''
    );
  } catch (e) {
    console.warn('[card] 写制卡日志失败：', e.message);
  }
}

module.exports = {
  VENDOR_DIR,
  TOOL_PATH,
  CARD_TYPE_TEXT,
  codeText,
  setting,
  cardEnabled,
  cardPort,
  cardTimeoutMs,
  cardSub,
  cardBuilding,
  autoLockNo,
  resolveLockNo,
  parseLockNo,
  formatCardTime,
  HOURLY_HOURS,
  shiftCardHours,
  shiftCardTime,
  ensureValidWindow,
  callCard,
  invoke,
  runCard,
  toolVersion,
  logCard,
};
