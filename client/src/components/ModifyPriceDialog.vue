<template>
  <el-dialog
    :model-value="visible"
    title="子单房价 / 改预离日"
    width="620px"
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
    @closed="reset"
    class="modify-price-dialog"
  >
    <div v-if="reservation && unit" class="mpd-body">
      <div class="mpd-unit">
        <span class="mpd-k">房间</span>
        <b>{{ unit.room_no || '待排房' }}</b>
        <span class="mpd-rk">入住 {{ startDate }}</span>
      </div>
      <div class="mpd-form">
        <div class="mpd-row">
          <span class="mpd-k">预离日</span>
          <el-date-picker
            v-model="checkOut"
            type="date"
            value-format="YYYY-MM-DD"
            :clearable="false"
            :disabled="isHourly"
            :disabled-date="disabledDeparture"
            size="small"
            style="width: 190px"
            @change="onCheckOutChange"
          />
          <span class="mpd-hint">{{ isHourly ? '钟点房固定住当日' : '仅作用于本子单，不影响其他房间' }}</span>
        </div>
      </div>

      <el-table :data="rows" size="default" border class="mpd-table" max-height="300">
        <el-table-column label="日期" width="150">
          <template #default="{ row }">{{ row.date }}</template>
        </el-table-column>
        <el-table-column label="星期" width="110">
          <template #default="{ row }">{{ weekday(row.date) }}</template>
        </el-table-column>
        <el-table-column label="价格" min-width="220">
          <template #default="{ row, $index }">
            <el-button text :icon="Bottom" class="mpd-down" title="应用到之后日期" @click="applyDown($index)" />
            <el-input-number v-model="row.price" :min="0" :precision="2" :controls="false" size="small" style="width: 130px" />
          </template>
        </el-table-column>
      </el-table>

      <div class="mpd-form">
        <div class="mpd-row">
          <span class="mpd-k">改价原因</span>
          <el-input v-model="reason" size="small" placeholder="改价原因（选填）" clearable />
        </div>
        <div class="mpd-row">
          <span class="mpd-k">备注</span>
          <el-input v-model="remark" type="textarea" :rows="2" size="small" placeholder="备注（选填）" />
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">确认</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { Bottom } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { nightsBetween, addDays } from '../utils/format';

const props = defineProps({
  visible: Boolean,
  reservation: { type: Object, default: null },
  unit: { type: Object, default: null }, // 当前操作的房间子单（reservation_rooms 行）
});
const emit = defineEmits(['update:visible', 'saved']);

const rows = ref([]);
const checkOut = ref('');
const reason = ref('');
const remark = ref('');
const saving = ref(false);

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
function weekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return '星期' + WEEKDAYS[d.getDay()];
}

const isHourly = computed(() => props.reservation?.booking_type === '钟点房');
const startDate = computed(() => {
  const r = props.reservation;
  if (!r) return '';
  return (r.actual_check_in ? String(r.actual_check_in).slice(0, 10) : r.check_in_date) || '';
});

function safeLines(r) {
  try {
    const a = JSON.parse(r.lines || '[]');
    if (Array.isArray(a) && a.length) return a;
  } catch { /* fall through */ }
  return [{ room_type_id: r.room_type_id || null, rooms: r.rooms || 1, rate: r.rate || 0, rates: r.rates || '{}' }];
}
function parseRatesMap(v) {
  if (Array.isArray(v)) {
    const m = {};
    v.forEach((x) => { if (x && x.date) m[x.date] = Number(x.price) || 0; });
    return m;
  }
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || '{}'); } catch { return {}; }
}

// 本子单的线路（用于回退线路价）
function unitLine() {
  const r = props.reservation, u = props.unit;
  if (!r || !u) return {};
  const lines = safeLines(r);
  return lines[u.line_index ?? 0] || lines[0] || {};
}

// 构建本子单的逐晚价目：子单逐晚覆盖 → 子单单值覆盖 → 线路当晚价 → 线路价
function buildRows(preserve = false) {
  const r = props.reservation, u = props.unit;
  if (!r || !u) { rows.value = []; return; }
  const start = startDate.value;
  let end = checkOut.value || u.check_out_date || r.check_out_date;
  if (isHourly.value) end = start;
  const n = isHourly.value ? 1 : Math.max(1, nightsBetween(start, end));
  const ln = unitLine();
  const unitMap = parseRatesMap(u.rates);
  const lineMap = parseRatesMap(ln.rates);
  const unitRate = Number(u.rate) > 0 ? Number(u.rate) : 0;
  const prev = {};
  if (preserve) rows.value.forEach((x) => { prev[x.date] = x.price; });
  const arr = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(start, i);
    const price = prev[d] != null ? prev[d]
      : unitMap[d] != null ? Number(unitMap[d])
      : unitRate > 0 ? unitRate
      : lineMap[d] != null ? Number(lineMap[d])
      : (Number(ln.rate) || 0);
    arr.push({ date: d, price });
  }
  rows.value = arr;
}

function disabledDeparture(d) {
  const start = startDate.value;
  if (!start) return false;
  const s = new Date(start + 'T00:00:00').getTime();
  return d.getTime() <= s;
}

// 改预离日：保留已填价格，按新跨度增减晚次
function onCheckOutChange() {
  if (isHourly.value) return;
  if (!checkOut.value || checkOut.value <= startDate.value) {
    checkOut.value = addDays(startDate.value, 1);
    return;
  }
  buildRows(true);
}

// 将某行价格应用到之后的所有日期
function applyDown(idx) {
  const p = Number(rows.value[idx]?.price) || 0;
  for (let i = idx + 1; i < rows.value.length; i++) rows.value[i].price = p;
}

async function save() {
  const r = props.reservation, u = props.unit;
  if (!r || !u) return;
  if (!rows.value.length) return ElMessage.warning('没有可修改的日期');
  if (!isHourly.value && (!checkOut.value || checkOut.value <= startDate.value)) {
    return ElMessage.warning('离店日期必须晚于入住日期');
  }

  const noteParts = [];
  if (reason.value) noteParts.push(`改价原因：${reason.value}`);
  if (remark.value) noteParts.push(remark.value);
  const app = noteParts.join('；');
  const baseRemark = u.remark || '';
  const newRemark = app ? (baseRemark ? `${baseRemark}；${app}` : app) : baseRemark;

  const payload = {
    rates: rows.value.map((x) => ({ date: x.date, price: Number(x.price) || 0 })),
    remark: newRemark,
  };
  if (!isHourly.value) payload.check_out_date = checkOut.value;

  saving.value = true;
  try {
    await http.put(`/reservations/${r.id}/rooms/${u.id}/room-info`, payload);
    ElMessage.success('子单房价已修改');
    emit('update:visible', false);
    emit('saved');
  } catch (e) { /* 拦截器已提示 */ } finally { saving.value = false; }
}

function reset() { rows.value = []; checkOut.value = ''; reason.value = ''; remark.value = ''; }

watch(
  () => props.visible,
  (v) => {
    if (!v) return;
    const r = props.reservation, u = props.unit;
    checkOut.value = (u && (u.check_out_date || r?.check_out_date)) || '';
    reason.value = ''; remark.value = '';
    buildRows();
  }
);
</script>

<style scoped>
.mpd-body { display: flex; flex-direction: column; gap: 14px; }
.mpd-unit { display: flex; align-items: center; gap: 10px; color: #495057; font-size: 14px; }
.mpd-unit b { color: #1c7ed6; font-size: 15px; }
.mpd-unit .mpd-rk { color: #909399; font-size: 13px; }
.mpd-table :deep(.el-table__header th) { background: #eaf2fb; color: #303133; }
.mpd-down { margin-right: 6px; color: #1c7ed6; }
.mpd-form { display: flex; flex-direction: column; gap: 12px; }
.mpd-row { display: flex; align-items: center; gap: 12px; }
.mpd-row .mpd-k { width: 60px; color: #303133; font-size: 14px; line-height: 32px; flex-shrink: 0; }
.mpd-row .el-input, .mpd-row .el-textarea { flex: 1; }
.mpd-row .mpd-hint { color: #909399; font-size: 12px; }
</style>

<style>
.modify-price-dialog.el-dialog { border-radius: 12px; overflow: hidden; }
</style>
