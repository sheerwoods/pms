<template>
  <el-dialog
    :model-value="visible"
    title="门锁制卡"
    width="560px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
    @open="onOpen"
    @closed="reset"
  >
    <div v-loading="loading" class="card-write">
      <template v-if="targets.length">
        <el-form label-width="96px" size="default">
          <el-form-item v-if="targets.length > 1" label="制卡房间">
            <el-select v-model="index" style="width: 100%" @change="fillForm">
              <el-option
                v-for="(t, i) in targets"
                :key="t.room_id"
                :label="`${t.room_no || t.room_id}${t.lock_no ? '（' + t.lock_no + '）' : ''}`"
                :value="i"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="门锁房号">
            <span class="lock-no">{{ current.lock_no || '—' }}</span>
            <span class="lock-room">对应房号 {{ current.room_no || '-' }}</span>
          </el-form-item>
          <el-form-item label="卡类型">
            <el-radio-group v-model="form.card_type">
              <el-radio :value="0">新卡</el-radio>
              <el-radio :value="1">复制卡</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="有效期">
            <el-date-picker
              v-model="form.begin_time"
              type="datetime"
              placeholder="开始时间"
              format="YYYY-MM-DD HH:mm"
              value-format="YYYY-MM-DD HH:mm"
              style="width: 190px"
            />
            <span class="sep">至</span>
            <el-date-picker
              v-model="form.end_time"
              type="datetime"
              placeholder="结束时间（可空=不限）"
              format="YYYY-MM-DD HH:mm"
              value-format="YYYY-MM-DD HH:mm"
              style="width: 190px"
            />
          </el-form-item>
        </el-form>

        <el-alert v-if="result" type="success" :closable="false" show-icon class="result">
          <template #title>
            制卡成功：卡号 <b>{{ result.card_no }}</b>，门锁房号 {{ result.lock_no }}，
            {{ result.begin_time }} ~ {{ result.end_time || '不限' }}
          </template>
        </el-alert>
        <el-alert v-if="error" type="warning" :closable="false" show-icon class="result" :title="error" />
      </template>
      <el-empty v-else description="没有可制卡的房间" />
    </div>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">关闭</el-button>
      <el-button plain @click="$emit('read')">读卡</el-button>
      <el-button type="primary" :loading="saving" :disabled="!targets.length" @click="submit">制卡</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';

const props = defineProps({
  visible: Boolean,
  // { reservation_id, check_in_date, check_in_time?, is_hourly?, check_out_date,
  //   default_window?, rooms: [{ unit_id, room_id, room_no?, check_out_date? }] }
  // default_window=true：非在住房间，有效期默认 当前 ~ 次日 16:00
  payload: { type: Object, default: null },
});
const emit = defineEmits(['update:visible', 'saved', 'read']);

const loading = ref(false);
const saving = ref(false);
const roomMap = ref({});
const index = ref(0);
const error = ref('');
const result = ref(null);
const form = reactive({ card_type: 0, begin_time: '', end_time: '' });

const targets = computed(() => {
  const rooms = (props.payload && props.payload.rooms) || [];
  return rooms.map((r) => {
    const info = roomMap.value[r.room_id] || {};
    return {
      ...r,
      room_no: r.room_no || info.room_no || '',
      lock_no: info.lock_no || info.auto_lock_no || '',
    };
  });
});
const current = computed(() => targets.value[index.value] || {});

async function loadRoomMap() {
  loading.value = true;
  try {
    const rows = await http.get('/card/rooms');
    const m = {};
    rows.forEach((r) => { m[r.id] = r; });
    roomMap.value = m;
  } catch (e) { /* 已提示 */ } finally { loading.value = false; }
}

async function onOpen() {
  error.value = '';
  result.value = null;
  index.value = 0;
  if (!Object.keys(roomMap.value).length) await loadRoomMap();
  fillForm();
}

// 钟点房固定时长（小时），与订单/房态展示一致
const HOURLY_HOURS = 3;

function pad(n) { return String(n).padStart(2, '0'); }
function dateTimeStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function addHours(s, h) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m) return '';
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  d.setHours(d.getHours() + h);
  return dateTimeStr(d);
}

function fillForm() {
  const p = props.payload || {};
  const c = current.value;
  const hourly = !!p.is_hourly;
  form.card_type = 0;
  // 非在住房间：默认有效期 当前 ~ 次日 16:00
  if (p.default_window) {
    form.begin_time = dateTimeStr(new Date());
    form.end_time = nextDay16();
    return;
  }
  // 开始时间：实际入住时刻 > 钟点房取当前时刻 > 入住日 14:00
  form.begin_time = p.check_in_time || (hourly ? dateTimeStr(new Date()) : (p.check_in_date ? `${p.check_in_date} 14:00` : ''));
  if (hourly) {
    // 结束时间：钟点房 = 入住时刻起 3 小时
    form.end_time = addHours(form.begin_time, HOURLY_HOURS);
  } else {
    const out = c.check_out_date || p.check_out_date;
    // 全日房离店时间默认下午 4 点
    form.end_time = out ? `${out} 16:00` : '';
  }
}

// 次日 16:00
function nextDay16() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 16:00`;
}

async function submit() {
  const c = current.value;
  if (!c.room_id) return ElMessage.warning('缺少房间');
  saving.value = true;
  error.value = '';
  result.value = null;
  try {
    const r = await http.post('/card/write-guest', {
      reservation_id: props.payload.reservation_id,
      unit_id: c.unit_id || null,
      room_id: c.room_id,
      card_type: form.card_type,
      begin_time: form.begin_time,
      end_time: form.end_time,
    });
    result.value = r;
    ElMessage.success(`制卡成功，卡号 ${r.card_no}`);
    emit('saved');
    // 多间时自动切到下一间未制卡房间
    if (targets.value.length > 1 && index.value < targets.value.length - 1) {
      index.value += 1;
      fillForm();
    }
  } catch (e) {
    error.value = e.response?.data?.error || e.message || '制卡失败';
  } finally {
    saving.value = false;
  }
}

function reset() {
  error.value = '';
  result.value = null;
  index.value = 0;
  Object.assign(form, { card_type: 0, begin_time: '', end_time: '' });
}
</script>

<style scoped>
.card-write { min-height: 140px; }
.lock-no { font-size: 18px; font-weight: 800; color: #1c7ed6; letter-spacing: 1px; }
.lock-room { margin-left: 12px; font-size: 13px; color: #868e96; }
.sep { margin: 0 8px; color: #909399; }
.result { margin-top: 8px; }
</style>
