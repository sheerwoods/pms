<template>
  <div class="night-audit">
    <p class="na-hint">
      夜审将已过夜但未入账的房费按营业日补计，并把营业日推进到下一天。可设置每日自动夜审时间，或在此手动立即执行。
    </p>
    <div class="na-panel">
      <div class="na-row">
        <span class="na-label">夜审时间</span>
        <el-time-select v-model="auditTime" start="00:00" step="00:30" end="23:30" style="width: 140px" @change="saveAuditTime" />
      </div>
      <div class="na-row"><span class="na-label">当前营业日</span><span class="na-val">{{ na.business_date || '—' }}</span></div>
      <div class="na-row"><span class="na-label">上次夜审</span><span class="na-val">{{ na.last_audit_date || '—' }}</span></div>
      <div class="na-row"><span class="na-label">待补计晚次</span><span class="na-val">{{ na.pending_items ?? 0 }}</span></div>
      <div class="na-row"><span class="na-label">涉及房间</span><span class="na-val">{{ na.pending_units ?? 0 }} 间</span></div>
      <el-button type="primary" :loading="running" style="width: 200px; margin-top: 6px" @click="runAudit">
        立即执行夜审
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';

const running = ref(false);
const auditTime = ref('06:00');
const na = reactive({
  business_date: null,
  last_audit_date: null,
  pending_units: 0,
  pending_items: 0,
});

async function load() {
  try {
    const d = await http.get('/night-audit');
    na.business_date = d.business_date;
    na.last_audit_date = d.last_audit_date;
    na.pending_units = d.pending_units;
    na.pending_items = d.pending_items;
    auditTime.value = d.audit_time;
  } catch (e) { /* 忽略 */ }
}

async function saveAuditTime() {
  try {
    await http.put('/night-audit', { audit_time: auditTime.value });
    ElMessage.success('夜审时间已更新');
  } catch (e) { /* 接口已提示 */ }
  load();
}

async function runAudit() {
  running.value = true;
  try {
    const r = await http.post('/night-audit/run');
    ElMessage.success(r.posted_items > 0 ? `夜审完成，补计 ${r.posted_items} 笔房费` : '夜审完成，无待补计房费');
    await load();
  } finally {
    running.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.na-hint { font-size: 13px; color: #868e96; line-height: 1.6; margin: 0 0 14px; }
.na-panel .na-row { padding: 2px 0; }
</style>
