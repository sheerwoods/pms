<template>
  <el-dialog
    :model-value="visible"
    title="办理入住"
    width="80%"
    align-center
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
    @closed="reset"
    class="checkin-dialog"
  >
    <!-- 一、基本信息 -->
    <div class="section">
      <div class="section-title"><span class="dot">1</span>基本信息</div>
      <div class="info-grid">
        <div class="info-item"><span class="k">预订人</span><span class="v">{{ detail?.guest_name || reservation?.guest_name || '-' }}</span></div>
        <div class="info-item"><span class="k">手机号</span><span class="v">{{ detail?.guest_phone || reservation?.guest_phone || '-' }}</span></div>
        <div class="info-item"><span class="k">备注</span><span class="v">{{ detail?.remark || reservation?.remark || '-' }}</span></div>
        <div class="info-item"><span class="k">外部订单号</span><span class="v">{{ detail?.source_order_no || reservation?.source_order_no || '-' }}</span></div>
        <div class="info-item"><span class="k">订单来源</span><span class="v">{{ detail?.source || reservation?.source || '-' }}</span></div>
        <div class="info-item"><span class="k">房间类型</span><span class="v">{{ detail?.booking_type || reservation?.booking_type || '-' }}</span></div>
      </div>
    </div>

    <!-- 二、客房信息 -->
    <div class="section">
      <div class="section-title"><span class="dot">2</span>客房信息</div>
      <div class="info-grid">
        <div class="info-item"><span class="k">间数</span><span class="v">{{ rows.length }} 间</span></div>
        <div class="info-item"><span class="k">间夜</span><span class="v">{{ detail?.nights || reservation?.nights }} 晚</span></div>
        <div class="info-item"><span class="k">预抵时间</span><span class="v">{{ detail?.check_in_date || reservation?.check_in_date }}</span></div>
        <div class="info-item"><span class="k">预离时间</span><span class="v">{{ detail?.check_out_date || reservation?.check_out_date }}</span></div>
        <div class="info-item"><span class="k">房型构成</span><span class="v">{{ typeSummary }}</span></div>
        <div class="info-item"><span class="k">预估总额</span><span class="v total">{{ fmtMoney(detail?.total_amount || reservation?.total_amount) }}</span></div>
      </div>
    </div>

    <!-- 三、入住登记 -->
    <div class="section">
      <div class="section-title">
        <span class="dot">3</span>入住登记
        <span class="title-actions">
          <el-button size="small" plain :icon="MagicStick" @click="autoAssign">自动排房</el-button>
          <el-button size="small" plain :icon="Reading" @click="onReadCard">读身份证</el-button>
        </span>
      </div>

      <el-table
        :data="rows"
        border
        size="small"
        row-key="id"
        :header-cell-style="{ background: '#f5f7fa', color: '#606266' }"
      >
        <el-table-column type="expand" width="34">
          <template #default="{ row }">
            <div class="cohab">
              <div class="cohab-head">
                <span>同住人</span>
                <el-button v-if="row.status === 'pending'" text type="primary" size="small" :icon="Plus" @click="addCohab(row)">添加同住人</el-button>
              </div>
              <div v-for="(c, j) in row.cohabitors" :key="j" class="cohab-row">
                <el-input v-model="c.name" size="small" placeholder="姓名" maxlength="30" :disabled="row.status !== 'pending'" />
                <el-input v-model="c.id_card" size="small" placeholder="身份证号" maxlength="18" :disabled="row.status !== 'pending'" @change="upper(c)" />
                <el-input v-model="c.phone" size="small" placeholder="手机号" maxlength="11" :disabled="row.status !== 'pending'" />
                <el-button v-if="row.status === 'pending'" text type="danger" size="small" @click="row.cohabitors.splice(j, 1)">删除</el-button>
              </div>
              <div v-if="!row.cohabitors.length" class="cohab-empty">无同住人</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="选择" width="52" align="center">
          <template #header>
            <el-checkbox
              :model-value="isAllSelected"
              :indeterminate="isIndeterminate"
              :disabled="!pendingRows.length"
              @change="toggleAll"
            />
          </template>
          <template #default="{ row }">
            <el-checkbox
              v-if="row.status === 'pending'"
              :model-value="selectedIds.includes(row.id)"
              @change="() => toggle(row.id)"
            />
          </template>
        </el-table-column>

        <el-table-column label="#" type="index" width="42" align="center" />
        <el-table-column label="房型" width="220">
          <template #default="{ row }">
            <div class="type-cell">
              <div class="type-name">{{ row.room_type_name || '未选房型' }}</div>
              <div class="type-rate">
                <el-input-number v-model="row.rate" :min="0" :precision="2" :controls="false" size="small" :disabled="row.status !== 'pending'" />
                <span class="rate-unit">/晚</span>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'checked_in'" type="success" size="small">已入住</el-tag>
            <el-tag v-else type="info" size="small">待入住</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="房号" width="150">
          <template #default="{ row }">
            <el-select v-if="row.status === 'pending'" v-model="row.room_id" size="small" filterable placeholder="选择房间" style="width: 100%">
              <el-option v-for="rm in unitOptions(row)" :key="rm.id" :label="`${rm.room_no}（${rm.type_name}）`" :value="rm.id" />
            </el-select>
            <span v-else class="room-no">{{ row.room_no }}</span>
          </template>
        </el-table-column>
        <el-table-column label="姓名" min-width="110">
          <template #default="{ row }">
            <el-input v-if="row.status === 'pending'" v-model="row.guest_name" size="small" placeholder="入住人姓名" maxlength="30" />
            <span v-else>{{ row.guest_name || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="身份证号" min-width="170">
          <template #default="{ row }">
            <el-input v-if="row.status === 'pending'" v-model="row.guest_id_card" size="small" placeholder="身份证号（选填）" maxlength="18" @change="upper(row)" />
            <span v-else>{{ row.guest_id_card || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="手机号" min-width="130">
          <template #default="{ row }">
            <el-input v-if="row.status === 'pending'" v-model="row.guest_phone" size="small" placeholder="手机号（选填）" maxlength="11" />
            <span v-else>{{ row.guest_phone || '-' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!selectedPendingRows.length" @click="confirm">
        确认入住{{ selectedPendingRows.length ? `（${selectedPendingRows.length} 间）` : '' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Reading, MagicStick, Plus } from '@element-plus/icons-vue';
import http from '../api';
import { fmtMoney } from '../utils/format';

const props = defineProps({
  visible: Boolean,
  reservation: { type: Object, default: null },
});
const emit = defineEmits(['update:visible', 'saved']);

const detail = ref(null);
const roomTypes = ref([]);
const availableRooms = ref([]);
const saving = ref(false);
const rows = ref([]); // room_list 行，pending 可编辑，checked_in 只读
const selectedIds = ref([]);

const roomTypeMap = computed(() => {
  const m = {};
  roomTypes.value.forEach((t) => { m[t.id] = t.name; });
  return m;
});

const pendingRows = computed(() => rows.value.filter((r) => r.status === 'pending'));
const selectedPendingRows = computed(() => pendingRows.value.filter((r) => selectedIds.value.includes(r.id)));
const isAllSelected = computed(() => pendingRows.value.length > 0 && selectedPendingRows.value.length === pendingRows.value.length);
const isIndeterminate = computed(() => selectedPendingRows.value.length > 0 && selectedPendingRows.value.length < pendingRows.value.length);

const typeSummary = computed(() => {
  if (!rows.value.length) return '-';
  const map = {};
  rows.value.forEach((r) => { const n = r.room_type_name || '未选房型'; map[n] = (map[n] || 0) + 1; });
  return Object.entries(map).map(([k, v]) => (v > 1 ? `${k} ${v}间` : k)).join('、');
});

// 可选房间：可用房 + 本预订已分配的房间；按房型过滤并排除被其他行选走的房
const roomChoices = computed(() => {
  const list = [...availableRooms.value];
  (rows.value || []).forEach((r) => {
    if (r.room_id && !list.find((x) => x.id === r.room_id)) {
      list.push({
        id: r.room_id, room_no: r.room_no || '',
        type_id: r.room_type_id, type_name: roomTypeMap.value[r.room_type_id] || '未选房型',
      });
    }
  });
  return list;
});

function unitOptions(row) {
  const used = rows.value.filter((r) => r.status === 'pending' && r.id !== row.id).map((r) => r.room_id).filter(Boolean);
  return roomChoices.value.filter((rm) =>
    (row.room_id != null ? rm.id === row.room_id : !used.includes(rm.id)) &&
    (!row.room_type_id || rm.type_id === row.room_type_id)
  );
}

function parseCohabitors(json) {
  try { const a = JSON.parse(json || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}
function parseLines(json) {
  try { const a = JSON.parse(json || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

function buildRows(roomList) {
  const lines = parseLines(detail.value?.lines);
  return (roomList || []).map((r) => {
    const ln = lines[r.line_index] || lines[0] || {};
    return {
      ...r,
      room_type_name: roomTypeMap.value[r.room_type_id] || '未选房型',
      rate: Number(ln.rate) || 0,
      cohabitors: parseCohabitors(r.cohabitors),
    };
  });
}

async function load() {
  const [types, rooms, resDetail] = await Promise.all([
    http.get('/room-types'),
    http.get('/rooms/available'),
    http.get(`/reservations/${props.reservation.id}`),
  ]);
  roomTypes.value = types;
  availableRooms.value = rooms;
  detail.value = resDetail;
  rows.value = buildRows(resDetail.room_list || []);
  selectedIds.value = pendingRows.value.map((r) => r.id);
}

watch(() => props.visible, async (v) => { if (v) await load(); });

function toggle(id) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((x) => x !== id)
    : [...selectedIds.value, id];
}
function toggleAll(v) {
  selectedIds.value = v ? pendingRows.value.map((r) => r.id) : [];
}

function upper(obj) {
  obj.guest_id_card = (obj.guest_id_card || '').trim().toUpperCase();
}
function onReadCard() {
  ElMessage.info('读身份证需接入硬件读卡器，当前请手动录入');
}
function autoAssign() {
  const used = new Set(rows.value.filter((r) => r.status === 'pending' && r.room_id).map((r) => r.room_id));
  let filled = 0;
  pendingRows.value.forEach((r) => {
    if (r.room_id) return;
    const cand = roomChoices.value.find((rm) => !used.has(rm.id) && (!r.room_type_id || rm.type_id === r.room_type_id));
    if (cand) { r.room_id = cand.id; used.add(cand.id); filled++; }
  });
  ElMessage[filled ? 'success' : 'info'](filled ? `已自动排 ${filled} 间房` : '无可匹配的可用房');
}
function addCohab(row) {
  row.cohabitors.push({ name: '', id_card: '', phone: '' });
}

function validateUnit(row, i) {
  const label = `第 ${i + 1} 间`;
  if (!row.room_id) throw new Error(`${label}请选择房间`);
  if (!(row.guest_name || '').trim()) throw new Error(`${label}入住人姓名必填`);
  const idCard = (row.guest_id_card || '').trim().toUpperCase();
  if (idCard && !/^\d{17}[\dX]$/.test(idCard)) throw new Error(`${label}身份证号格式不正确（18位，末位可为X）`);
  const phone = (row.guest_phone || '').trim();
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) throw new Error(`${label}手机号格式不正确（1开头的11位数字）`);
  (row.cohabitors || []).forEach((c, j) => {
    if (!(c.name || '').trim()) throw new Error(`${label}同住人${j + 1}姓名必填`);
    const cid = (c.id_card || '').trim().toUpperCase();
    if (cid && !/^\d{17}[\dX]$/.test(cid)) throw new Error(`${label}同住人${j + 1}身份证号格式不正确`);
    const cph = (c.phone || '').trim();
    if (cph && !/^1[3-9]\d{9}$/.test(cph)) throw new Error(`${label}同住人${j + 1}手机号格式不正确`);
  });
}

async function confirm() {
  const targets = selectedPendingRows.value;
  if (!targets.length) return ElMessage.warning('请勾选要入住的房间');
  try { targets.forEach((r, i) => validateUnit(r, rows.value.indexOf(r))); }
  catch (e) { return ElMessage.warning(e.message); }
  const rooms = targets.map((r) => ({
    id: r.id,
    room_id: r.room_id,
    guest_name: (r.guest_name || '').trim(),
    guest_id_card: (r.guest_id_card || '').trim().toUpperCase(),
    guest_phone: (r.guest_phone || '').trim(),
    rate: Number(r.rate) || 0,
    cohabitors: (r.cohabitors || []).filter((c) => (c.name || '').trim())
      .map((c) => ({ name: c.name.trim(), id_card: c.id_card.trim().toUpperCase(), phone: c.phone.trim() })),
  }));
  saving.value = true;
  try {
    await http.post(`/reservations/${props.reservation.id}/check-in`, { rooms });
    ElMessage.success(`已入住 ${rooms.length} 间`);
    emit('saved');
    // 入住成功后提示立即制门锁卡
    try {
      await ElMessageBox.confirm(`已入住 ${rooms.length} 间，是否立即为客人制门锁卡？`, '制卡提示', {
        type: 'success',
        confirmButtonText: '立即制卡',
        cancelButtonText: '暂不制卡',
      });
      emit('card', buildCardPayload(targets, rooms));
    } catch (e) { /* 用户选择暂不制卡 */ }
    emit('update:visible', false);
  } catch (e) { /* 已提示 */ } finally { saving.value = false; }
}

// 组装制卡弹窗入参（rooms 为提交的入住房间，targets 为本地行）
function buildCardPayload(targets, rooms) {
  const d = detail.value || {};
  const byId = {};
  rooms.forEach((r) => { byId[r.id] = r; });
  return {
    reservation_id: d.id || props.reservation?.id,
    guest_name: d.guest_name || props.reservation?.guest_name || '',
    check_in_date: d.actual_check_in ? String(d.actual_check_in).slice(0, 10) : d.check_in_date,
    check_out_date: d.check_out_date,
    rooms: targets.map((t) => ({
      unit_id: t.id,
      room_id: byId[t.id]?.room_id || t.room_id,
      room_no: t.room_no || '',
      guest_name: (byId[t.id]?.guest_name || '').trim(),
      check_out_date: t.check_out_date || d.check_out_date,
    })),
  };
}

function reset() {
  detail.value = null;
  rows.value = [];
  selectedIds.value = [];
}
</script>

<style scoped>
.section { margin-bottom: 4px; }
.section-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; color: #303133; margin: 14px 0 10px; }
.section-title .dot { width: 22px; height: 22px; border-radius: 50%; background: #337ecc; color: #fff; font-size: 13px; display: flex; align-items: center; justify-content: center; }
.section-title .title-actions { margin-left: auto; display: flex; gap: 8px; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; background: #fafafa; border: 1px solid #e4e7ed; border-radius: 6px; padding: 12px 16px; }
.info-item { display: flex; font-size: 13px; line-height: 22px; min-width: 0; }
.info-item .k { color: #909399; width: 72px; flex: none; text-align: right; margin-right: 8px; }
.info-item .v { color: #303133; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.info-item .v.total { color: #e03131; font-weight: 700; }
.type-cell { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.type-name { font-size: 13px; color: #303133; white-space: nowrap; }
.type-rate { display: flex; align-items: center; gap: 4px; }
.type-rate .el-input-number { width: 104px; }
.rate-unit { font-size: 12px; color: #e03131; }
.room-no { font-weight: 600; color: #343a40; padding-left: 4px; }

.cohab { padding: 4px 16px; }
.cohab-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.cohab-head span { font-size: 12px; color: #868e96; }
.cohab-head .el-button { margin-left: auto; }
.cohab-row { display: flex; gap: 8px; margin-bottom: 6px; align-items: center; }
.cohab-row .el-input { width: 170px; }
.cohab-empty { font-size: 12px; color: #adb5bd; }
</style>

<style>
.checkin-dialog.el-dialog {
  height: 80%;
  display: flex;
  flex-direction: column;
}
.checkin-dialog .el-dialog__body {
  flex: 1 1 auto;
  overflow-y: auto;
}
</style>
