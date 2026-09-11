<template>
  <div class="room-panel" v-if="item">
    <!-- 头部标题 + 徽标 -->
    <div class="panel-head">
      <div class="panel-title">
        <span class="title-type">{{ item.room.type_name }}</span>
        <span class="title-no">{{ item.room.room_no }}</span>
        <template v-for="b in headerBadges" :key="b.key">
          <span class="h-badge" :class="b.cls">{{ b.text }}</span>
        </template>
      </div>
      <el-button text class="panel-close" title="关闭" @click="$emit('close')">
        <el-icon><Close /></el-icon>
      </el-button>
    </div>

    <!-- 快捷操作（分组） -->
    <div class="panel-actions">
      <div v-for="g in actionGroups" :key="g.label" class="action-row">
        <span class="action-label">{{ g.label }}</span>
        <div class="action-btns">
          <el-button
            v-for="a in g.items"
            :key="a.key"
            size="small"
            :type="a.type || ''"
            :plain="a.plain"
            :disabled="a.disabled"
            :title="a.title || ''"
            @click="$emit(a.event, a.status)"
          >
            {{ a.text }}
          </el-button>
          <span v-if="!g.items.length" class="action-empty">—</span>
        </div>
      </div>
    </div>

    <el-divider />

    <!-- 详细信息 -->
    <div class="panel-info">
      <div class="info-grid">
        <template v-if="stay">
          <div class="info-item">
            <span class="k">客人姓名</span>
            <span class="v guest">{{ guestNames }}</span>
          </div>
          <div class="info-item">
            <span class="k">入住时间</span>
            <span class="v">{{ checkInText }}</span>
          </div>
          <div class="info-item">
            <span class="k">入住类型</span>
            <span class="v">{{ stay.booking_type || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="k">预离时间</span>
            <span class="v">{{ stay.check_out_date || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="k">渠道名称</span>
            <span class="v">{{ stay.source || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="k">房价</span>
            <span class="v rate">{{ fmtMoney(stay.rate) }}</span>
          </div>
          <div class="info-item">
            <span class="k">消费</span>
            <span class="v amt-out">−{{ fmtMoney(summary?.consumption || 0) }}</span>
          </div>
          <div class="info-item">
            <span class="k">收款</span>
            <span class="v amt-in">+{{ fmtMoney(summary?.payment || 0) }}</span>
          </div>
          <div class="info-item">
            <span class="k">账户余额</span>
            <span class="v" :class="bal.cls">{{ bal.sign }}{{ bal.text }}（{{ bal.label }}）</span>
          </div>
          <div class="info-item">
            <span class="k">订单号</span>
            <span class="v">{{ stay.order_no || '-' }}</span>
          </div>
          <div class="info-item">
            <span class="k">来源单号</span>
            <span class="v">{{ stay.source_order_no || '-' }}</span>
          </div>
        </template>
        <template v-else>
          <div class="info-item">
            <span class="k">房型</span>
            <span class="v">{{ item.room.type_name }}</span>
          </div>
          <div class="info-item">
            <span class="k">门市价</span>
            <span class="v rate">{{ fmtMoney(item.room.type_price) }}</span>
          </div>
          <div class="info-item">
            <span class="k">房态</span>
            <span class="v">{{ statusMeta?.text || '-' }}</span>
          </div>
        </template>
        <div class="info-item info-full">
          <span class="k">房间备注</span>
          <span class="v note">{{ item.room.remark || stay?.remark || '-' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { Close } from '@element-plus/icons-vue';
import { fmtMoney, fmtDate, nightsBetween, ROOM_STATUS } from '../utils/format';
import { balanceView } from '../utils/money';

const props = defineProps({
  item: { type: Object, default: null },
  summary: { type: Object, default: null }, // { consumption, payment, balance }
});
const emit = defineEmits(['close', 'checkout', 'edit', 'renew', 'change-room', 'folio', 'checkin', 'book', 'walkin', 'set-house-status', 'open-order', 'card', 'read-card']);

const stay = computed(() => props.item?.reservation || null);
// 该间在住人：入住人 + 同住人（详情里显示全部）
const guestNames = computed(() => {
  const s = stay.value;
  if (!s) return '';
  const names = [];
  const primary = (s.unit_guest_name || '').trim();
  if (primary) names.push(primary);
  let coh = [];
  try { coh = JSON.parse(s.unit_cohabitors || '[]'); } catch { /* 忽略脏数据 */ }
  for (const c of coh) {
    const n = String(c?.name || '').trim();
    if (n) names.push(n);
  }
  return names.join('、') || s.guest_name;
});
const statusMeta = computed(() => (props.item ? ROOM_STATUS[props.item.eff_status] : null));
// 续住前提：当前房间预离日 = 今日
const dueToday = computed(() => String(stay.value?.check_out_date || '') === fmtDate());
// 该房当前是否已入住（部分入住时预订状态仍为 reserved，但该房间已占）
const isOccupied = computed(() => ['occupied_clean', 'occupied_dirty', 'due_out'].includes(props.item?.eff_status));

// ---- 徽标 ----
function nightsAway(dateStr) {
  return nightsBetween(fmtDate(), dateStr);
}
const headerBadges = computed(() => {
  const list = [];
  const res = stay.value;
  if (res) {
    if (isOccupied.value) {
      const d = nightsAway(res.check_out_date);
      if (d === 0) list.push({ key: 'leave', text: '今日离', cls: 'badge-red' });
      else if (d > 0) list.push({ key: 'leave', text: `${d}日离`, cls: 'badge-red' });
      list.push({ key: 'time', text: res.booking_type === '钟点房' ? '次' : '全', cls: res.booking_type === '钟点房' ? 'badge-purple' : 'badge-blue' });
    } else if (res.status === 'reserved') {
      const d = nightsAway(res.check_in_date);
      if (d === 0) list.push({ key: 'arr', text: '今日抵', cls: 'badge-orange' });
      else if (d > 0) list.push({ key: 'arr', text: `${d}日抵`, cls: 'badge-orange' });
    }
  }
  if (res?.source && res.source !== '散客') list.push({ key: 'ch', text: res.source, cls: 'badge-cyan' });
  return list;
});

// ---- 快捷操作分组 ----
const houseActions = () => {
  const s = props.item.room.status;
  const isVacant = ['vacant_clean', 'vacant_dirty'].includes(props.item?.eff_status);
  const list = [];
  if (s === 'dirty') list.push({ key: 'clean', text: '置净', status: 'clean', type: 'primary', event: 'set-house-status' });
  else if (s === 'clean') list.push({ key: 'dirty', text: '置脏', status: 'dirty', type: 'warning', event: 'set-house-status' });
  if (s !== 'ooo') list.push({ key: 'ooo', text: '维修封房', status: 'ooo', type: 'danger', event: 'set-house-status' });
  // 锁房：仅空房可用（服务端同样校验）
  if (isVacant) list.push({ key: 'lock', text: '锁房', status: 'locked', type: 'warning', plain: true, event: 'set-house-status' });
  return list;
};

const actionGroups = computed(() => {
  if (!props.item) return [];
  const st = props.item.eff_status;
  const res = stay.value;
  const groups = [];

  if (res && isOccupied.value) {
    groups.push({ label: '账务', items: [
      { key: 'detail', text: '详单', event: 'open-order', type: 'primary' },
      { key: 'checkout', text: '结账退房', event: 'checkout', type: 'danger' },
      { key: 'prepay', text: '入收款', event: 'folio', type: 'primary', plain: true },
      { key: 'acc', text: '账务', event: 'folio', type: 'primary', plain: true },
    ] });
    groups.push({ label: '接待', items: [
      { key: 'ext', text: '续住', event: 'renew', type: 'primary', disabled: !dueToday, title: dueToday ? '' : '仅可对今日离店的房间续住' },
      { key: 'chg', text: '换房', event: 'change-room', type: 'primary', plain: true },
      { key: 'card', text: '制卡', event: 'card', type: 'success' },
      { key: 'read', text: '读卡', event: 'read-card', type: 'info', plain: true },
    ] });
    groups.push({ label: '房态', items: houseActions() });
  } else if (res && ['cancelled', 'no_show', 'checked_out'].includes(res.status)) {
    // 终态订单：只读，仅账单
    groups.push({ label: '账务', items: [{ key: 'acc', text: '账单', event: 'folio', type: 'primary' }] });
    groups.push({ label: '接待', items: [] });
    groups.push({ label: '房态', items: [] });
  } else if (res) {
    // 预抵预订（reserved，含部分入住订单中尚未到店的子单）——展示「预定转入住」
    groups.push({ label: '账务', items: [{ key: 'acc', text: '账单', event: 'folio', type: 'primary' }] });
    groups.push({ label: '接待', items: [
      { key: 'ci', text: '预定转入住', event: 'checkin', type: 'success' },
      { key: 'edit', text: '改单', event: 'edit', type: 'primary', plain: true },
    ] });
    groups.push({ label: '房态', items: [] });
  } else if (['vacant_clean', 'vacant_dirty'].includes(st)) {
    groups.push({ label: '接待', items: [
      { key: 'book', text: '预订', event: 'book', type: 'primary' },
      { key: 'walkin', text: '散客入住', event: 'walkin', type: 'success' },
    ] });
    groups.push({ label: '房态', items: houseActions() });
  } else if (st === 'ooo') {
    groups.push({ label: '房态', items: [
      { key: 'uclean', text: '解封(干净)', status: 'clean', event: 'set-house-status', type: 'primary', plain: true },
      { key: 'udirty', text: '解封(脏)', status: 'dirty', event: 'set-house-status', type: 'warning', plain: true },
    ] });
  } else if (st === 'locked') {
    groups.push({ label: '接待', items: [] });
    groups.push({ label: '房态', items: [
      { key: 'ulock-clean', text: '解锁(干净)', status: 'clean', event: 'set-house-status', type: 'primary', plain: true },
      { key: 'ulock-dirty', text: '解锁(脏)', status: 'dirty', event: 'set-house-status', type: 'warning', plain: true },
    ] });
  }

  // 非在住状态也提供「读卡」入口（核对卡片）
  const hasRead = groups.some((g) => g.items.some((a) => a.event === 'read-card'));
  if (!hasRead) {
    groups.push({ label: '门锁', items: [{ key: 'read', text: '读卡', event: 'read-card', type: 'info', plain: true }] });
  }
  return groups;
});

// ---- 信息 ----
const checkInText = computed(() => stay.value?.actual_check_in || stay.value?.check_in_date || '-');
const bal = computed(() => balanceView(props.summary?.balance || 0));
</script>

<style scoped>
.room-panel { display: flex; flex-direction: column; padding: 16px; }

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 12px;
}
.panel-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; line-height: 1.4; }
.title-type { font-size: 18px; font-weight: 700; color: #212529; }
.title-no { font-size: 18px; font-weight: 800; color: #1c7ed6; }
.h-badge {
  font-size: 12px; font-weight: 600; color: #fff;
  border-radius: 4px; padding: 1px 8px;
}
.badge-red { background: #e03131; }
.badge-blue { background: #1c7ed6; }
.badge-purple { background: #7048e8; }
.badge-orange { background: #e8590c; }
.badge-cyan { background: #0ca678; }
.panel-close { color: #868e96; flex-shrink: 0; }

.panel-actions { display: flex; flex-direction: column; gap: 10px; }
.action-row { display: flex; align-items: center; gap: 10px; }
.action-label {
  width: 40px; flex-shrink: 0;
  font-size: 13px; color: #868e96; text-align: right;
}
.action-btns { display: flex; flex-wrap: wrap; gap: 8px; flex: 1; min-width: 0; }
.action-empty { color: #ced4da; font-size: 13px; }

.panel-info { overflow: auto; }
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 20px;
}
.info-item { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.info-item.info-full { grid-column: 1 / -1; }
.info-item .k { font-size: 12px; color: #868e96; }
.info-item .v { font-size: 14px; color: #303133; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.info-item .v.guest { color: #1c7ed6; font-weight: 700; }
.info-item .v.rate { color: #1c7ed6; font-weight: 700; }
.info-item .v.amt-in { color: #e03131; font-weight: 700; }
.info-item .v.amt-out { color: #2f9e44; font-weight: 700; }
.info-item .v.bal-credit { color: #e03131; font-weight: 700; }
.info-item .v.bal-due { color: #2f9e44; font-weight: 700; }
.info-item .v.bal-settled { color: #868e96; font-weight: 700; }
.info-item .v.note { white-space: normal; font-size: 13px; color: #495057; }
</style>
