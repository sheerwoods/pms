<template>
  <div class="room-status-layout">
    <!-- 左侧筛选栏（可收起） -->
    <el-card class="filter-panel" :class="{ collapsed: filterCollapsed }" shadow="never">
      <div class="filter-head">
        <template v-if="!filterCollapsed">
          <div class="filter-title">房态筛选</div>
          <el-button text title="收起筛选" @click="filterCollapsed = true">
            <el-icon><Fold /></el-icon>
          </el-button>
        </template>
        <el-button v-else text title="展开筛选" @click="filterCollapsed = false">
          <el-icon><Expand /></el-icon>
        </el-button>
      </div>
      <template v-if="!filterCollapsed">
        <div class="filter-item">
          <div class="filter-label">房号/姓名</div>
          <el-input v-model="keyword" placeholder="房号/姓名" clearable>
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
        </div>
        <div class="filter-item">
          <div class="filter-label">房型</div>
          <el-select v-model="filterType" placeholder="全部房型" clearable style="width: 100%">
            <el-option v-for="t in roomTypes" :key="t.id" :label="t.name" :value="t.id" />
          </el-select>
        </div>
        <div class="filter-item">
          <div class="filter-label">楼层</div>
          <el-select v-model="filterFloor" placeholder="全部楼层" clearable style="width: 100%">
            <el-option v-for="f in floors" :key="f" :label="`${f} 楼`" :value="f" />
          </el-select>
        </div>
        <div class="filter-item">
          <div class="filter-label">房态</div>
          <div class="status-filter">
            <div
              v-for="(v, k) in ROOM_STATUS"
              :key="k"
              class="status-filter-item"
              :class="{ off: !checkedStatuses.includes(k) }"
              @click="toggleStatus(k)"
            >
              <i class="dot" :style="{ background: v.color }"></i>
              <span class="status-name">{{ v.text }}</span>
              <span class="status-count">{{ statusCounts[k] || 0 }}</span>
            </div>
          </div>
        </div>
        <div class="filter-result">当前显示 <b>{{ filteredRooms.length }}</b> 间</div>
      </template>
    </el-card>

    <!-- 右侧楼层房间 -->
    <div class="rooms-content">
      <el-card v-for="fl in visibleFloors" :key="fl" shadow="never" class="floor-card">
        <template #header>
          <div class="floor-header">
            <span class="floor-title">{{ fl }} 楼</span>
            <span class="floor-count">{{ roomsByFloor[fl].length }} 间</span>
          </div>
        </template>
        <div class="rooms">
          <div
            v-for="item in roomsByFloor[fl]"
            :key="item.room.id"
            class="room-card"
            :style="cardStyle(item)"
            @click="openDetail(item)"
          >
            <span class="status-dot" :style="{ background: ROOM_STATUS[item.eff_status].color }"></span>
            <div class="room-no">{{ item.room.room_no }}</div>
            <div class="room-type">{{ item.room.type_name }}</div>
            <div class="room-guest">{{ guestText(item) }}</div>
            <div class="room-date">{{ dateText(item) }}</div>
            <span class="room-status-text" :style="{ color: ROOM_STATUS[item.eff_status].color }">
              {{ ROOM_STATUS[item.eff_status].text }}
            </span>
          </div>
        </div>
      </el-card>
      <el-empty v-if="!visibleFloors.length" description="暂无房间" />
    </div>

    <!-- 房间详情对话框 -->
    <el-dialog v-model="detailVisible" :title="detailTitle" width="440px">
      <template v-if="detailItem">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="房号">{{ detailItem.room.room_no }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ ROOM_STATUS[detailItem.eff_status].text }}</el-descriptions-item>
          <el-descriptions-item label="房型">{{ detailItem.room.type_name }}</el-descriptions-item>
          <el-descriptions-item label="门市价">{{ fmtMoney(detailItem.room.type_price) }}</el-descriptions-item>
        </el-descriptions>

        <template v-if="detailItem.reservation">
          <el-divider content-position="left">当前预定</el-divider>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="客人">{{ detailItem.reservation.guest_name }}</el-descriptions-item>
            <el-descriptions-item label="单号">{{ detailItem.reservation.order_no }}</el-descriptions-item>
            <el-descriptions-item label="入住">{{ detailItem.reservation.check_in_date }}</el-descriptions-item>
            <el-descriptions-item label="离店">{{ detailItem.reservation.check_out_date }}</el-descriptions-item>
            <el-descriptions-item label="间夜">{{ detailItem.reservation.nights }}</el-descriptions-item>
            <el-descriptions-item label="首日房价">{{ fmtMoney(detailItem.reservation.rate) }}</el-descriptions-item>
            <template v-if="detailItem.reservation.status === 'checked_in'">
              <el-descriptions-item label="账单余额">
                <b :class="detailItem.balance > 0 ? 'money-pos' : detailItem.balance < 0 ? 'money-neg' : ''">
                  {{ fmtMoney(detailItem.balance) }}
                </b>
              </el-descriptions-item>
              <el-descriptions-item label="订单来源">{{ detailItem.reservation.source }}</el-descriptions-item>
            </template>
          </el-descriptions>
        </template>

        <div class="detail-actions">
          <template v-if="detailItem.reservation && detailItem.reservation.status === 'checked_in'">
            <el-button type="danger" @click="doCheckout">退房</el-button>
            <el-button type="primary" @click="openEdit">续住/改单</el-button>
            <el-button @click="openChangeRoom">换房</el-button>
            <el-button @click="openFolio">账单</el-button>
          </template>
          <template v-else-if="detailItem.reservation && detailItem.reservation.status === 'reserved'">
            <el-button type="primary" @click="doCheckin">办理入住</el-button>
            <el-button @click="openEdit">改单</el-button>
            <el-button @click="openFolio">账单</el-button>
          </template>
          <template v-else-if="['vacant_clean', 'vacant_dirty'].includes(detailItem.eff_status)">
            <el-button type="primary" @click="openBooking">预订</el-button>
            <el-button type="success" @click="openWalkin">散客入住</el-button>
            <el-button v-if="detailItem.room.status === 'dirty'" @click="setHouseStatus('clean')">设为干净</el-button>
            <el-button v-if="detailItem.room.status === 'clean'" @click="setHouseStatus('dirty')">设为脏</el-button>
            <el-button type="warning" @click="setHouseStatus('ooo')">维修封房</el-button>
          </template>
          <template v-else-if="detailItem.eff_status === 'ooo'">
            <el-button @click="setHouseStatus('clean')">解封(干净)</el-button>
            <el-button @click="setHouseStatus('dirty')">解封(脏)</el-button>
          </template>
        </div>
      </template>
    </el-dialog>

    <!-- 子对话框 -->
    <ReservationForm v-model:visible="bookingVisible" mode="create" :initial="initialForm" @saved="onSaved" />
    <ReservationForm v-model:visible="walkinVisible" mode="walkin" :initial="initialForm" @saved="onSaved" />
    <ReservationForm v-model:visible="editVisible" mode="edit" :reservation="currentRes" @saved="onSaved" />
    <CheckInDialog v-model:visible="checkinVisible" :reservation="currentRes" @saved="onSaved" />
    <CheckOutDialog v-model:visible="checkoutVisible" :reservation="currentRes" @saved="onSaved" />
    <ChangeRoomDialog v-model:visible="changeRoomVisible" :reservation="currentRes" @saved="onSaved" />
    <FolioDialog v-model:visible="folioVisible" :reservation-id="currentRes?.id" @changed="onSaved" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import http from '../api';
import { store } from '../store';
import { fmtDate, fmtMoney, ROOM_STATUS } from '../utils/format';
import ReservationForm from '../components/ReservationForm.vue';
import CheckInDialog from '../components/CheckInDialog.vue';
import CheckOutDialog from '../components/CheckOutDialog.vue';
import ChangeRoomDialog from '../components/ChangeRoomDialog.vue';
import FolioDialog from '../components/FolioDialog.vue';

const date = ref(fmtDate());
const roomTypes = ref([]);
const statusRooms = ref([]);
const filterType = ref(null);
const filterFloor = ref(null);
const keyword = ref('');
const checkedStatuses = ref(Object.keys(ROOM_STATUS));
const filterCollapsed = ref(false);

const detailVisible = ref(false);
const detailItem = ref(null);

const bookingVisible = ref(false);
const walkinVisible = ref(false);
const editVisible = ref(false);
const checkinVisible = ref(false);
const checkoutVisible = ref(false);
const changeRoomVisible = ref(false);
const folioVisible = ref(false);
const currentRes = ref(null);
const initialForm = ref(null);

const floors = computed(() => [...new Set(statusRooms.value.map((x) => x.room.floor))].sort((a, b) => a - b));

const visibleFloors = computed(() => {
  const set = new Set();
  for (const item of filteredRooms.value) set.add(item.room.floor);
  return [...set].sort((a, b) => a - b);
});

// 房型 / 楼层 / 房号或姓名 筛选（房态筛选前的基础集合）
const baseRooms = computed(() =>
  statusRooms.value.filter((x) => {
    if (filterType.value && x.room.type_id !== filterType.value) return false;
    if (filterFloor.value != null && x.room.floor !== filterFloor.value) return false;
    if (keyword.value && keyword.value.trim()) {
      const k = keyword.value.trim().toLowerCase();
      const roomHit = (x.room.room_no || '').toLowerCase().includes(k);
      const guestHit = (x.reservation?.guest_name || '').toLowerCase().includes(k);
      if (!roomHit && !guestHit) return false;
    }
    return true;
  })
);

// 房态筛选
const filteredRooms = computed(() => {
  if (!checkedStatuses.value.length) return [];
  return baseRooms.value.filter((x) => checkedStatuses.value.includes(x.eff_status));
});

// 各房态房间数（基于房型/楼层筛选后的集合）
const statusCounts = computed(() => {
  const counts = {};
  for (const x of baseRooms.value) counts[x.eff_status] = (counts[x.eff_status] || 0) + 1;
  return counts;
});

const roomsByFloor = computed(() => {
  const map = {};
  for (const item of filteredRooms.value) {
    if (!map[item.room.floor]) map[item.room.floor] = [];
    map[item.room.floor].push(item);
  }
  return map;
});

const detailTitle = computed(() =>
  detailItem.value ? `房间 ${detailItem.value.room.room_no} - ${detailItem.value.room.type_name}` : ''
);

function cardStyle(item) {
  const s = ROOM_STATUS[item.eff_status];
  return {
    background: s.bg,
    borderColor: s.color,
  };
}
function guestText(item) {
  if (item.reservation) return item.reservation.guest_name;
  if (item.eff_status === 'ooo') return '维修封房';
  return ROOM_STATUS[item.eff_status].text;
}
function dateText(item) {
  if (item.reservation?.status === 'checked_in') return `离：${item.reservation.check_out_date}`;
  if (item.reservation?.status === 'reserved') return `抵：${item.reservation.check_in_date}`;
  return '';
}

async function load() {
  const [data, types] = await Promise.all([
    http.get('/room-status', { params: { date: date.value } }),
    http.get('/room-types'),
  ]);
  statusRooms.value = data.rooms;
  roomTypes.value = types;
}
function toggleStatus(key) {
  const idx = checkedStatuses.value.indexOf(key);
  if (idx >= 0) checkedStatuses.value.splice(idx, 1);
  else checkedStatuses.value.push(key);
}

function openDetail(item) {
  detailItem.value = item;
  detailVisible.value = true;
}
function setCurrentRes() {
  const item = detailItem.value;
  currentRes.value = item.reservation ? { ...item.reservation, type_name: item.room.type_name, room_no: item.room.room_no } : null;
}

function doCheckin() { setCurrentRes(); checkinVisible.value = true; }
function doCheckout() { setCurrentRes(); checkoutVisible.value = true; }
function openEdit() { setCurrentRes(); editVisible.value = true; }
function openChangeRoom() { setCurrentRes(); changeRoomVisible.value = true; }
function openFolio() { setCurrentRes(); folioVisible.value = true; }
function openBooking() {
  initialForm.value = { room_id: detailItem.value.room.id, room_type_id: detailItem.value.room.type_id };
  bookingVisible.value = true;
}
function openWalkin() {
  initialForm.value = { room_id: detailItem.value.room.id, room_type_id: detailItem.value.room.type_id };
  walkinVisible.value = true;
}

async function setHouseStatus(status) {
  const labels = { clean: '设为干净', dirty: '设为脏', ooo: '维修封房' };
  try {
    await ElMessageBox.confirm(`确认将房间 ${detailItem.value.room.room_no} ${labels[status]}？`, '提示', { type: 'warning' });
  } catch (e) {
    return;
  }
  await http.put(`/rooms/${detailItem.value.room.id}/status`, { status });
  ElMessage.success('客房状态已更新');
  await load();
  store.loadStats();
}

async function onSaved() {
  detailVisible.value = false;
  await load();
  store.loadStats();
}

onMounted(load);
</script>

<style scoped>
.room-status-layout { display: flex; align-items: flex-start; gap: 14px; }
.filter-panel { width: 220px; flex-shrink: 0; overflow: hidden; transition: width .2s ease; }
.filter-panel .el-card__body { display: flex; flex-direction: column; gap: 16px; padding: 12px 14px; }
.filter-panel.collapsed { width: 48px; }
.filter-panel.collapsed .el-card__body { padding: 12px 6px; gap: 0; }
.filter-head { display: flex; align-items: center; justify-content: space-between; min-height: 24px; }
.filter-panel.collapsed .filter-head { justify-content: center; }
.filter-title { font-size: 16px; font-weight: 700; color: #212529; }
.filter-item { display: flex; flex-direction: column; gap: 6px; }
.filter-label { font-size: 12px; color: #868e96; }
.status-filter { display: flex; flex-direction: column; gap: 4px; }
.status-filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #343a40;
  background: #f8f9fa;
  transition: background .12s ease, opacity .12s ease;
}
.status-filter-item:hover { background: #e9ecef; }
.status-filter-item.off { opacity: .45; }
.status-filter-item .dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.status-filter-item .status-name { flex: 1; }
.status-filter-item .status-count { font-size: 12px; color: #868e96; }
.filter-result { font-size: 13px; color: #495057; }
.rooms-content { flex: 1; min-width: 0; }

.floor-card { margin-bottom: 14px; }
.floor-header { display: flex; align-items: center; gap: 10px; }
.floor-title { font-size: 16px; font-weight: 700; }
.floor-count { font-size: 12px; color: #868e96; }

.rooms { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; }
.room-card {
  position: relative;
  border: 2px solid;
  border-radius: 8px;
  padding: 10px 10px 8px;
  cursor: pointer;
  transition: transform .12s ease, box-shadow .12s ease;
}
.room-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 10px rgba(0,0,0,.12);
}
.status-dot { position: absolute; top: 8px; right: 8px; width: 8px; height: 8px; border-radius: 50%; }
.room-no { font-size: 19px; font-weight: 800; color: #212529; }
.room-type { font-size: 11px; color: #868e96; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.room-guest { font-size: 13px; font-weight: 600; color: #343a40; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.room-date { font-size: 11px; color: #868e96; }
.room-status-text { position: absolute; bottom: 8px; right: 10px; font-size: 12px; font-weight: 600; }

.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
</style>
