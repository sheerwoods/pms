import { createRouter, createWebHistory } from 'vue-router';
import { auth, fetchMe } from '../utils/auth';

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue'), meta: { public: true, title: '登录' } },
  { path: '/', redirect: '/room-status' },
  { path: '/room-status', name: 'room-status', component: () => import('../views/RoomStatus.vue'), meta: { title: '房态图' } },
  { path: '/orders', name: 'orders', component: () => import('../views/Orders.vue'), meta: { title: '订单管理' } },
  { path: '/finance', name: 'finance', component: () => import('../views/Finance.vue'), meta: { title: '账务管理' } },
  { path: '/settings', name: 'settings', component: () => import('../views/Settings.vue'), meta: { title: '系统设置' } },
];

const router = createRouter({ history: createWebHistory(), routes });

// 未登录一律回登录页（auth 不依赖 router，静态引入即可）
router.beforeEach(async (to) => {
  if (to.meta.public) return true;
  if (!auth.checked) await fetchMe();
  if (auth.user) return true;
  return { path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} };
});

export default router;
