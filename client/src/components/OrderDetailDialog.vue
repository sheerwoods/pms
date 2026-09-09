<template>
  <el-dialog
    :model-value="visible"
    title="订单详情"
    width="840px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
    @closed="reset"
    class="order-detail-dialog"
  >
    <div v-if="detail">
      <!-- ① 基本信息 -->
      <div class="section">
        <div class="section-title"><span class="dot">1</span>基本信息</div>
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="单号">{{ detail.order_no }}</el-descriptions-item>
          <el-descriptions-item label="预定人">{{ detail.guest_name }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="RES_STATUS[detail.status]?.type" size="small">{{ RES_STATUS[detail.status]?.text }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="手机号">{{ detail.guest_phone || '-' }}</el-descriptions-item>
          <el-descriptions-item label="身份证号">{{ detail.guest_id_card || '-' }}</el-descriptions-item>
          <el-descriptions-item label="外部订单号">{{ detail.source_order_no || '-' }}</el-descriptions-item>
          <el-descriptions-item label="来源">{{ detail.source || '-' }}</el-descriptions-item>
          <el-descriptions-item label="入住类型">{{ detail.booking_type || '全日房' }}</el-descriptions-item>
          <el-descriptions-item label="备注">{{ detail.remark || '-' }}</el-descriptions-item>
          <el-descriptions-item label="到达日期">{{ detail.check_in_date }}</el-descriptions-item>
          <el-descriptions-item label="离店日期">{{ detail.check_out_date }}</el-descriptions-item>
          <el-descriptions-item label="晚数">
            {{ detail.booking_type === '钟点房' ? '1（3小时）' : detail.nights }} 晚
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <!-- ② 房间分配 -->
      <div class="section">
        <div class="section-title"><span class="dot">2</span>房间分配</div>
        <el-table :data="detail.room_list" size="small" border>
          <el-table-column label="房号" min-width="80">
            <template #default="{ row }">{{ row.room_no || '未分房' }}</template>
          </el-table-column>
          <el-table-column label="房型" min-width="120">
            <template #default="{ row }">{{ roomTypeName(row.room_type_id) }}</template>
          </el-table-column>
          <el-table-column label="首日房价" width="120" align="right">
            <template #default="{ row }">
              <el-link type="primary" @click="openRateEditor(row)">{{ fmtMoney(firstRate(row)) }}</el-link>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === 'checked_in' ? 'success' : 'info'" size="small">
                {{ row.status === 'checked_in' ? '已入住' : '待入住' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="入住人" min-width="110">
            <template #default="{ row }">{{ row.guest_name || '-' }}</template>
          </el-table-column>
        </el-table>
        <div class="total-line">
          订单总额：<b class="total-amount">{{ fmtMoney(detail.total_amount) }}</b>
        </div>
      </div>

      <!-- ③ 账单 -->
      <div class="section">
        <div class="section-title"><span class="dot">3</span>账单</div>
        <FolioPanel :reservation-id="detail.id" plain @changed="$emit('changed')" />
      </div>
    </div>

    <!-- 房价修改 -->
    <el-dialog :model-value="rateEditor.visible" :title="rateTitle" width="460px" @update:model-value="rateEditor.visible = $event">
      <el-table :data="rateEditor.rows" size="small" border>
        <el-table-column label="日期" width="130">
          <template #default="{ row }">{{ row.date }}</template>
        </el-table-column>
        <el-table-column label="房价" min-width="140">
          <template #default="{ row }">
            <el-input-number v-model="row.price" :min="0" :precision="2" :max="999999" size="small" controls-position="right" style="width: 100%" />
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="rateEditor.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveRates">确定</el-button>
      </template>
    </el-dialog>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { fmtMoney, RES_STATUS, addDays, nightsBetween } from '../utils/format';
import FolioPanel from './FolioPanel.vue';

const props = defineProps({
  visible: Boolean,
  reservationId: { type: [Number, String], default: null },
});
const emit = defineEmits(['update:visible', 'changed']);

const detail = ref(null);
const roomTypes = ref([]);
const roomTypeMap = computed(() => {
  const m = {};
  roomTypes.value.forEach((t) => { m[t.id] = t.name; });
  return m;
});

// 解析 lines（缺省回退到顶层房型字段）
const parsedLines = computed(() => {
  if (!detail.value) return [];
  try {
    const a = JSON.parse(detail.value.lines || '[]');
    if (Array.isArray(a) && a.length) return a;
  } catch { /* fall through */ }
  return [{
    room_type_id: detail.value.room_type_id || null,
    rooms: detail.value.rooms || 1,
    rate: detail.value.rate || 0,
    rates: detail.value.rates || '{}',
  }];
});

function roomTypeName(id) {
  return roomTypeMap.value[id] || '未选房型';
}

// 入住期间日期列表
function dateList() {
  const d = detail.value;
  if (!d) return [];
  const isHourly = d.booking_type === '钟点房';
  const nights = isHourly ? 1 : (d.nights || nightsBetween(d.check_in_date, d.check_out_date));
  const out = [];
  for (let i = 0; i < nights; i++) out.push(addDays(d.check_in_date, i));
  return out;
}

function parseRatesMap(ln) {
  try { return JSON.parse((ln && ln.rates) || '{}'); } catch { return {}; }
}

// 该行所属房型的首日房价
function firstRate(row) {
  const ln = parsedLines.value[row.line_index ?? 0] || parsedLines.value[0];
  return Number(ln?.rate) || 0;
}

// 房价编辑
const saving = ref(false);
const rateEditor = reactive({ visible: false, lineIndex: 0, rows: [] });

const rateTitle = computed(() => {
  const ln = parsedLines.value[rateEditor.lineIndex] || parsedLines.value[0];
  const name = ln?.room_type_id ? roomTypeMap.value[ln.room_type_id] : '';
  return `${name || '房型'} · 修改房价`;
});

function openRateEditor(row) {
  const ln = parsedLines.value[row.line_index ?? 0] || parsedLines.value[0] || {};
  const map = parseRatesMap(ln);
  const fb = Number(ln.rate) || 0;
  rateEditor.lineIndex = row.line_index ?? 0;
  rateEditor.rows = dateList().map((date) => ({
    date,
    price: map[date] != null ? Number(map[date]) : fb,
  }));
  rateEditor.visible = true;
}

// 每条线转为可提交的负载（保留逐夜房价）
function linePayload(ln, dates) {
  const map = parseRatesMap(ln);
  const fb = Number(ln.rate) || 0;
  return {
    room_type_id: ln.room_type_id || null,
    rooms: ln.rooms || 1,
    rate: fb,
    rates: dates.map((date) => ({ date, price: map[date] != null ? Number(map[date]) : fb })),
  };
}

async function saveRates() {
  const dates = dateList();
  const lines = parsedLines.value.map((ln, i) => {
    const base = linePayload(ln, dates);
    if (i === rateEditor.lineIndex) {
      base.rate = Number(rateEditor.rows[0]?.price) || 0;
      base.rates = rateEditor.rows.map((x) => ({ date: x.date, price: Number(x.price) || 0 }));
    }
    return base;
  });
  saving.value = true;
  try {
    await http.put(`/reservations/${detail.value.id}`, { lines });
    ElMessage.success('房价已更新');
    rateEditor.visible = false;
    await load();
    emit('changed');
  } catch (e) {
    /* 已提示 */
  } finally {
    saving.value = false;
  }
}

async function load() {
  if (!props.reservationId) { detail.value = null; return; }
  const [d, types] = await Promise.all([
    http.get(`/reservations/${props.reservationId}`),
    http.get('/room-types'),
  ]);
  detail.value = d;
  roomTypes.value = types;
}

watch(() => props.visible, (v) => { if (v) load(); });

function reset() {
  detail.value = null;
  rateEditor.visible = false;
  rateEditor.rows = [];
}
</script>

<style scoped>
.section { margin-bottom: 4px; }
.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin: 14px 0 10px;
}
.section-title .dot {
  width: 22px; height: 22px; border-radius: 50%;
  background: #337ecc; color: #fff; font-size: 13px;
  display: flex; align-items: center; justify-content: center;
}
.total-line {
  text-align: right;
  margin-top: 8px;
  font-size: 14px;
  color: #495057;
}
.total-amount { font-size: 18px; color: #e03131; }
</style>

<style>
.order-detail-dialog.el-dialog {
  border-radius: 14px;
  overflow: hidden;
}
.order-detail-dialog .el-dialog__title {
  font-size: 16px;
  font-weight: 600;
}
</style>
