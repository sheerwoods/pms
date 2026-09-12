<template>
  <router-view v-if="isPublic" />
  <el-container v-else class="app-root">
    <el-header class="header">
      <div class="header-left">
        <div class="logo">
          <el-icon :size="24"><Hotel /></el-icon>
          <span>酒店 PMS</span>
        </div>
        <el-menu :default-active="$route.path" router mode="horizontal" class="top-menu" :ellipsis="false">
          <el-menu-item index="/room-status">
            <el-icon><Grid /></el-icon><span>房态图</span>
          </el-menu-item>
          <el-menu-item index="/orders">
            <el-icon><Tickets /></el-icon><span>订单管理</span>
          </el-menu-item>
          <el-menu-item index="/finance">
            <el-icon><Money /></el-icon><span>账务管理</span>
          </el-menu-item>
          <el-menu-item index="/settings">
            <el-icon><Setting /></el-icon><span>系统设置</span>
          </el-menu-item>
        </el-menu>
      </div>
      <div class="header-right">
        <el-button class="read-card-trigger" text @click="readCardVisible = true">
          <el-icon><CreditCard /></el-icon>
          <span>读卡</span>
        </el-button>
        <el-dropdown v-if="auth.user" trigger="click" @command="onUserCommand">
          <span class="user-trigger">
            <el-icon><UserFilled /></el-icon>
            <span class="user-shop">{{ auth.shop?.name }}</span>
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-header>
    <el-main class="main">
      <router-view />
    </el-main>
    <CardReadDialog v-model:visible="readCardVisible" />
  </el-container>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { loadDicts } from './utils/dict';
import { auth, logout } from './utils/auth';
import CardReadDialog from './components/CardReadDialog.vue';

const route = useRoute();
// 登录页等公开路由不渲染应用框架（否则会先发出未登录请求）
const isPublic = computed(() => route.meta.public === true);

async function onUserCommand(cmd) {
  if (cmd !== 'logout') return;
  try {
    await ElMessageBox.confirm('确定退出登录？', '提示', { type: 'warning' });
  } catch {
    return;
  }
  await logout();
}

const readCardVisible = ref(false);

// 登录后才加载门店数据；登出/切店时由 auth 清空缓存
watch(() => auth.user, (u) => {
  if (!u) return;
  loadDicts(true);
}, { immediate: true });
</script>
