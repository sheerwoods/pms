<template>
  <div>
    <!-- 状态栏目 + 信息筛选 -->
    <el-card class="toolbar-card" shadow="never">
      <el-tabs v-model="status" class="status-tabs" @tab-change="reload">
        <el-tab-pane label="已预订" name="reserved" />
        <el-tab-pane label="在住" name="checked_in" />
        <el-tab-pane label="已退" name="checked_out" />
        <el-tab-pane label="已取消" name="cancelled" />
      </el-tabs>
      <div class="filter-bar">
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="入住开始"
          end-placeholder="入住结束"
          style="width: 260px"
          @change="reload"
        />
        <el-input v-model="keyword" placeholder="单号/预定人/手机/房号" clearable style="width: 220px" @keyup.enter="reload" @clear="reload">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button type="primary" @click="reload">查询</el-button>
        <el-button type="success" :icon="Plus" @click="openCreate">新增预定</el-button>
      </div>
    </el-card>

    <!-- 表格 -->
    <el-card shadow="never">
      <el-table :data="viewRows" border stripe size="default" v-loading="loading" :span-method="spanMethod">
        <!-- 已预订/已取消：按订单整单展示，保持原有字段 -->
        <template v-if="!isPerRoom">
          <el-table-column label="单号" width="150">
            <template #default="{ row }">
              <div class="order-no">{{ row.order_no }}</div>
            </template>
          </el-table-column>
          <el-table-column label="外部订单号" min-width="120">
            <template #default="{ row }">{{ row.source_order_no || '-' }}</template>
          </el-table-column>
          <el-table-column label="预定人" min-width="110">
            <template #default="{ row }">
              <div class="guest-name">{{ row.guest_name }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="source" label="来源" width="70" />
          <el-table-column label="入住类型" width="90">
            <template #default="{ row }">{{ row.booking_type || '全日房' }}</template>
          </el-table-column>
          <el-table-column label="房型" min-width="160">
            <template #default="{ row }"><div class="type-desc">{{ typeDesc(row) }}</div></template>
          </el-table-column>
          <el-table-column label="房号" width="130">
            <template #default="{ row }">
              <div class="room-cell">
                <span class="room-nos">{{ assignedRoomNos(row) }}</span>
                <el-link v-if="(row.status === 'reserved' || row.status === 'checked_in') && unassignedRoomCount(row) > 0" type="primary" @click="openAssign(row)">排房</el-link>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="check_in_date" label="入住" width="100" />
          <el-table-column prop="check_out_date" label="离店" width="100" />
          <el-table-column label="首日房价" width="110" align="right">
            <template #default="{ row }"><div class="type-desc">{{ firstRateDesc(row) }}</div></template>
          </el-table-column>
          <el-table-column label="总额" width="90" align="right">
            <template #default="{ row }">{{ fmtMoney(row.total_amount) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="260">
            <template #default="{ row }">
              <el-button link type="info" size="small" @click="openDetail(row)">详情</el-button>
              <el-tag v-if="row.status === 'reserved' && row.checked_in_rooms > 0" size="small" type="warning" class="mr1">部分入住</el-tag>
              <el-button v-if="row.status === 'reserved' && (row.pending_rooms ?? row.rooms ?? 1) > 0" link type="primary" size="small" @click="openCheckin(row)">
                {{ row.checked_in_rooms > 0 ? '继续入住' : '入住' }}
              </el-button>
              <el-button v-if="row.status === 'reserved' && !(row.checked_in_rooms > 0)" link type="danger" size="small" @click="doCancel(row)">取消</el-button>

              <el-button v-if="row.status === 'checked_in'" link type="danger" size="small" @click="openCheckout(row)">退房</el-button>
              <el-button v-if="row.status === 'checked_in'" link type="primary" size="small" @click="openEdit(row)">续住</el-button>
              <el-button v-if="row.status === 'checked_in'" link size="small" @click="openChangeRoom(row)">换房</el-button>

              <el-button v-if="row.status === 'cancelled'" link type="success" size="small" @click="doRestore(row)">恢复预定</el-button>
            </template>
          </el-table-column>
        </template>

        <!-- 在住/已退：一房一单 -->
        <template v-else>
          <el-table-column label="单号" width="150">
            <template #default="{ row }">
              <div class="order-no">{{ row.order_no }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="source" label="来源" width="70" />
          <el-table-column label="外部订单号" min-width="120">
            <template #default="{ row }">{{ row.source_order_no || '-' }}</template>
          </el-table-column>
          <el-table-column label="房号" width="90">
            <template #default="{ row }"><span class="room-nos">{{ row.room_no || '待排' }}</span></template>
          </el-table-column>
          <el-table-column label="子单状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="unitStatusMeta(row.unit_status).type">{{ unitStatusMeta(row.unit_status).text }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="房型" min-width="140">
            <template #default="{ row }"><div class="type-desc">{{ roomTypeMap[Number(row.room_type_id)] || '未选房型' }}</div></template>
          </el-table-column>
          <el-table-column label="入住人" min-width="100">
            <template #default="{ row }">
              <div class="guest-name">{{ row.guest_name || '-' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="联系电话" width="120">
            <template #default="{ row }">{{ row.guest_phone || '-' }}</template>
          </el-table-column>
          <el-table-column prop="check_in_date" label="入住" width="100" />
          <el-table-column prop="check_out_date" label="离店" width="100" />
          <el-table-column v-if="isInHouse" label="当日房价" width="110" align="right">
            <template #default="{ row }">{{ fmtMoney(todayRate(row)) }}</template>
          </el-table-column>
          <el-table-column v-else label="首日房价" width="110" align="right">
            <template #default="{ row }">{{ fmtMoney(unitFirstRate(row)) }}</template>
          </el-table-column>
          <el-table-column v-if="status === 'checked_out'" label="总消费" width="100" align="right">
            <template #default="{ row }"><span class="amt-out">−{{ fmtMoney(row.total_consume) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="260">
            <template #default="{ row }">
              <el-button link type="info" size="small" @click="openRoomDetail(row)">详情</el-button>
              <template v-if="row.unit_status === 'checked_in'">
                <el-button link type="danger" size="small" @click="doRoomCheckout(row)">退房</el-button>
                <el-button link type="primary" size="small" :disabled="row.check_out_date !== today" :title="row.check_out_date !== today ? '仅可对今日离店的房间续住' : ''" @click="openRenew(row)">续住</el-button>
                <el-button link type="primary" size="small" @click="openExtend(row)">调价</el-button>
              </template>
              <el-button link size="small" @click="openFolio(row)">账单</el-button>
            </template>
          </el-table-column>
        </template>
      </el-table>

      <div class="pager">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="total"
          :page-size="pageSize"
          v-model:current-page="page"
          @current-change="load"
        />
      </div>
    </el-card>

    <!-- 对话框 -->
    <ReservationForm v-model:visible="createVisible" mode="create" @saved="onSaved" />
    <ReservationForm v-model:visible="editVisible" mode="edit" :reservation="currentRes" @saved="onSaved" />
    <CheckInDialog v-model:visible="checkinVisible" :reservation="currentRes" @saved="onSaved" />
    <CheckOutDialog v-model:visible="checkoutVisible" :reservation="currentRes" @saved="onSaved" />
    <ChangeRoomDialog v-model:visible="changeRoomVisible" :reservation="currentRes" :unit-id="changeRoomUnitId" @saved="onSaved" />
    <OrderDetailDialog v-model:visible="detailVisible" :reservation-id="currentRes?.id" :room-id="detailRoomId" :unit-id="detailUnitId" @changed="onSaved" />
    <RoomAssignDialog v-model:visible="assignVisible" :reservation="currentRes" @saved="onSaved" />
    <FolioDialog v-model:visible="folioVisible" :reservation-id="folioReservationId" @changed="onSaved" />
    <ModifyPriceDialog v-model:visible="priceVisible" :reservation="priceRes" :unit="priceUnit" @saved="onSaved" />
    <RenewDialog v-model:visible="renewVisible" :reservation-id="renewRes?.id" :unit-id="renewUnit?.id" @saved="onSaved" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import http from '../api';
import { fmtMoney, fmtDate } from '../utils/format';
import ReservationForm from '../components/ReservationForm.vue';
import CheckInDialog from '../components/CheckInDialog.vue';
import CheckOutDialog from '../components/CheckOutDialog.vue';
import ChangeRoomDialog from '../components/ChangeRoomDialog.vue';
import OrderDetailDialog from '../components/OrderDetailDialog.vue';
import RoomAssignDialog from '../components/RoomAssignDialog.vue';
import FolioDialog from '../components/FolioDialog.vue';
import ModifyPriceDialog from '../components/ModifyPriceDialog.vue';
import RenewDialog from '../components/RenewDialog.vue';

const today = fmtDate();
const status = ref('reserved');
const keyword = ref('');
const dateRange = ref([]);
const list = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 15;
const loading = ref(false);

const createVisible = ref(false);
const editVisible = ref(false);
const checkinVisible = ref(false);
const checkoutVisible = ref(false);
const changeRoomVisible = ref(false);
const detailVisible = ref(false);
const assignVisible = ref(false);
const detailRoomId = ref(null);
const detailUnitId = ref(null);
const folioVisible = ref(false);
const folioReservationId = ref(null);
const currentRes = ref(null);
const changeRoomUnitId = ref(null);
const priceVisible = ref(false);
const priceRes = ref(null);
const priceUnit = ref(null);
const renewVisible = ref(false);
const renewRes = ref(null);
const renewUnit = ref(null);

// 「在住/已退」tab：一房一单，把订单展开成逐间子单；同一订单的全部子单一起列出（含已退），
// 「已预订/已取消」保持整单行
const isInHouse = computed(() => status.value === 'checked_in');
const isPerRoom = computed(() => status.value === 'checked_in' || status.value === 'checked_out');
const UNIT_STATUS = {
  pending: { text: '待入住', type: 'warning' },
  checked_in: { text: '在住', type: 'success' },
  checked_out: { text: '已退', type: 'info' },
  no_show: { text: '未到', type: 'danger' },
  cancelled: { text: '已取消', type: 'danger' },
};
const unitStatusMeta = (s) => UNIT_STATUS[s] || { text: s || '-', type: '' };
const viewRows = computed(() => {
  if (!isPerRoom.value) return list.value;
  const rows = [];
  for (const res of list.value) {
    for (const u of (res.room_list || [])) {
      rows.push({
        isRoomRow: true,
        unit_status: u.status,
        _res: res,
        _unit: u,
        order_no: res.order_no,
        source_order_no: res.source_order_no,
        guest_name: u.guest_name || '',
        guest_phone: u.guest_phone || '',
        source: res.source,
        room_type_id: u.room_type_id ?? res.room_type_id,
        room_no: u.room_no,
        rate: Number(u.rate) || 0,
        check_in_date: (res.actual_check_in ? String(res.actual_check_in).slice(0, 10) : res.check_in_date),
        check_out_date: u.actual_check_out || u.check_out_date || res.check_out_date,
        total_amount: res.total_amount,
        total_consume: res.total_consume,
        status: res.status,
      });
    }
  }
  return rows;
});

// 同一预订单的多个子单：纵向合并「单号/来源/外部订单号」列，体现它们共用同一单号与来源
const MERGE_COLUMNS = ['单号', '来源', '外部订单号'];
function spanMethod({ row, column, rowIndex }) {
  if (!isPerRoom.value || !MERGE_COLUMNS.includes(column.label)) return undefined;
  const rows = viewRows.value;
  const rid = row._res?.id;
  if (rid == null) return undefined;
  if (rowIndex > 0 && rows[rowIndex - 1]._res?.id === rid) return { rowspan: 0, colspan: 0 };
  let rowspan = 1;
  for (let i = rowIndex + 1; i < rows.length && rows[i]._res?.id === rid; i++) rowspan += 1;
  return { rowspan, colspan: 1 };
}

// 线路的每晚价表：兼容 {date:price} JSON 字符串（现行存储）与 [{date,price}] 数组（旧数据）
function lineRateMap(ln) {
  if (!ln || ln.rates == null) return {};
  if (Array.isArray(ln.rates)) {
    const m = {};
    ln.rates.forEach((x) => { if (x && x.date) m[x.date] = Number(x.price) || 0; });
    return m;
  }
  if (typeof ln.rates === 'object') return ln.rates;
  try { return JSON.parse(ln.rates) || {}; } catch { return {}; }
}

// 子单逐晚价表（reservation_rooms.rates）
function unitRateMap(u) {
  return lineRateMap(u && { rates: u.rates });
}

function lineOfUnit(u, res) {
  try {
    const lines = JSON.parse(res.lines || '[]');
    return lines[Number(u.line_index)] || lines[0] || {};
  } catch {
    return {};
  }
}

// 当日房价：该间房价覆盖优先，其次今晚价表，再回退线路价
function todayRate(row) {
  const u = row._unit, res = row._res;
  if (!u) return Number(row.rate) || 0;
  const t = fmtDate();
  const um = unitRateMap(u);
  if (um[t] != null) return Number(um[t]) || 0;
  if (Number(u.rate) > 0) return Number(u.rate);
  const ln = lineOfUnit(u, res);
  const map = lineRateMap(ln);
  if (map[t] != null) return Number(map[t]) || 0;
  const dates = Object.keys(map).sort();
  if (dates.length) return Number(map[dates[0]]) || Number(ln.rate) || 0;
  return Number(ln.rate) || Number(res.rate) || 0;
}

// 单间首日房价：该间房价覆盖优先，其次入住首晚价表，再回退线路价
function unitFirstRate(row) {
  const u = row._unit, res = row._res;
  if (!u) return Number(row.rate) || 0;
  const d = (res.actual_check_in ? String(res.actual_check_in).slice(0, 10) : res.check_in_date);
  const um = unitRateMap(u);
  if (um[d] != null) return Number(um[d]) || 0;
  if (Number(u.rate) > 0) return Number(u.rate);
  const ln = lineOfUnit(u, res);
  const map = lineRateMap(ln);
  if (map[d] != null) return Number(map[d]) || 0;
  const dates = Object.keys(map).sort();
  if (dates.length) return Number(map[dates[0]]) || 0;
  return Number(ln.rate) || Number(res.rate) || 0;
}

// 房型名映射，用于「房型」列渲染多行房型
const roomTypes = ref([]);
const roomTypeMap = computed(() => {
  const m = {};
  roomTypes.value.forEach((t) => { m[t.id] = t.name; });
  return m;
});
async function loadRoomTypes() {
  roomTypes.value = await http.get('/room-types');
}

// 解析订单 lines（多预定房型），缺省回退到顶层房型字段
function parseLines(row) {
  try {
    const a = JSON.parse(row.lines || '[]');
    if (Array.isArray(a) && a.length) return a;
  } catch { /* fall through */ }
  return [{ room_type_id: row.room_type_id || null, rooms: row.rooms || 1, rate: row.rate || 0 }];
}

// 房型列：每行「房型名 + 间数」，多行显示，如 豪华大床房 2间 / 标准大床房 1间
function typeDesc(row) {
  return parseLines(row)
    .map((ln) => {
      const name = roomTypeMap.value[ln.room_type_id] || '';
      const rooms = Number(ln.rooms) || 1;
      return name ? `${name} ${rooms}间` : `未选房型 ${rooms}间`;
    })
    .join('\n');
}

// 首日房价列：每行首晚房价，多行显示
function firstRateDesc(row) {
  return parseLines(row)
    .map((ln) => {
      let p = Number(ln.rate) || 0;
      if (!p) {
        const map = lineRateMap(ln);
        const dates = Object.keys(map).sort();
        if (dates.length) p = Number(map[dates[0]]) || 0;
      }
      return fmtMoney(p);
    })
    .join('\n');
}

async function load() {
  loading.value = true;
  try {
    const params = { page: page.value, pageSize };
    if (status.value) params.status = status.value;
    if (keyword.value) params.keyword = keyword.value;
    if (dateRange.value?.length === 2) {
      params.start = dateRange.value[0];
      params.end = dateRange.value[1];
    }
    const data = await http.get('/reservations', { params });
    list.value = data.list;
    total.value = data.total;
  } finally {
    loading.value = false;
  }
}
function reload() {
  page.value = 1;
  load();
}

function openCreate() {
  currentRes.value = null;
  createVisible.value = true;
}
function openEdit(row) {
  currentRes.value = row.isRoomRow ? row._res : row;
  editVisible.value = true;
}
// 调价 / 改预离日：仅作用于当前子单
function openExtend(row) {
  priceRes.value = row.isRoomRow ? row._res : row;
  priceUnit.value = row.isRoomRow ? row._unit : (row.room_list?.[0] || null);
  priceVisible.value = true;
}
// 续住：结账退房旧单 -> 按来源预订单/新建单续住当前房间与入住人
function openRenew(row) {
  renewRes.value = row.isRoomRow ? row._res : row;
  renewUnit.value = row.isRoomRow ? row._unit : (row.room_list?.find((u) => u.status === 'checked_in') || null);
  renewVisible.value = true;
}
function openCheckin(row) {
  currentRes.value = row;
  checkinVisible.value = true;
}
function openCheckout(row) {
  currentRes.value = row.isRoomRow ? row._res : row;
  checkoutVisible.value = true;
}
function openChangeRoom(row) {
  currentRes.value = row.isRoomRow ? row._res : row;
  changeRoomUnitId.value = row.isRoomRow ? row._unit.id : null;
  changeRoomVisible.value = true;
}
function openDetail(row) {
  currentRes.value = row;
  detailRoomId.value = null;
  detailUnitId.value = null;
  detailVisible.value = true;
}
function openRoomDetail(row) {
  currentRes.value = row._res;
  detailRoomId.value = row._unit.room_id;
  detailUnitId.value = row._unit.id;
  detailVisible.value = true;
}
function openFolio(row) {
  folioReservationId.value = (row.isRoomRow ? row._res : row).id;
  folioVisible.value = true;
}
function openAssign(row) {
  currentRes.value = row;
  assignVisible.value = true;
}

// 单间退房：仅剩这一间在住且无待入住子单时走整单结算；否则单间退房、其余子单继续
async function doRoomCheckout(row) {
  const res = row._res;
  const unit = row._unit;
  const rooms = res.room_list || [];
  const checkedInCount = rooms.filter((x) => x.status === 'checked_in').length;
  const pendingCount = rooms.filter((x) => x.status === 'pending').length;
  if (checkedInCount <= 1 && pendingCount === 0) {
    currentRes.value = res;
    checkoutVisible.value = true;
    return;
  }
  try {
    await ElMessageBox.confirm(`确认房间 ${unit.room_no || '该房'} 结账退房？其余房间继续在住，共用同一账单。`, '提示', { type: 'warning' });
  } catch (e) { return; }
  await http.post(`/reservations/${res.id}/rooms/${unit.id}/check-out`, { actual_check_out: fmtDate() });
  ElMessage.success('该房间已退房');
  await load();
}

// 房号列：仅展示已排房的房号
function assignedRoomNos(row) {
  return (row.room_list || []).filter((x) => x.room_no).map((x) => x.room_no).join('、');
}
// 尚有待排房间（待入住且未分配房号）
function unassignedRoomCount(row) {
  return (row.room_list || []).filter((x) => x.status === 'pending' && !x.room_id).length;
}

async function doCancel(row) {
  try {
    await ElMessageBox.confirm(`确认取消预定 ${row.order_no}（${row.guest_name}）？`, '提示', { type: 'warning' });
  } catch (e) { return; }
  await http.post(`/reservations/${row.id}/cancel`);
  ElMessage.success('预定已取消');
  await load();
}
async function doRestore(row) {
  try {
    await ElMessageBox.confirm(`确认恢复预定 ${row.order_no}（${row.guest_name}）？`, '提示', { type: 'warning' });
  } catch (e) { return; }
  await http.post(`/reservations/${row.id}/restore`);
  ElMessage.success('已恢复预定');
  await load();
}

async function onSaved() {
  await load();
}

onMounted(() => { loadRoomTypes(); load(); });
</script>

<style scoped>
.status-tabs { margin-bottom: 4px; }
.filter-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.order-no { font-size: 12px; color: #495057; }
.guest-name { font-weight: 600; color: #212529; }
.type-desc { white-space: pre-line; line-height: 1.5; }
.room-cell { display: flex; align-items: center; gap: 6px; }
.mr1 { margin-right: 4px; }
.room-nos { color: #303133; }
.pager { display: flex; justify-content: flex-end; margin-top: 14px; }
</style>
