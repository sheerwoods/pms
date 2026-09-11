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
            @click="openDetail(item, $event)"
          >
            <div class="card-top">
              <span class="room-no">{{ item.room.room_no }}</span>
              <span v-if="channelBadge(item)" class="channel-tag">{{ channelBadge(item) }}</span>
            </div>
            <template v-if="item.reservation">
              <div class="room-type">{{ item.room.type_name }}</div>
              <div class="room-guest">{{ guestText(item) }}</div>
              <div class="card-badges">
                <span v-for="b in badges(item)" :key="b.key" class="badge" :class="b.cls">{{ b.text }}</span>
              </div>
            </template>
            <span class="room-status-text" :style="{ color: statusMeta(item).color }">
              {{ statusMeta(item).text }}
            </span>
          </div>
        </div>
      </el-card>
      <div v-if="!visibleFloors.length" class="empty-state">
        <el-empty :description="loadFailed ? '数据加载失败' : '暂无房间'" />
        <el-button v-if="loadFailed" type="primary" plain @click="load">重试</el-button>
      </div>
    </div>

    <!-- 点击房态旁弹出的详情气泡框 -->
    <div
      v-if="bubbleVisible && detailItem"
      ref="bubbleRef"
      class="room-bubble"
      :class="{ flip: bubblePos.flip }"
      :style="{ left: bubblePos.left, top: bubblePos.top }"
    >
      <i class="bubble-tail"></i>
      <RoomDetailPanel
        :item="detailItem"
        :summary="detailSummary"
        @close="closeDetail"
        @checkout="doCheckout"
        @edit="openEdit"
        @change-room="openChangeRoom"
        @folio="openFolio"
        @checkin="doCheckin"
        @book="openBooking"
        @walkin="openWalkin"
        @set-house-status="setHouseStatus"
        @open-order="openOrder"
      />
    </div>

    <!-- 子对话框 -->
    <ReservationForm v-model:visible="bookingVisible" mode="create" :initial="initialForm" @saved="onSaved" />
    <ReservationForm v-model:visible="walkinVisible" mode="walkin" :initial="initialForm" @saved="onSaved" />
    <ReservationForm v-model:visible="editVisible" mode="edit" :reservation="currentRes" @saved="onSaved" />
    <CheckInDialog v-model:visible="checkinVisible" :reservation="currentRes" @saved="onSaved" />
    <CheckOutDialog v-model:visible="checkoutVisible" :reservation="currentRes" @saved="onSaved" />
    <ChangeRoomDialog v-model:visible="changeRoomVisible" :reservation="currentRes" :unit-id="currentUnitId" @saved="onSaved" />
    <FolioDialog v-model:visible="folioVisible" :reservation-id="currentRes?.id" @changed="onSaved" />
    <OrderDetailDialog v-model:visible="orderDetailVisible" :reservation-id="currentOrderId" :room-id="currentRoomId" @changed="onSaved" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import { Fold, Expand, Search } from '@element-plus/icons-vue';
import http from '../api';
import { store } from '../store';
import { fmtDate, nightsBetween, ROOM_STATUS } from '../utils/format';
import ReservationForm from '../components/ReservationForm.vue';
import CheckInDialog from '../components/CheckInDialog.vue';
import CheckOutDialog from '../components/CheckOutDialog.vue';
import ChangeRoomDialog from '../components/ChangeRoomDialog.vue';
import FolioDialog from '../components/FolioDialog.vue';
import RoomDetailPanel from '../components/RoomDetailPanel.vue';
import OrderDetailDialog from '../components/OrderDetailDialog.vue';

const date = ref(fmtDate());
const roomTypes = ref([]);
const statusRooms = ref([]);
const filterType = ref(null);
const filterFloor = ref(null);
const keyword = ref('');
const checkedStatuses = ref(Object.keys(ROOM_STATUS));
const filterCollapsed = ref(false);

const bubbleVisible = ref(false);
const detailItem = ref(null);
const detailSummary = ref(null);
const bubblePos = ref({ left: '0px', top: '0px', flip: false });
const bubbleRef = ref(null);

const bookingVisible = ref(false);
const walkinVisible = ref(false);
const editVisible = ref(false);
const checkinVisible = ref(false);
const checkoutVisible = ref(false);
const changeRoomVisible = ref(false);
const folioVisible = ref(false);
const currentRes = ref(null);
const currentUnitId = ref(null);
const initialForm = ref(null);
const orderDetailVisible = ref(false);
const currentOrderId = ref(null);
const currentRoomId = ref(null);

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

// ---- 房态卡片辅助 ----
function statusMeta(item) {
  return ROOM_STATUS[item.eff_status] || { text: item.eff_status || '未知', color: '#868e96', bg: '#f1f3f5' };
}
function cardStyle(item) {
  const s = statusMeta(item);
  return { background: s.bg, borderColor: s.color };
}
function guestText(item) {
  if (item.reservation) return item.reservation.guest_name;
  if (item.eff_status === 'ooo') return '维修封房';
  return statusMeta(item).text;
}
function channelBadge(item) {
  const s = item.reservation?.source;
  return s && s !== '散客' ? s : '';
}
function daysAway(dateStr) {
  return nightsBetween(fmtDate(), dateStr);
}
// 该房当前是否已入住（部分入住时预订状态仍为 reserved，但该房间已占）
function isOccupiedRoom(item) {
  return ['occupied_clean', 'occupied_dirty', 'due_out'].includes(item.eff_status);
}
function badges(item) {
  const list = [];
  const res = item.reservation;
  if (res) {
    if (isOccupiedRoom(item)) {
      const d = daysAway(res.check_out_date);
      if (d === 0) list.push({ key: 'leave', text: '今日离', cls: 'badge-red' });
      else if (d > 0) list.push({ key: 'leave', text: `${d}日离`, cls: 'badge-red' });
      list.push({ key: 'time', text: res.booking_type === '钟点房' ? '次' : '全', cls: res.booking_type === '钟点房' ? 'badge-purple' : 'badge-blue' });
    } else if (res.status === 'reserved') {
      const d = daysAway(res.check_in_date);
      if (d === 0) list.push({ key: 'arr', text: '今日抵', cls: 'badge-orange' });
      else if (d > 0) list.push({ key: 'arr', text: `${d}日抵`, cls: 'badge-orange' });
    }
  }
  return list;
}

// ---- 数据加载 ----
const loadFailed = ref(false);
async function load() {
  try {
    const [data, types] = await Promise.all([
      http.get('/room-status', { params: { date: date.value } }),
      http.get('/room-types'),
    ]);
    statusRooms.value = data.rooms;
    roomTypes.value = types;
    loadFailed.value = false;
  } catch (e) {
    loadFailed.value = true;
  }
}

// ---- 详情气泡 ----
async function loadSummary(item) {
  detailSummary.value = null;
  if (!item.reservation) return;
  try {
    const folio = await http.get('/finance/folio', { params: { reservation_id: item.reservation.id } });
    const s = folio.summary || {};
    detailSummary.value = {
      consumption: s.charges || 0,
      payment: s.payments || 0,
      balance: s.accountBalance || 0,   // 账户余额：>0 应退客人，<0 客人欠款
      deposit: s.depositBalance || 0,
    };
  } catch (e) {
    detailSummary.value = null;
  }
}

function openDetail(item, ev) {
  const bw = 380;
  const gap = 10;
  const vw = window.innerWidth;
  let left, flip = false;
  if (ev && ev.currentTarget) {
    const cardRect = ev.currentTarget.getBoundingClientRect();
    left = cardRect.right + gap;
    if (left + bw > vw - 8) {
      left = cardRect.left - gap - bw;
      flip = true;
    }
    left = Math.max(8, Math.min(left, vw - bw - 8));
  } else {
    left = vw - bw - 24;
  }
  const top = ev && ev.currentTarget ? Math.max(8, ev.currentTarget.getBoundingClientRect().top - 4) : 8;
  bubblePos.value = { left: `${left}px`, top: `${top}px`, flip };
  detailItem.value = item;
  bubbleVisible.value = true;
  loadSummary(item);
}

function closeDetail() {
  bubbleVisible.value = false;
  detailItem.value = null;
  detailSummary.value = null;
}

async function refreshDetail() {
  if (!detailItem.value) return;
  const id = detailItem.value.room.id;
  const fresh = statusRooms.value.find((x) => x.room.id === id);
  if (fresh) {
    detailItem.value = fresh;
    await loadSummary(fresh);
  } else {
    closeDetail();
  }
}

function onDocClick(e) {
  if (!bubbleVisible.value) return;
  if (bubbleRef.value && bubbleRef.value.contains(e.target)) return;
  if (e.target.closest && e.target.closest('.room-card')) return;
  closeDetail();
}
function onKeydown(e) {
  if (e.key === 'Escape') closeDetail();
}

function toggleStatus(key) {
  const idx = checkedStatuses.value.indexOf(key);
  if (idx >= 0) checkedStatuses.value.splice(idx, 1);
  else checkedStatuses.value.push(key);
}

function setCurrentRes() {
  const item = detailItem.value;
  currentRes.value = item.reservation ? { ...item.reservation, type_name: item.room.type_name, room_no: item.room.room_no } : null;
  currentUnitId.value = item.reservation?.unit_id ?? null;
}

function doCheckin() { setCurrentRes(); checkinVisible.value = true; }
async function doCheckout() {
  const item = detailItem.value;
  if (!item?.reservation) return;
  const res = item.reservation;
  const unitId = res.unit_id;
  // 仅剩这一间在住且无待入住子单时走整单结算弹窗；否则按子单单间退房，其余子单继续
  const soleInHouse = (res.checked_in_units || 0) <= 1 && (res.pending_units || 0) === 0;
  if (!soleInHouse && unitId) {
    const roomNo = item.room.room_no;
    try {
      await ElMessageBox.confirm(`确认房间 ${roomNo} 结账退房？其余房间继续在住，共用同一账单。`, '提示', { type: 'warning' });
    } catch (e) { return; }
    await http.post(`/reservations/${res.id}/rooms/${unitId}/check-out`, { actual_check_out: fmtDate() });
    ElMessage.success('该房间已退房');
    await load();
    store.loadStats();
    await refreshDetail();
    return;
  }
  setCurrentRes();
  checkoutVisible.value = true;
}
function openEdit() { setCurrentRes(); editVisible.value = true; }
function openChangeRoom() { setCurrentRes(); changeRoomVisible.value = true; }
function openFolio() { setCurrentRes(); folioVisible.value = true; }
function openOrder() {
  const item = detailItem.value;
  if (!item?.reservation) return;
  currentOrderId.value = item.reservation.id;
  currentRoomId.value = item.room.id;
  orderDetailVisible.value = true;
}
function openBooking() {
  initialForm.value = { room_id: detailItem.value.room.id, room_type_id: detailItem.value.room.type_id };
  bookingVisible.value = true;
}
function openWalkin() {
  const r = detailItem.value.room;
  initialForm.value = { room_id: r.id, room_type_id: r.type_id, room_no: r.room_no, type_name: r.type_name };
  walkinVisible.value = true;
}

async function setHouseStatus(status) {
  const labels = { clean: '设为干净', dirty: '设为脏', ooo: '维修封房' };
  const roomNo = detailItem.value.room.room_no;
  try {
    await ElMessageBox.confirm(`确认将房间 ${roomNo} ${labels[status]}？`, '提示', { type: 'warning' });
  } catch (e) {
    return;
  }
  await http.put(`/rooms/${detailItem.value.room.id}/status`, { status });
  ElMessage.success('客房状态已更新');
  await load();
  store.loadStats();
  await refreshDetail();
}

async function onSaved() {
  await load();
  store.loadStats();
  await refreshDetail();
}

onMounted(() => {
  load();
  store.loadStats();
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocClick);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
.room-status-layout { display: flex; align-items: flex-start; gap: 14px; }

/* 左侧筛选 */
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

/* 房间宫格 */
.rooms-content { flex: 1; min-width: 0; }
.floor-card { margin-bottom: 4px; }
.floor-card :deep(.el-card__header) { padding: 3px 8px; }
.floor-card :deep(.el-card__body) { padding: 8px; }
.floor-header { display: flex; align-items: center; gap: 8px; line-height: 18px; }
.floor-title { font-size: 13px; font-weight: 600; color: #495057; }
.floor-count { font-size: 11px; color: #868e96; }

.rooms { display: grid; grid-template-columns: repeat(auto-fill, 112px); gap: 8px; }

.room-card {
  position: relative;
  aspect-ratio: 1 / 1;
  border: 2px solid;
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  transition: transform .12s ease, box-shadow .12s ease;
  overflow: hidden;
}
.room-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 10px rgba(0,0,0,.12);
}
.card-top { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.room-no { font-size: 18px; font-weight: 800; color: #212529; }
.channel-tag {
  flex-shrink: 0;
  font-size: 10px; font-weight: 600; color: #fff;
  background: #0ca678;
  border-radius: 4px;
  padding: 0 4px;
}
.room-type { font-size: 10px; color: #868e96; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.room-guest { font-size: 13px; font-weight: 700; color: #343a40; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.card-badges { display: flex; gap: 3px; margin-top: 4px; flex-wrap: wrap; }
.badge {
  font-size: 10px; font-weight: 600; color: #fff;
  border-radius: 3px; padding: 0 5px;
}
.badge-red { background: #e03131; }
.badge-blue { background: #1c7ed6; }
.badge-purple { background: #7048e8; }
.badge-orange { background: #e8590c; }
.room-status-text {
  position: absolute; bottom: 6px; left: 8px;
  font-size: 11px; font-weight: 600;
}

/* 气泡详情框 */
.room-bubble {
  position: fixed;
  z-index: 1500;
  width: 380px;
  max-height: calc(100vh - 32px);
  overflow: auto;
  background: #fff;
  border: 1px solid #e9ecef;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,.12);
}
.bubble-tail {
  position: absolute;
  left: -7px;
  top: 16px;
  width: 12px;
  height: 12px;
  background: #fff;
  border-left: 1px solid #e9ecef;
  border-bottom: 1px solid #e9ecef;
  transform: rotate(45deg);
}
.room-bubble.flip .bubble-tail {
  left: auto;
  right: -7px;
  border-left: none;
  border-bottom: 1px solid #e9ecef;
  border-right: 1px solid #e9ecef;
  transform: rotate(-45deg);
}
</style>
