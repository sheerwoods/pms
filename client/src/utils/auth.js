// 登录态：会话 Cookie 由服务端下发（httpOnly，JS 读不到，因此不落 localStorage）
// 这里只缓存「当前是谁 / 哪家店」用于界面展示与路由守卫。
import { reactive } from 'vue';
import http from '../api';
import { resetDicts } from './dict';

export const auth = reactive({
  user: null,     // { username, displayName }
  shop: null,     // { key, name } 当前门店
  checked: false, // 是否已探测过会话
});

// 清空跨店缓存的内存副本，避免切店后闪现上一家店的字典
export function resetClientCaches() {
  resetDicts();
}

export async function fetchMe() {
  try {
    const data = await http.get('/auth/me');
    auth.user = data.user;
    auth.shop = data.store;
  } catch {
    auth.user = null;
    auth.shop = null;
  } finally {
    auth.checked = true;
  }
  return auth.user;
}

export async function login(username, password) {
  const data = await http.post('/auth/login', { username, password });
  auth.user = data.user;
  auth.shop = data.store;
  auth.checked = true;
  resetClientCaches();
  return data;
}

export async function logout() {
  try {
    await http.post('/auth/logout');
  } catch {
    /* 忽略：无论服务端是否成功，客户端都要清干净 */
  }
  auth.user = null;
  auth.shop = null;
  auth.checked = true;
  resetClientCaches();
  // 硬跳转确保所有模块级缓存彻底重建
  window.location.assign('/login');
}
