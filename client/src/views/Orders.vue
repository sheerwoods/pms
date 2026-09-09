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
      <el-table :data="list" border stripe size="default" v-loading="loading">
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
          <template #default="{ row }">
            <div class="type-desc">{{ typeDesc(row) }}</div>
          </template>
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
        <el-table-column label="首日房价" width="100" align="right">
          <template #default="{ row }"><div class="type-desc">{{ firstRateDesc(row) }}</div></template>
        </el-table-column>
        <el-table-column label="总额" width="90" align="right">
          <template #default="{ row }">{{ fmtMoney(row.total_amount) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="260">
          <template #default="{ row }">
            <el-button link type="info" size="small" @click="openDetail(row)">详情</el-button>
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
    <ChangeRoomDialog v-model:visible="changeRoomVisible" :reservation="currentRes" @saved="onSaved" />
    <OrderDetailDialog v-model:visible="detailVisible" :reservation-id="currentRes?.id" @changed="onSaved" />
    <RoomAssignDialog v-model:visible="assignVisible" :reservation="currentRes" @saved="onSaved" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import http from '../api';
import { store } from '../store';
import { fmtMoney } from '../utils/format';
import ReservationForm from '../components/ReservationForm.vue';
import CheckInDialog from '../components/CheckInDialog.vue';
import CheckOutDialog from '../components/CheckOutDialog.vue';
import ChangeRoomDialog from '../components/ChangeRoomDialog.vue';
import OrderDetailDialog from '../components/OrderDetailDialog.vue';
import RoomAssignDialog from '../components/RoomAssignDialog.vue';

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
const currentRes = ref(null);

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
      if (!p && Array.isArray(ln.rates) && ln.rates.length) p = Number(ln.rates[0]?.price) || 0;
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
  currentRes.value = row;
  editVisible.value = true;
}
function openCheckin(row) {
  currentRes.value = row;
  checkinVisible.value = true;
}
function openCheckout(row) {
  currentRes.value = row;
  checkoutVisible.value = true;
}
function openChangeRoom(row) {
  currentRes.value = row;
  changeRoomVisible.value = true;
}
function openDetail(row) {
  currentRes.value = row;
  detailVisible.value = true;
}
function openAssign(row) {
  currentRes.value = row;
  assignVisible.value = true;
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
  store.loadStats();
}
async function doRestore(row) {
  try {
    await ElMessageBox.confirm(`确认恢复预定 ${row.order_no}（${row.guest_name}）？`, '提示', { type: 'warning' });
  } catch (e) { return; }
  await http.post(`/reservations/${row.id}/restore`);
  ElMessage.success('已恢复预定');
  await load();
  store.loadStats();
}

async function onSaved() {
  await load();
  store.loadStats();
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
.room-nos { color: #303133; }
.pager { display: flex; justify-content: flex-end; margin-top: 14px; }
</style>
