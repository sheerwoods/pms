<template>
  <el-container class="app-root">
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
        </el-menu>
      </div>
      <div class="today-stats" v-if="store.stats">
        <div class="stat"><span class="num">{{ store.stats.arrivals }}</span>今日到店</div>
        <div class="stat"><span class="num warn">{{ store.stats.departures }}</span>今日离店</div>
        <div class="stat"><span class="num blue">{{ store.stats.in_house }}</span>在住</div>
        <div class="stat"><span class="num gray">{{ store.stats.vacant }}</span>空房</div>
        <div class="stat"><span class="num">{{ store.stats.occupancy_rate }}%</span>入住率</div>
        <div class="stat"><span class="num money">{{ fmtMoney(store.stats.revenue) }}</span>今日营收</div>
      </div>
    </el-header>
    <el-main class="main">
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup>
import { onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { store } from './store';
import { fmtMoney } from './utils/format';

const route = useRoute();

onMounted(() => store.loadStats());
watch(() => route.fullPath, () => store.loadStats());
</script>
