// 鉴权网关：校验会话 Cookie，并把整个下游调用栈包进该门店的 AsyncLocalStorage 上下文。
// 下游所有 q/get/run 因此落在该店自己的数据库上，路由代码无需感知门店。
const { readSession } = require('../auth/session');
const { runWithStore, hasStore } = require('../stores/registry');

function unauthorized(res, message) {
  res.status(401).json({ error: message || '未登录或会话已过期', code: 'UNAUTHORIZED' });
}

function storeContext(req, res, next) {
  // 门店数据不缓存：避免浏览器把 A 店的 GET 结果交给 B 店
  res.set('Cache-Control', 'no-store');
  const payload = readSession(req.headers.cookie);
  if (!payload) return unauthorized(res);
  if (!hasStore(payload.s)) return unauthorized(res, '门店不存在或未启用');
  req.auth = { storeKey: payload.s, username: payload.u };
  // runWithStore 必须包住 next()，异步路由在 await 之后仍保留上下文
  runWithStore(payload.s, () => next());
}

module.exports = { storeContext, unauthorized };
