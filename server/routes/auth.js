// 登录 / 登出 / 当前会话。挂在鉴权网关之前，因此自身是公开的。
const express = require('express');
const { findAccount, findStore } = require('../stores/config');
const { verifyPassword, hashPassword, sessionCookie, clearCookie, readSession } = require('../auth/session');
const { hasStore } = require('../stores/registry');

const router = express.Router();

// 未知用户也跑一次 scrypt，避免用响应时间探测账号是否存在
const DUMMY_HASH = hashPassword(`never-matches-${Math.random()}`);

// 登录限流：按 IP+用户名 计数，15 分钟窗口内 5 次失败后拒绝
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function attemptKey(req, username) { return `${req.ip}|${username}`; }
function isBlocked(req, username) {
  const rec = attempts.get(attemptKey(req, username));
  if (!rec) return false;
  if (Date.now() - rec.at > WINDOW_MS) { attempts.delete(attemptKey(req, username)); return false; }
  return rec.count >= MAX_ATTEMPTS;
}
function noteFailure(req, username) {
  const k = attemptKey(req, username);
  const rec = attempts.get(k);
  if (!rec || Date.now() - rec.at > WINDOW_MS) attempts.set(k, { count: 1, at: Date.now() });
  else { rec.count += 1; rec.at = Date.now(); }
}

router.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  if (isBlocked(req, username)) return res.status(429).json({ error: '尝试次数过多，请稍后再试' });

  const store = findAccount(username);
  const ok = store
    ? verifyPassword(password, store.account.passwordHash)
    : (verifyPassword(password, DUMMY_HASH), false);
  if (!ok) {
    noteFailure(req, username);
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  attempts.delete(attemptKey(req, username));
  res.setHeader('Set-Cookie', sessionCookie(store.key, username));
  res.json({
    ok: true,
    store: { key: store.key, name: store.name },
    user: { username, displayName: store.account.displayName || username },
  });
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearCookie());
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const payload = readSession(req.headers.cookie);
  if (!payload || !hasStore(payload.s)) return res.status(401).json({ error: '未登录' });
  const store = findStore(payload.s);
  if (!store) return res.status(401).json({ error: '未登录' });
  res.set('Cache-Control', 'no-store');
  res.json({
    store: { key: store.key, name: store.name },
    user: { username: payload.u, displayName: store.account.displayName || payload.u },
  });
});

module.exports = router;
