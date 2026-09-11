<template>
  <div class="card-manager">
    <el-card shadow="never" class="block">
      <template #header><span class="block-title">管理卡制卡</span></template>
      <el-form :model="form" label-width="96px" class="mgr-form">
        <el-form-item label="卡片类型">
          <el-select v-model="form.action" style="width: 200px">
            <el-option v-for="(label, key) in ACTIONS" :key="key" :label="label" :value="key" />
          </el-select>
        </el-form-item>

        <el-form-item v-if="needLimited.includes(form.action)" label="有效期">
          <el-date-picker
            v-model="form.limited_time"
            type="datetime"
            placeholder="留空=不限时间"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DD HH:mm"
            style="width: 220px"
          />
        </el-form-item>

        <template v-if="form.action === 'multi_floor'">
          <el-form-item label="楼号">
            <el-input-number v-model="form.building_no" :min="1" :max="99" :controls="false" style="width: 90px" />
          </el-form-item>
          <el-form-item label="楼层范围">
            <el-input-number v-model="form.floor1" :min="1" :max="99" :controls="false" style="width: 90px" />
            <span class="sep">至</span>
            <el-input-number v-model="form.floor2" :min="1" :max="99" :controls="false" style="width: 90px" />
          </el-form-item>
        </template>

        <el-form-item v-if="['multi_floor', 'employee'].includes(form.action)" label="特殊房号">
          <el-input v-model="form.special_room_list" placeholder="最多9位，如 379000000" maxlength="9" @input="onSpecial" />
        </el-form-item>

        <el-form-item v-if="form.action === 'clock'" label="对时时间">
          <el-date-picker
            v-model="form.time"
            type="datetime"
            placeholder="留空=当前时间"
            format="YYYY-MM-DD HH:mm"
            value-format="YYYY-MM-DD HH:mm"
            style="width: 220px"
          />
        </el-form-item>

        <template v-if="['room_lock_no', 'passage_lock_no', 'special_room_lock_no'].includes(form.action)">
          <el-form-item label="锁号房号">
            <el-select v-model="form.room_id" filterable placeholder="选择房间（按门锁房号制卡）" style="width: 240px">
              <el-option
                v-for="r in rooms"
                :key="r.id"
                :label="`${r.room_no}（${r.lock_no || r.auto_lock_no}）`"
                :value="r.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item v-if="form.action === 'passage_lock_no'" label="通道类型">
            <el-select v-model="form.passage_type" style="width: 160px">
              <el-option label="层通道" :value="1" />
              <el-option label="楼通道" :value="2" />
              <el-option label="总通道" :value="3" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="form.action === 'passage_lock_no'" label="特殊房号">
            <el-input v-model="form.special_room_list" placeholder="最多9位" maxlength="9" @input="onSpecial" />
          </el-form-item>
          <el-form-item v-if="form.action === 'special_room_lock_no'" label="特殊房类型">
            <el-input-number v-model="form.special_room_type" :min="1" :max="9" style="width: 90px" />
          </el-form-item>
        </template>

        <el-form-item v-if="['report_loss', 'release'].includes(form.action)" label="卡号">
          <el-input-number v-model="form.card_no" :min="0" :controls="false" style="width: 140px" />
          <span class="hint">{{ form.action === 'report_loss' ? '被挂失的卡号' : '被解挂的卡号' }}</span>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="saving" @click="submit">制卡</el-button>
        </el-form-item>
      </el-form>

      <el-alert v-if="result" type="success" :closable="false" show-icon class="mb"
        :title="result.sn != null ? `卡片序列号：${result.sn}` : `制卡成功，卡号 ${result.card_no}`" />
      <el-alert v-if="error" type="warning" :closable="false" show-icon class="mb" :title="error" />
    </el-card>

    <el-card shadow="never" class="block">
      <template #header>
        <div class="log-head">
          <span class="block-title">制卡记录</span>
          <div class="log-filter">
            <el-select v-model="query.action" placeholder="全部类型" clearable size="small" style="width: 130px" @change="loadLogs">
              <el-option v-for="(label, key) in ACTION_LABELS" :key="key" :label="label" :value="key" />
            </el-select>
            <el-input v-model="query.keyword" placeholder="房号/卡号/姓名" clearable size="small" style="width: 180px" @keyup.enter="loadLogs" />
            <el-button size="small" plain @click="loadLogs">查询</el-button>
          </div>
        </div>
      </template>
      <el-table :data="logs" size="small" border :header-cell-style="{ background: '#f5f7fa', color: '#606266' }">
        <el-table-column prop="created_at" label="时间" width="150" />
        <el-table-column label="类型" width="90">
          <template #default="{ row }">{{ ACTION_LABELS[row.action] || row.action }}</template>
        </el-table-column>
        <el-table-column prop="room_no" label="房号" width="80" />
        <el-table-column prop="lock_no" label="门锁房号" width="100" />
        <el-table-column prop="guest_name" label="客人" min-width="90" />
        <el-table-column prop="card_no" label="卡号" width="80" />
        <el-table-column label="结果" min-width="150">
          <template #default="{ row }">
            <span :class="row.result_code === 0 ? 'ok' : 'fail'">{{ row.result_code === 0 ? '成功' : row.result_msg || ('失败 ' + row.result_code) }}</span>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          layout="total, prev, pager, next"
          :total="total"
          :page-size="query.pageSize"
          :current-page="query.page"
          @current-change="(p) => { query.page = p; loadLogs(); }"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';

const ACTIONS = {
  master: '总控卡', emergency: '紧急卡', multi_floor: '楼层卡', employee: '员工卡',
  clock: '对时卡', room_lock_no: '房号（锁号）卡', passage_lock_no: '通道锁号卡',
  special_room_lock_no: '特殊房锁号卡', report_loss: '挂失卡', release: '解挂卡',
  clear: '清卡', card_sn: '读卡序列号',
};
const ACTION_LABELS = { guest: '客人卡', checkout: '退房卡', checkout2: '退房卡', ...ACTIONS };
const needLimited = ['master', 'emergency', 'multi_floor', 'employee'];

const rooms = ref([]);
const saving = ref(false);
const error = ref('');
const result = ref(null);
const logs = ref([]);
const total = ref(0);
const query = reactive({ page: 1, pageSize: 15, action: '', keyword: '' });

const form = reactive({
  action: 'master', limited_time: '', building_no: 1, floor1: 1, floor2: 1,
  special_room_list: '', time: '', room_id: null, passage_type: 1,
  special_room_type: 1, card_no: null,
});

function onSpecial(v) {
  form.special_room_list = String(v || '').replace(/\D/g, '').slice(0, 9);
}

async function loadRooms() {
  try { rooms.value = await http.get('/card/rooms'); } catch (e) { /* 已提示 */ }
}

async function loadLogs() {
  try {
    const r = await http.get('/card/logs', { params: { page: query.page, pageSize: query.pageSize, action: query.action || undefined, keyword: query.keyword || undefined } });
    logs.value = r.list;
    total.value = r.total;
  } catch (e) { /* 已提示 */ }
}

function buildBody() {
  const b = { action: form.action };
  if (needLimited.includes(form.action)) b.limited_time = form.limited_time;
  if (form.action === 'multi_floor') {
    b.building_no = form.building_no; b.floor1 = form.floor1; b.floor2 = form.floor2;
    b.special_room_list = form.special_room_list;
  }
  if (form.action === 'employee') b.special_room_list = form.special_room_list;
  if (form.action === 'clock') b.time = form.time;
  if (['room_lock_no', 'passage_lock_no', 'special_room_lock_no'].includes(form.action)) b.room_id = form.room_id;
  if (form.action === 'passage_lock_no') { b.passage_type = form.passage_type; b.special_room_list = form.special_room_list; }
  if (form.action === 'special_room_lock_no') b.special_room_type = form.special_room_type;
  if (['report_loss', 'release'].includes(form.action)) b.card_no = form.card_no;
  return b;
}

function validate() {
  if (['room_lock_no', 'passage_lock_no', 'special_room_lock_no'].includes(form.action) && !form.room_id) {
    return '请选择房间';
  }
  if (['report_loss', 'release'].includes(form.action) && (form.card_no == null || form.card_no === '')) {
    return '请填写卡号';
  }
  return '';
}

async function submit() {
  const msg = validate();
  if (msg) return ElMessage.warning(msg);
  if (form.action === 'clear') {
    try {
      await ElMessageBox.confirm('清卡将清除卡片数据，确认继续？', '提示', { type: 'warning' });
    } catch (e) { return; }
  }
  saving.value = true;
  error.value = '';
  result.value = null;
  try {
    const r = await http.post('/card/management', buildBody());
    result.value = r;
    ElMessage.success(r.sn != null ? `卡片序列号 ${r.sn}` : `制卡成功，卡号 ${r.card_no}`);
    loadLogs();
  } catch (e) {
    error.value = e.response?.data?.error || e.message || '操作失败';
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadRooms();
  loadLogs();
});
</script>

<style scoped>
.card-manager { display: flex; flex-direction: column; gap: 16px; }
.block-title { font-weight: 600; }
.mgr-form { max-width: 620px; }
.sep { margin: 0 8px; color: #909399; }
.hint { margin-left: 10px; font-size: 12px; color: #909399; }
.mb { margin-top: 8px; }
.log-head { display: flex; align-items: center; justify-content: space-between; }
.log-filter { display: flex; gap: 8px; }
.pager { display: flex; justify-content: flex-end; margin-top: 10px; }
.ok { color: #2f9e44; }
.fail { color: #e03131; }
</style>
