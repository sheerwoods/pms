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
          <el-menu-item index="/settings">
            <el-icon><Setting /></el-icon><span>系统设置</span>
          </el-menu-item>
        </el-menu>
      </div>
      <div class="header-right">
        <div class="today-stats" v-if="store.stats">
          <div class="stat"><span class="num">{{ store.stats.arrivals }}</span>今日到店</div>
          <div class="stat"><span class="num warn">{{ store.stats.departures }}</span>今日离店</div>
          <div class="stat"><span class="num blue">{{ store.stats.in_house }}</span>在住</div>
          <div class="stat"><span class="num gray">{{ store.stats.vacant }}</span>空房</div>
          <div class="stat"><span class="num">{{ store.stats.occupancy_rate }}%</span>入住率</div>
          <div class="stat"><span class="num money">{{ fmtMoney(store.stats.revenue) }}</span>今日营收</div>
        </div>
        <el-popover v-model:visible="naVisible" :width="320" trigger="click" placement="bottom">
          <template #reference>
            <el-button class="na-trigger" text>
              <el-icon><Moon /></el-icon>
              <span>夜审</span>
            </el-button>
          </template>
          <div class="na-panel">
            <div class="na-head">夜审系统</div>
            <div class="na-row">
              <span class="na-label">夜审时间</span>
              <el-time-select v-model="naAuditTime" start="00:00" step="00:30" end="23:30" style="width: 120px" @change="saveAuditTime" />
            </div>
            <div class="na-row"><span class="na-label">当前营业日</span><span class="na-val">{{ na.business_date || '—' }}</span></div>
            <div class="na-row"><span class="na-label">上次夜审</span><span class="na-val">{{ na.last_audit_date || '—' }}</span></div>
            <div class="na-row"><span class="na-label">待补计晚次</span><span class="na-val">{{ na.pending_items ?? 0 }}</span></div>
            <div class="na-row"><span class="na-label">涉及房间</span><span class="na-val">{{ na.pending_units ?? 0 }} 间</span></div>
            <el-button type="primary" style="width: 100%; margin-top: 10px" :loading="naRunning" @click="runAudit">
              立即执行夜审
            </el-button>
          </div>
        </el-popover>
      </div>
    </el-header>
    <el-main class="main">
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup>
import { ref, reactive, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { store } from './store';
import http from './api';
import { fmtMoney } from './utils/format';
import { loadDicts } from './utils/dict';

const route = useRoute();

const naVisible = ref(false);
const naRunning = ref(false);
const naAuditTime = ref('06:00');
const na = reactive({
  audit_time: '06:00',
  business_date: null,
  last_audit_date: null,
  pending_units: 0,
  pending_items: 0,
});

async function loadNightAudit() {
  try {
    const data = await http.get('/night-audit');
    na.audit_time = data.audit_time;
    na.business_date = data.business_date;
    na.last_audit_date = data.last_audit_date;
    na.pending_units = data.pending_units;
    na.pending_items = data.pending_items;
    naAuditTime.value = data.audit_time;
  } catch (e) { /* 忽略 */ }
}

async function saveAuditTime() {
  try {
    await http.put('/night-audit', { audit_time: naAuditTime.value });
    ElMessage.success('夜审时间已更新');
  } catch (e) { /* 接口已提示 */ }
  loadNightAudit();
}

async function runAudit() {
  naRunning.value = true;
  try {
    const r = await http.post('/night-audit/run');
    ElMessage.success(r.posted_items > 0 ? `夜审完成，补计 ${r.posted_items} 笔房费` : '夜审完成，无待补计房费');
    naVisible.value = false;
    store.loadStats();
    await loadNightAudit();
  } finally {
    naRunning.value = false;
  }
}

onMounted(() => {
  store.loadStats();
  loadNightAudit();
  loadDicts();
});
watch(() => route.fullPath, () => store.loadStats());
</script>
