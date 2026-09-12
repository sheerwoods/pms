// 会话与密码：scrypt 密码哈希 + HMAC 签名 Cookie
// 仅用 node:crypto，不引入新依赖。
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;
const COOKIE_NAME = 'pms_session';
const TTL_MS = 12 * 3600 * 1000;   // 12 小时

// ---------------- 密码哈希 ----------------
// 格式：scrypt$N$r$p$<saltB64>$<hashB64>（自描述，便于日后调参）
function hashPassword(password) {
  const salt = crypto.randomBytes(32);
  const hash = crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function parseHash(stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const N = Number(parts[1]); const r = Number(parts[2]); const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], 'base64');
  const hash = Buffer.from(parts[5], 'base64');
  if (!Number.isInteger(N) || N < 2 || !Number.isInteger(r) || r < 1 || !Number.isInteger(p) || p < 1) return null;
  if (!salt.length || !hash.length) return null;
  return { N, r, p, salt, hash };
}

function isPasswordHash(stored) {
  return parseHash(stored) !== null;
}

function verifyPassword(password, stored) {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  try {
    const actual = crypto.scryptSync(String(password), parsed.salt, parsed.hash.length, {
      N: parsed.N, r: parsed.r, p: parsed.p,
    });
    return crypto.timingSafeEqual(actual, parsed.hash);
  } catch {
    return false;
  }
}

// ---------------- 会话密钥 ----------------
// 优先 PMS_SESSION_SECRET；否则在数据目录生成并持久化 session.key（重启后会话不失效）
let cachedSecret = null;
function dataDir() {
  return process.env.PMS_DATA_DIR || path.join(__dirname, '..', '..', 'data');
}
function sessionSecret() {
  if (cachedSecret) return cachedSecret;
  const env = process.env.PMS_SESSION_SECRET;
  if (env && env.trim()) {
    cachedSecret = Buffer.from(env.trim(), 'utf8');
    return cachedSecret;
  }
  const file = path.join(dataDir(), 'session.key');
  try {
    if (fs.existsSync(file)) {
      const saved = fs.readFileSync(file, 'utf8').trim();
      if (saved) { cachedSecret = Buffer.from(saved, 'base64'); return cachedSecret; }
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const key = crypto.randomBytes(32);
    fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
    cachedSecret = key;
    return cachedSecret;
  } catch (e) {
    // 取不到密钥就拒绝启动，绝不回退到硬编码默认值
    throw new Error(`无法获取会话密钥（请设置 PMS_SESSION_SECRET 或确保数据目录可写）：${e.message}`);
  }
}

// 每店独立派生签名密钥：即使某处校验遗漏，A 店的 Cookie 也签不出 B 店
function storeKey(store) {
  return crypto.createHmac('sha256', sessionSecret()).update(`store:${store}`).digest();
}

// ---------------- 令牌 ----------------
function signToken(store, username) {
  const payload = { s: store, u: username, exp: Date.now() + TTL_MS };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const mac = crypto.createHmac('sha256', storeKey(store)).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verifyToken(token) {
  const raw = String(token || '');
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || typeof payload.s !== 'string' || !payload.s) return null;
  const expected = crypto.createHmac('sha256', storeKey(payload.s)).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
  return payload;
}

// ---------------- Cookie ----------------
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieHeader(name, value, maxAgeSeconds) {
  const base = `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  return process.env.PMS_COOKIE_SECURE === '1' ? `${base}; Secure` : base;
}

function sessionCookie(store, username) {
  return cookieHeader(COOKIE_NAME, encodeURIComponent(signToken(store, username)), Math.floor(TTL_MS / 1000));
}

function clearCookie() {
  return cookieHeader(COOKIE_NAME, '', 0);
}

// 从请求头读取并校验会话；任何一步失败都返回 null
function readSession(cookieHeaderValue) {
  const token = parseCookies(cookieHeaderValue)[COOKIE_NAME];
  if (!token) return null;
  return verifyToken(token);
}

module.exports = {
  COOKIE_NAME,
  hashPassword, verifyPassword, isPasswordHash,
  sessionSecret, signToken, verifyToken,
  sessionCookie, clearCookie, readSession, parseCookies,
};
