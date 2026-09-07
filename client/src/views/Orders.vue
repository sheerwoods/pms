<template>
  <div>
    <!-- 状态栏目 + 信息筛选 -->
    <el-card class="toolbar-card" shadow="never">
      <el-tabs v-model="status" class="status-tabs" @tab-change="reload">
        <el-tab-pane label="全部" name="" />
        <el-tab-pane label="已预订" name="reserved" />
        <el-tab-pane label="在住" name="checked_in" />
        <el-tab-pane label="已退" name="checked_out" />
        <el-tab-pane label="已取消" name="cancelled" />
        <el-tab-pane label="未到" name="no_show" />
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
        <el-table-column label="单号" width="185">
          <template #default="{ row }">
            <div class="order-no">{{ row.order_no }}</div>
            <div class="sub">{{ row.created_at?.slice(0, 16) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="预定人" min-width="130">
          <template #default="{ row }">
            <div class="guest-name">{{ row.guest_name }}</div>
            <div class="sub">{{ row.guest_phone || '-' }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="type_name" label="房型" width="100" />
        <el-table-column label="房间类型" width="80">
          <template #default="{ row }">{{ row.booking_type || '全日房' }}</template>
        </el-table-column>
        <el-table-column label="房号" width="70">
          <template #default="{ row }">
            <el-tag v-if="row.room_no" size="small">{{ row.room_no }}</el-tag>
            <span v-else class="sub">未分房</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="RES_STATUS[row.status]?.type" size="small">{{ RES_STATUS[row.status]?.text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="check_in_date" label="入住" width="105" />
        <el-table-column prop="check_out_date" label="离店" width="105" />
        <el-table-column prop="nights" label="夜" width="50" align="center" />
        <el-table-column prop="rooms" label="间数" width="55" align="center" />
        <el-table-column label="首日房价" width="100" align="right">
          <template #default="{ row }">{{ fmtMoney(row.rate) }}</template>
        </el-table-column>
        <el-table-column label="总额" width="95" align="right">
          <template #default="{ row }">{{ fmtMoney(row.total_amount) }}</template>
        </el-table-column>
        <el-table-column label="余额" width="95" align="right">
          <template #default="{ row }">
            <span v-if="row.balance" :class="row.balance > 0 ? 'money-pos' : 'money-neg'">{{ fmtMoney(row.balance) }}</span>
            <span v-else class="sub">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="source" label="来源" width="70" />
        <el-table-column prop="source_order_no" label="来源单号" width="120">
          <template #default="{ row }">{{ row.source_order_no || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="235">
          <template #default="{ row }">
            <el-button v-if="row.status === 'reserved'" link type="primary" size="small" @click="openCheckin(row)">入住</el-button>
            <el-button v-if="row.status === 'reserved'" link type="warning" size="small" @click="openEdit(row)">改单</el-button>
            <el-button v-if="row.status === 'reserved'" link type="danger" size="small" @click="doCancel(row)">取消</el-button>
            <el-button v-if="row.status === 'reserved'" link size="small" @click="doNoShow(row)">未到</el-button>

            <el-button v-if="row.status === 'checked_in'" link type="danger" size="small" @click="openCheckout(row)">退房</el-button>
            <el-button v-if="row.status === 'checked_in'" link type="primary" size="small" @click="openEdit(row)">续住</el-button>
            <el-button v-if="row.status === 'checked_in'" link size="small" @click="openChangeRoom(row)">换房</el-button>

            <el-button link type="info" size="small" @click="openFolio(row)">账单</el-button>
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
    <FolioDialog v-model:visible="folioVisible" :reservation-id="currentRes?.id" @changed="onSaved" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import http from '../api';
import { store } from '../store';
import { fmtMoney, RES_STATUS } from '../utils/format';
import ReservationForm from '../components/ReservationForm.vue';
import CheckInDialog from '../components/CheckInDialog.vue';
import CheckOutDialog from '../components/CheckOutDialog.vue';
import ChangeRoomDialog from '../components/ChangeRoomDialog.vue';
import FolioDialog from '../components/FolioDialog.vue';

const status = ref('');
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
const folioVisible = ref(false);
const currentRes = ref(null);

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
function openFolio(row) {
  currentRes.value = row;
  folioVisible.value = true;
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
async function doNoShow(row) {
  try {
    await ElMessageBox.confirm(`确认将 ${row.guest_name} 的预定标记为未到？`, '提示', { type: 'warning' });
  } catch (e) { return; }
  await http.post(`/reservations/${row.id}/no-show`);
  ElMessage.success('已标记未到');
  await load();
  store.loadStats();
}

async function onSaved() {
  await load();
  store.loadStats();
}

onMounted(load);
</script>

<style scoped>
.status-tabs { margin-bottom: 4px; }
.filter-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.order-no { font-size: 12px; color: #495057; }
.guest-name { font-weight: 600; color: #212529; }
.sub { font-size: 11px; color: #adb5bd; }
.pager { display: flex; justify-content: flex-end; margin-top: 14px; }
</style>
