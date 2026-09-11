<template>
  <el-dialog
    :model-value="visible"
    title="修改房价"
    width="620px"
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
    @closed="reset"
    class="modify-price-dialog"
  >
    <div v-if="reservation" class="mpd-body">
      <el-table :data="rows" size="default" border class="mpd-table" max-height="320">
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
import { ref, watch } from 'vue';
import { Bottom } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { nightsBetween, addDays } from '../utils/format';

const props = defineProps({
  visible: Boolean,
  reservation: { type: Object, default: null },
});
const emit = defineEmits(['update:visible', 'saved']);

const rows = ref([]);
const reason = ref('');
const remark = ref('');
const saving = ref(false);

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
function weekday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return '星期' + WEEKDAYS[d.getDay()];
}

function safeLines(r) {
  try {
    const a = JSON.parse(r.lines || '[]');
    if (Array.isArray(a) && a.length) return a;
  } catch { /* fall through */ }
  return [{ room_type_id: r.room_type_id || null, rooms: r.rooms || 1, rate: r.rate || 0, rates: r.rates || '{}' }];
}
function parseRatesMap(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || '{}'); } catch { return {}; }
}

// 按首行房价表构建每晚列表（每夜一行）
function buildRows() {
  const r = props.reservation;
  if (!r) { rows.value = []; return; }
  const isHourly = r.booking_type === '钟点房';
  const ci = r.check_in_date;
  const n = isHourly ? 1 : (Number(r.nights) || nightsBetween(r.check_in_date, r.check_out_date) || 1);
  const first = safeLines(r)[0] || {};
  const map = parseRatesMap(first.rates);
  const arr = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(ci, i);
    arr.push({ date: d, price: map[d] != null ? Number(map[d]) : (Number(first.rate) || 0) });
  }
  rows.value = arr;
}

// 将某行价格应用到之后的所有日期
function applyDown(idx) {
  const p = Number(rows.value[idx]?.price) || 0;
  for (let i = idx + 1; i < rows.value.length; i++) rows.value[i].price = p;
}

async function save() {
  const r = props.reservation;
  if (!r) return;
  const ci = r.check_in_date;
  const co = r.check_out_date;
  const n = rows.value.length;
  if (!n) return ElMessage.warning('没有可修改的日期');

  let raw = [];
  try { raw = JSON.parse(r.lines || '[]'); } catch { /* */ }
  if (!Array.isArray(raw) || !raw.length) {
    raw = [{ room_type_id: r.room_type_id || null, rooms: r.rooms || 1, rate: Number(r.rate) || 0, rates: [] }];
  }
  // 归一化各线路每晚价格，保留除首行外的原价
  const lines = raw.map((ln) => {
    let map = {};
    if (typeof ln.rates === 'string') { try { map = JSON.parse(ln.rates) || {}; } catch { /* */ } }
    else if (Array.isArray(ln.rates)) { ln.rates.forEach((x) => { map[x.date] = x.price; }); }
    else if (ln.rates && typeof ln.rates === 'object') { map = ln.rates; }
    const rates = [];
    for (let i = 0; i < n; i++) {
      const d = addDays(ci, i);
      rates.push({ date: d, price: map[d] != null ? Number(map[d]) : (Number(ln.rate) || 0) });
    }
    return { room_type_id: ln.room_type_id || null, rooms: ln.rooms || 1, rate: Number(ln.rate) || 0, rates };
  });
  // 首行（订单房价）应用本弹窗的每晚新价
  if (lines[0]) {
    lines[0].rate = rows.value[0]?.price || 0;
    lines[0].rates = rows.value.map((x) => ({ date: x.date, price: x.price }));
  }

  const noteParts = [];
  if (reason.value) noteParts.push(`改价原因：${reason.value}`);
  if (remark.value) noteParts.push(remark.value);
  const app = noteParts.join('；');
  const newRemark = app ? (r.remark ? `${r.remark}；${app}` : app) : r.remark;

  saving.value = true;
  try {
    await http.put(`/reservations/${r.id}`, {
      check_in_date: ci,
      check_out_date: co,
      booking_type: r.booking_type,
      rate: lines[0]?.rate || 0,
      lines,
      remark: newRemark,
    });
    ElMessage.success('房价已修改');
    emit('update:visible', false);
    emit('saved');
  } catch (e) { /* 拦截器已提示 */ } finally { saving.value = false; }
}

function reset() { rows.value = []; reason.value = ''; remark.value = ''; }
watch(() => props.visible, (v) => { if (v) { buildRows(); reason.value = ''; remark.value = ''; } });
</script>

<style scoped>
.mpd-body { display: flex; flex-direction: column; gap: 16px; }
.mpd-table :deep(.el-table__header th) { background: #eaf2fb; color: #303133; }
.mpd-down { margin-right: 6px; color: #1c7ed6; }
.mpd-form { display: flex; flex-direction: column; gap: 12px; }
.mpd-row { display: flex; align-items: flex-start; gap: 12px; }
.mpd-row .mpd-k { width: 60px; color: #303133; font-size: 14px; line-height: 32px; flex-shrink: 0; }
.mpd-row .el-input, .mpd-row .el-textarea { flex: 1; }
</style>

<style>
.modify-price-dialog.el-dialog { border-radius: 12px; overflow: hidden; }
</style>
