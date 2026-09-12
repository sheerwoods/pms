import axios from 'axios';
import { ElMessage } from 'element-plus';

const http = axios.create({ baseURL: '/api', timeout: 15000 });

http.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const status = err.response?.status;
    const url = err.config?.url || '';
    if (status === 401) {
      if (url.includes('/auth/login')) {
        // 登录失败：正常提示
        ElMessage.error(err.response?.data?.error || '用户名或密码错误');
      } else if (!url.includes('/auth/me')) {
        // 会话失效：硬跳登录页，顺带清掉所有前端缓存（/auth/me 的失败由守卫静默处理）
        if (!window.location.pathname.startsWith('/login')) {
          const redirect = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.assign(`/login?redirect=${redirect}`);
        }
      }
      return Promise.reject(err);
    }
    const msg = err.response?.data?.error || err.message || '请求失败';
    ElMessage.error(msg);
    return Promise.reject(err);
  }
);

export default http;
