import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  { path: '/', redirect: '/room-status' },
  { path: '/room-status', name: 'room-status', component: () => import('../views/RoomStatus.vue'), meta: { title: '房态图' } },
  { path: '/orders', name: 'orders', component: () => import('../views/Orders.vue'), meta: { title: '订单管理' } },
  { path: '/finance', name: 'finance', component: () => import('../views/Finance.vue'), meta: { title: '账务管理' } },
  { path: '/settings', name: 'settings', component: () => import('../views/Settings.vue'), meta: { title: '系统设置' } },
];

export default createRouter({ history: createWebHistory(), routes });
