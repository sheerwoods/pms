<template>
  <div class="card-settings">
    <el-alert
      v-if="config && !config.available"
      type="warning"
      :closable="false"
      show-icon
      :title="config.error || '制卡设备不可用，请检查 vendor/es200601 与写卡器连接'"
      class="mb"
    />

    <el-form :model="form" label-width="92px" class="cfg-form">
      <el-form-item label="启用制卡">
        <el-switch v-model="form.enabled" />
      </el-form-item>
      <el-form-item label="写卡器串口">
        <el-input-number v-model="form.port" :min="0" :max="99" :controls="false" style="width: 90px" />
        <span class="hint">0 = 不设置，沿用门锁系统自身的发卡机配置；如需强制指定，填 3 表示 COM3</span>
      </el-form-item>
      <el-form-item label="楼号">
        <el-input v-model="form.building" maxlength="2" style="width: 90px" />
        <span class="hint">门锁房号的 2 位楼号（房号自动映射时使用，默认 01）</span>
      </el-form-item>
      <el-form-item label="副房号">
        <el-input-number v-model="form.sub" :min="0" :max="9" :controls="false" style="width: 90px" />
        <span class="hint">门锁房号末位；厂商系统实际按 1 起编，默认 1（如 8801 → 0108011）</span>
      </el-form-item>
      <el-form-item label="数据库账号">
        <el-input v-model="form.db_user" placeholder="留空=厂商默认账号" style="width: 180px" />
      </el-form-item>
      <el-form-item label="数据库密码">
        <el-input
          v-model="form.db_password"
          type="password"
          show-password
          :placeholder="config && config.db_password_set ? '已设置（留空不修改）' : '留空=厂商默认、无密码'"
          style="width: 220px"
          @input="passwordTouched = true"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="saveConfig">保存设置</el-button>
        <el-button plain @click="loadConfig">刷新状态</el-button>
        <span class="version" v-if="config">
          DLL 版本：{{ config.available ? config.version : '不可用' }}
        </span>
      </el-form-item>
    </el-form>

    <el-divider content-position="left">房间门锁房号</el-divider>
    <div class="rooms-head">
      <span class="hint">「自动生成」按 楼号2 + 楼层2 + 房号后2位 + 副房号 生成；如需特殊编码可在「覆盖」列手工填写 7 位数字。</span>
    </div>
    <el-table :data="rooms" size="small" border max-height="420" :header-cell-style="{ background: '#f5f7fa', color: '#606266' }">
      <el-table-column prop="room_no" label="房号" width="90" />
      <el-table-column prop="floor" label="楼层" width="70" align="center" />
      <el-table-column prop="type_name" label="房型" min-width="120" />
      <el-table-column prop="auto_lock_no" label="自动生成" width="110" align="center" />
      <el-table-column label="覆盖（7位）" width="170">
        <template #default="{ row }">
          <el-input v-model="row.lock_no" size="small" maxlength="7" placeholder="留空=自动" @input="(v) => (row.lock_no = String(v || '').replace(/\D/g, '').slice(0, 7))" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" align="center">
        <template #default="{ row }">
          <el-button text type="primary" size="small" @click="saveRoom(row)">保存</el-button>
          <el-button v-if="row.lock_no" text type="info" size="small" @click="clearRoom(row)">清除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';

const config = ref(null);
const rooms = ref([]);
const saving = ref(false);
const passwordTouched = ref(false);
const form = reactive({ enabled: true, port: 0, sub: 1, building: '01', db_user: '', db_password: '' });

async function loadConfig() {
  try {
    const c = await http.get('/card/config');
    config.value = c;
    form.enabled = !!c.enabled;
    form.port = c.port;
    form.sub = c.sub;
    form.building = c.building;
    form.db_user = c.db_user || '';
    form.db_password = '';
    passwordTouched.value = false;
  } catch (e) { /* 已提示 */ }
}

async function loadRooms() {
  try {
    rooms.value = await http.get('/card/rooms');
  } catch (e) { /* 已提示 */ }
}

async function saveConfig() {
  saving.value = true;
  try {
    const body = {
      enabled: form.enabled,
      port: form.port,
      sub: form.sub,
      building: form.building,
      db_user: form.db_user,
    };
    if (passwordTouched.value) body.db_password = form.db_password;
    await http.put('/card/config', body);
    ElMessage.success('设置已保存');
    await loadConfig();
  } finally {
    saving.value = false;
  }
}

async function saveRoom(row) {
  await http.put(`/card/rooms/${row.id}`, { lock_no: row.lock_no || '' });
  ElMessage.success(`房间 ${row.room_no} 门锁房号已保存`);
  await loadRooms();
}

async function clearRoom(row) {
  await http.put(`/card/rooms/${row.id}`, { lock_no: '' });
  ElMessage.success(`房间 ${row.room_no} 已恢复自动生成`);
  await loadRooms();
}

onMounted(() => {
  loadConfig();
  loadRooms();
});
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.cfg-form { max-width: 640px; }
.hint { margin-left: 10px; font-size: 12px; color: #909399; }
.version { margin-left: 12px; font-size: 12px; color: #868e96; }
.rooms-head { margin-bottom: 8px; }
</style>
