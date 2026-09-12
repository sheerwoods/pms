<template>
  <el-dialog
    :model-value="visible"
    title="订单详情"
    width="1000px"
    top="4vh"
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
    @closed="reset"
    class="order-detail-dialog"
  >
    <div v-if="detail" class="od-body" @click="onBodyClick">
      <!-- 顶部摘要 -->
      <div class="od-head">
        <span class="od-no">{{ detail.order_no }}</span>
        <el-tag size="small" :type="statusMeta?.type">{{ statusMeta?.text }}</el-tag>
        <span class="od-guest">{{ detail.guest_name }}</span>
      </div>

      <el-tabs v-model="tab" class="od-tabs">
        <!-- 客单 -->
        <el-tab-pane label="客单" name="guest">
          <!-- ======== 预订单（尚未入住） ======== -->
          <template v-if="viewMode === 'reserved'">
            <div class="od-card information">
              <div class="od-grid">
                <div class="od-item"><span class="k">预订房型</span><span class="v note">{{ typeSummary }}</span></div>
                <div class="od-item"><span class="k">预定人</span><span class="v">{{ detail.guest_name || '-' }}</span></div>
                <div class="od-item"><span class="k">预定手机号</span><span class="v">{{ detail.guest_phone || '-' }}</span></div>
                <div class="od-item"><span class="k">入住时间</span><span class="v">{{ detail.check_in_date }}</span></div>
                <div class="od-item"><span class="k">离店时间</span><span class="v">{{ detail.check_out_date }} 16:00:00</span></div>
                <div class="od-item"><span class="k">晚数</span><span class="v">{{ nightsText }}</span></div>
                <div class="od-item"><span class="k">预订类型</span><span class="v">{{ detail.booking_type || '全日房' }}</span></div>
                <div class="od-item"><span class="k">来源</span><span class="v">{{ detail.source || '-' }}</span></div>
                <div class="od-item"><span class="k">来源单号</span><span class="v">{{ detail.source_order_no || '-' }}</span></div>
                <div class="od-item"><span class="k">预计总额</span><span class="v rate">{{ fmtMoney(detail.total_amount) }}</span></div>
                <div class="od-item"><span class="k">订单号</span><span class="v">{{ detail.order_no }}</span></div>
                <div class="od-item"><span class="k">备注</span><span class="v note">{{ detail.remark || '-' }}</span></div>
              </div>
            </div>

            <!-- ① 房价明细 -->
            <div v-if="lineRows.length" class="od-card">
              <div class="od-lines">
                <div v-for="(lr, i) in lineRows" :key="i" class="od-line-row">
                  <span class="ol-type">{{ lr.name }}</span>
                  <span class="ol-rooms">{{ lr.rooms }} 间 × {{ nightsCount }} 晚</span>
                  <span class="ol-rates">{{ perNightText(lr) }}</span>
                  <span class="ol-subtotal">{{ fmtMoney(lr.subtotal) }}</span>
                </div>
              </div>
            </div>

            <!-- ② 房间安排 -->
            <div class="od-card">
              <div class="od-grid">
                <div class="od-item"><span class="k">已排房</span><span class="v">{{ assignedRoomNosText || '-' }}（{{ assignedCount }}间）</span></div>
                <div class="od-item"><span class="k">未排房</span><span class="v">{{ unassignedCount }}间</span></div>
                <div class="od-item"><span class="k">房间单元</span><span class="v note">{{ roomListText }}</span></div>
              </div>
            </div>
          </template>

          <!-- ======== 在住单（已入住，含部分入住） ======== -->
          <template v-else-if="viewMode === 'inhouse'">
            <!-- 同一订单的全部房间子单：在住/已退/待入住 -->
            <div v-if="rooms.length > 1" class="order-rooms">
              <span class="or-label">房间子单</span>
              <div
                v-for="r in rooms"
                :key="r.id"
                class="or-item"
                :class="{ active: Number(activeUnitId) === Number(r.id) }"
                @click="activeUnitId = r.id"
              >
                <b>{{ r.room_no || '待排' }}</b>
                <span class="or-guest">{{ r.guest_name || '—' }}</span>
                <em :class="r.status === 'checked_in' ? 's-ok' : (r.status === 'checked_out' ? 's-off' : 's-idle')">{{ roomStatusText(r.status) }}</em>
              </div>
            </div>

            <!-- ① 房间/订单信息 -->
            <div class="od-card information">
              <div class="od-grid">
                <div class="od-item"><span class="k">房型</span><span class="v">{{ roomTypeName }}</span></div>
                <div class="od-item"><span class="k">房号</span><span class="v no">{{ roomText }}</span></div>
                <div class="od-item"><span class="k">入住时间</span><span class="v">{{ checkInText }}</span></div>
                <div class="od-item"><span class="k">离店时间</span><span class="v">{{ unitCheckOutDate }} 16:00:00</span></div>
                <div class="od-item"><span class="k">天数</span><span class="v">{{ unitNightsText }}</span></div>
                <div class="od-item"><span class="k">房价类型</span><span class="v">{{ detail.booking_type || '全日房' }}</span></div>
                <div class="od-item"><span class="k">来源</span><span class="v">{{ detail.source || '-' }}</span></div>
                <div class="od-item"><span class="k">来源单号</span><span class="v">{{ detail.source_order_no || '-' }}</span></div>
                <div class="od-item"><span class="k">续住来源</span><span class="v">{{ detail.renew_from_order_no || '-' }}</span></div>
                <div class="od-item"><span class="k">房间房价</span><span class="v rate">{{ fmtMoney(unitActualRate) }}</span></div>
                <div class="od-item"><span class="k">订单金额</span><span class="v">{{ fmtMoney(detail.total_amount) }}</span></div>
                <div class="od-item"><span class="k">订单号</span><span class="v">{{ detail.order_no }}</span></div>
                <div class="od-item">
                  <span class="k">备注</span>
                  <el-input v-if="roomEditing" v-model="roomEditForm.remark" class="remark-edit" size="small" type="textarea" :rows="1" placeholder="备注" style="width: 200px" />
                  <span v-else class="v note">{{ unitRemark || '-' }}</span>
                </div>
              </div>
              <div class="od-row-btns">
                <template v-if="roomEditing">
                  <el-button key="save" size="small" type="primary" :loading="savingRoom" @click.stop="saveRoom">保存</el-button>
                  <el-button key="cancel" size="small" @click.stop="cancelRoomEdit">取消</el-button>
                </template>
                <template v-else>
                  <el-button key="edit" v-if="curRoom.status === 'checked_in'" size="small" @click.stop="startRoomEdit">修改备注</el-button>
                  <el-button key="resv" v-if="curRoom.status !== 'checked_out'" size="small" @click.stop="openEdit">预定信息</el-button>
                </template>
              </div>
            </div>

            <!-- ② 客人信息（入住人，多客 tab + 信息网格）；待入住子单尚未登记入住人 -->
            <div v-if="curRoom.status !== 'pending'" class="od-card guest-card">
              <!-- 客人 tab：主客 + 同住人 -->
              <div class="guest-tabs">
                <span
                  v-for="(g, i) in occupants"
                  :key="i"
                  class="gt-item"
                  :class="{ active: Number(activeGuestIdx) === Number(i) }"
                  @click="activeGuestIdx = i"
                >{{ g.name || (g.isMain ? '主客' : '同住人') }}</span>
              </div>

              <div class="guest-main">
                <el-avatar :size="64" class="g-avatar"><el-icon :size="30"><UserFilled /></el-icon></el-avatar>
                <div class="g-info">
                  <!-- 姓名 直连公安 性别 联系方式 -->
                  <div class="g-row">
                    <div class="g-cell">
                      <span class="k">姓名</span>
                      <span v-if="!guestEditing" class="v name">{{ curGuest.name || '-' }}</span>
                      <el-input v-else v-model="guestForm.guest_name" size="small" />
                    </div>
                    <div class="g-cell"><span class="k">直连公安</span><span class="v">否</span></div>
                    <div class="g-cell"><span class="k">性别</span><span class="v muted">-</span></div>
                    <div class="g-cell">
                      <span class="k">联系方式</span>
                      <span v-if="!guestEditing" class="v">{{ curGuest.phone || '-' }}</span>
                      <el-input v-else v-model="guestForm.guest_phone" size="small" />
                    </div>
                  </div>
                  <!-- 证件类型 证件号码 民族 出生日期 -->
                  <div class="g-row">
                    <div class="g-cell"><span class="k">证件类型</span><span class="v">身份证</span></div>
                    <div class="g-cell">
                      <span class="k">证件号码</span>
                      <span v-if="!guestEditing" class="v">{{ curGuest.id_card || '-' }}</span>
                      <el-input v-else v-model="guestForm.guest_id_card" size="small" />
                    </div>
                    <div class="g-cell"><span class="k">民族</span><span class="v muted">-</span></div>
                    <div class="g-cell"><span class="k">出生日期</span><span class="v muted">-</span></div>
                  </div>
                  <!-- 入住时间 在住状态 会员等级 -->
                  <div class="g-row">
                    <div class="g-cell"><span class="k">入住时间</span><span class="v">{{ checkInText }}</span></div>
                    <div class="g-cell"><span class="k">在住状态</span><span class="v" :class="curRoom.status === 'checked_in' ? 'g-ok' : 'g-idle'">{{ roomStatus }}</span></div>
                    <div class="g-cell"><span class="k">会员等级</span><span class="v muted">-</span></div>
                  </div>
                </div>
              </div>

              <!-- 新增同住人：内联 -->
              <div v-if="cohabEditing" class="cohab-form">
                <span class="k">同住人</span>
                <el-input v-model="cohabForm.name" size="small" placeholder="姓名" style="width: 120px" />
                <el-input v-model="cohabForm.id_card" size="small" placeholder="身份证号（选填）" style="width: 180px" />
                <el-input v-model="cohabForm.phone" size="small" placeholder="手机号（选填）" style="width: 150px" />
              </div>

              <div class="od-row-btns">
                <template v-if="guestEditing">
                  <el-button size="small" type="primary" :loading="savingGuest" @click="saveGuest">保存</el-button>
                  <el-button size="small" @click="cancelGuestEdit">取消</el-button>
                </template>
                <template v-else-if="cohabEditing">
                  <el-button size="small" type="primary" :loading="savingCohab" @click="saveCohab">保存</el-button>
                  <el-button size="small" @click="cancelCohab">取消</el-button>
                </template>
                <template v-else-if="curRoom.status === 'checked_in'">
                  <el-button size="small" @click="startCohab">新增同住人</el-button>
                  <el-button size="small" @click="startGuestEdit">修改客人</el-button>
                  <el-button size="small" @click="openChangeRoom">单人换房{{ curGuest.name ? `（${curGuest.name}）` : '' }}</el-button>
                  <el-button size="small" @click="doEarlyCheckout">单人离店{{ curGuest.name ? `（${curGuest.name}）` : '' }}</el-button>
                </template>
              </div>
            </div>
          </template>

          <!-- ======== 终态单（已退/已取消/未到）：只读 ======== -->
          <template v-else>
            <div v-if="rooms.length > 1" class="order-rooms">
              <span class="or-label">房间子单</span>
              <div
                v-for="r in rooms"
                :key="r.id"
                class="or-item"
                :class="{ active: Number(activeUnitId) === Number(r.id) }"
                @click="activeUnitId = r.id"
              >
                <b>{{ r.room_no || '待排' }}</b>
                <span class="or-guest">{{ r.guest_name || '—' }}</span>
                <em class="s-off">{{ roomStatusText(r.status) }}</em>
              </div>
            </div>

            <div class="od-card information">
              <div class="od-grid">
                <div class="od-item"><span class="k">订单状态</span><span class="v"><el-tag size="small" :type="statusMeta?.type">{{ statusMeta?.text }}</el-tag></span></div>
                <div class="od-item"><span class="k">房型</span><span class="v">{{ roomTypeName }}</span></div>
                <div class="od-item"><span class="k">房号</span><span class="v no">{{ roomText }}</span></div>
                <div class="od-item"><span class="k">入住人</span><span class="v">{{ curRoom.guest_name || detail.guest_name || '-' }}</span></div>
                <div class="od-item"><span class="k">联系电话</span><span class="v">{{ curRoom.guest_phone || detail.guest_phone || '-' }}</span></div>
                <div class="od-item"><span class="k">入住类型</span><span class="v">{{ detail.booking_type || '全日房' }}</span></div>
                <div class="od-item"><span class="k">实际入住</span><span class="v">{{ checkInText }}</span></div>
                <div class="od-item"><span class="k">实际离店</span><span class="v">{{ actualCheckOutText }}</span></div>
                <div class="od-item"><span class="k">首日房价</span><span class="v rate">{{ fmtMoney(unitActualRate) }}</span></div>
                <div class="od-item"><span class="k">总消费</span><span class="v amt-out">−{{ fmtMoney(detail.total_consume) }}</span></div>
                <div class="od-item"><span class="k">账户余额</span><span class="v" :class="orderBal.cls">{{ orderBal.sign }}{{ orderBal.text }}（{{ orderBal.label }}）</span></div>
                <div class="od-item"><span class="k">订单号</span><span class="v">{{ detail.order_no }}</span></div>
                <div class="od-item"><span class="k">来源</span><span class="v">{{ detail.source || '-' }}</span></div>
                <div class="od-item"><span class="k">来源单号</span><span class="v">{{ detail.source_order_no || '-' }}</span></div>
                <div class="od-item"><span class="k">续住来源</span><span class="v">{{ detail.renew_from_order_no || '-' }}</span></div>
                <div class="od-item"><span class="k">备注</span><span class="v note">{{ detail.remark || '-' }}</span></div>
              </div>
            </div>
          </template>

          <!-- ③ 底部操作栏 -->
          <div v-if="viewMode === 'reserved'" class="od-bottom">
            <el-button v-if="detail.status === 'reserved'" type="primary" plain @click="openAssign">排房</el-button>
            <el-button v-if="detail.status === 'reserved' && hasPendingRooms" type="success" plain @click="openCheckin">
              {{ checkedInCount > 0 ? '继续入住' : '入住' }}
            </el-button>
            <el-button v-if="detail.status === 'reserved'" plain @click="openEdit">修改</el-button>
            <el-button v-if="detail.status === 'reserved'" type="danger" plain @click="doCancel">取消预定</el-button>
            <el-button plain @click="openFolio">账单</el-button>
            <el-button plain @click="copyPage">复制页面</el-button>
          </div>
          <div v-else-if="viewMode === 'inhouse'" class="od-bottom">
            <template v-if="curRoom.status === 'checked_in'">
              <el-button type="primary" plain @click="openPriceModify">价格修改</el-button>
              <el-button type="primary" plain @click="openChangeRoom">换房升降</el-button>
              <el-button type="primary" plain :disabled="unitCheckOutDate !== today" :title="unitCheckOutDate !== today ? '仅可对今日离店的房间续住' : ''" @click="openRenew">续住</el-button>
              <el-button type="primary" plain @click="doEarlyCheckout">结账退房</el-button>
            </template>
            <template v-else-if="curRoom.status === 'pending'">
              <el-button type="primary" plain @click="openAssign">排房</el-button>
              <el-button type="success" plain @click="openCheckin">入住</el-button>
            </template>
            <el-button plain @click="openFolio">账单</el-button>
            <el-button plain @click="copyPage">复制页面</el-button>
          </div>
          <div v-else class="od-bottom">
            <el-button v-if="detail.status === 'cancelled'" type="success" plain @click="doRestore">恢复预定</el-button>
            <el-button v-if="detail.status === 'checked_out'" type="danger" plain :loading="voiding" @click="doVoidCard">
              销卡
            </el-button>
            <el-button plain @click="openFolio">账单</el-button>
            <el-button plain @click="copyPage">复制页面</el-button>
          </div>
        </el-tab-pane>

        <!-- 账单 -->
        <el-tab-pane label="账单" name="bill">
          <FolioPanel :reservation-id="reservationId" @changed="onSaved" />
        </el-tab-pane>

        <!-- 日志 -->
        <el-tab-pane label="日志" name="log">
          <div class="log-list">
            <div v-for="(l, i) in logs" :key="i" class="log-item">
              <div class="l-time">{{ l.time }}</div>
              <div class="l-body">
                <span class="l-tag" :class="l.cls">{{ l.type }}</span>
                <span class="l-desc">{{ l.desc }}</span>
              </div>
            </div>
            <el-empty v-if="!logs.length" description="暂无日志" :image-size="60" />
          </div>
        </el-tab-pane>
      </el-tabs>

      <!-- 子对话框 -->
      <ReservationForm v-model:visible="editVisible" mode="edit" :reservation="detail" @saved="onSaved" />
      <CheckInDialog v-model:visible="checkinVisible" :reservation="detail" @saved="onSaved" />
      <CheckOutDialog v-model:visible="checkoutVisible" :reservation="detail" @saved="onSaved" />
      <ChangeRoomDialog v-model:visible="changeRoomVisible" :reservation="detail" :unit-id="curRoom.id" @saved="onSaved" />
      <RoomAssignDialog v-model:visible="assignVisible" :reservation="detail" @saved="onSaved" />
      <FolioDialog v-model:visible="folioVisible" :reservation-id="reservationId" @changed="onSaved" />
      <ModifyPriceDialog v-model:visible="priceVisible" :reservation="detail" :unit="curRoom" @saved="onSaved" />
      <RenewDialog v-model:visible="renewVisible" :reservation-id="reservationId" :unit-id="curRoom.id" @saved="onSaved" />
    </div>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { UserFilled } from '@element-plus/icons-vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import http from '../api';
import { fmtMoney, RES_STATUS, nightsBetween, fmtDate, addDays } from '../utils/format';
import { balanceView, moneyView, itemKindOf, itemKindText } from '../utils/money';
import ReservationForm from './ReservationForm.vue';
import CheckInDialog from './CheckInDialog.vue';
import CheckOutDialog from './CheckOutDialog.vue';
import ChangeRoomDialog from './ChangeRoomDialog.vue';
import RoomAssignDialog from './RoomAssignDialog.vue';
import FolioDialog from './FolioDialog.vue';
import FolioPanel from './FolioPanel.vue';
import ModifyPriceDialog from './ModifyPriceDialog.vue';
import RenewDialog from './RenewDialog.vue';

const props = defineProps({
  visible: Boolean,
  reservationId: { type: [Number, String], default: null },
  roomId: { type: [Number, String], default: null },
  unitId: { type: [Number, String], default: null },
});
const emit = defineEmits(['update:visible', 'changed']);

const router = useRouter();
const tab = ref('guest');
const today = fmtDate();
const detail = ref(null);
const roomTypes = ref([]);

const editVisible = ref(false);
const checkinVisible = ref(false);
const checkoutVisible = ref(false);
const changeRoomVisible = ref(false);
const assignVisible = ref(false);
const folioVisible = ref(false);
const priceVisible = ref(false);
const renewVisible = ref(false);

// 修改客人：详情页内联编辑
const guestEditing = ref(false);
const savingGuest = ref(false);
const guestForm = reactive({ guest_name: '', guest_phone: '', guest_id_card: '' });

// 新增同住人：详情页内联编辑
const cohabEditing = ref(false);
const savingCohab = ref(false);
const cohabForm = reactive({ name: '', id_card: '', phone: '' });

// 房间备注修改：详情页内联编辑（仅本间备注）
const roomEditing = ref(false);
const savingRoom = ref(false);
const roomEditForm = reactive({ remark: '' });

// 销卡：物理清空读卡器上的客人卡（复用空房读卡弹窗的清卡）
const voiding = ref(false);

const statusMeta = computed(() => {
  const d = detail.value;
  if (!d) return null;
  return RES_STATUS[d.eff_status || d.status] || null;
});
const roomTypeMap = computed(() => {
  const m = {};
  roomTypes.value.forEach((t) => { m[t.id] = t.name; });
  return m;
});

// 同一订单的全部房间子单（在住/已退/待入住），以子单 id 作为 tab 键
const activeUnitId = ref(null);
const rooms = computed(() => detail.value?.room_list || []);

const curRoom = computed(() => {
  const list = rooms.value;
  const id = activeUnitId.value;
  if (id != null) {
    const found = list.find((r) => Number(r.id) === Number(id));
    if (found) return found;
  }
  const byRoom = props.roomId != null ? list.find((r) => Number(r.room_id) === Number(props.roomId)) : null;
  return byRoom || list[0] || {};
});
const roomText = computed(() => curRoom.value.room_no || detail.value?.room_no || (curRoom.value.status === 'pending' ? '待排房' : '未分房'));
const roomTypeName = computed(() => {
  const id = curRoom.value.room_type_id ?? detail.value?.room_type_id;
  return roomTypeMap.value[id] || detail.value?.type_name || '未选房型';
});
const roomStatusText = (s) => ({ checked_in: '在住', checked_out: '已退', pending: '待入住', reserved: '待入住', cancelled: '已取消', no_show: '未到' }[s] || '-');
// 终态视图：该子单实际离店（回退到订单实际离店/预离）
const actualCheckOutText = computed(() => curRoom.value.actual_check_out || detail.value?.actual_check_out || detail.value?.check_out_date || '-');

// ---------- 当前子单口径（在住信息卡展示/编辑均以选中子单为准，不回写父订单） ----------
const unitStartDate = computed(() => (detail.value?.actual_check_in ? String(detail.value.actual_check_in).slice(0, 10) : detail.value?.check_in_date) || '');
// 该子单实际房价：优先本间入住覆盖价，否则按本间所在线路价表取当晚价，再回退线路价
const unitActualRate = computed(() => {
  const r = detail.value;
  const unit = curRoom.value;
  if (!r || !unit) return 0;
  const d = unitStartDate.value;
  const unitMap = parseRatesMap(unit.rates);
  if (unitMap[d] != null) return Number(unitMap[d]);
  if (Number(unit.rate) > 0) return Number(unit.rate);
  const lines = safeLines(r);
  const ln = lines[unit.line_index ?? 0] || lines[0] || {};
  const map = parseRatesMap(ln.rates);
  if (map[d] != null) return Number(map[d]);
  return Number(ln.rate) || Number(r.rate) || 0;
});
const unitCheckOutDate = computed(() => curRoom.value?.check_out_date || detail.value?.check_out_date || '');
const unitNights = computed(() => {
  if (!detail.value) return 0;
  if (detail.value.booking_type === '钟点房') return 1;
  return Math.max(0, nightsBetween(unitStartDate.value, unitCheckOutDate.value));
});
const unitNightsText = computed(() => (detail.value?.booking_type === '钟点房' ? '1（3小时）' : `${unitNights.value} 晚`));
const unitRemark = computed(() => {
  const r = curRoom.value?.remark;
  return (r != null && r !== '') ? r : (detail.value?.remark || '');
});
// 账户余额：>0 应退客人（红），<0 客人欠款（绿）
const orderBal = computed(() => balanceView(detail.value?.account_balance ?? -(detail.value?.balance || 0)));
const roomStatus = computed(() => roomStatusText(curRoom.value.status || detail.value?.status));
const checkInText = computed(() => detail.value?.actual_check_in || detail.value?.check_in_date || '-');
const nightsText = computed(() => {
  if (!detail.value) return '-';
  if (detail.value.booking_type === '钟点房') return '1（3小时）';
  return `${detail.value.nights || nightsBetween(detail.value.check_in_date, detail.value.check_out_date)} 晚`;
});

// ---------- 视图模式（依据服务端派生状态） ----------
// closed：已退/已取消/未到（只读）；inhouse：有任意在住子单（含部分入住）；reserved：尚无房间入住
const viewMode = computed(() => {
  const d = detail.value;
  if (!d) return 'reserved';
  const eff = d.eff_status || d.status;
  if (['checked_out', 'cancelled', 'no_show'].includes(eff)) return 'closed';
  if (d.has_checked_in || (d.room_list || []).some((r) => r.status === 'checked_in')) return 'inhouse';
  return 'reserved';
});
const nightsCount = computed(() => {
  if (!detail.value) return 0;
  if (detail.value.booking_type === '钟点房') return 1;
  return Number(detail.value.nights) || nightsBetween(detail.value.check_in_date, detail.value.check_out_date) || 0;
});
function safeLines(row) {
  try {
    const a = JSON.parse(row.lines || '[]');
    if (Array.isArray(a) && a.length) return a;
  } catch { /* fallthrough */ }
  return [{ room_type_id: row.room_type_id || null, rooms: row.rooms || 1, rate: row.rate || 0, rates: row.rates || '{}' }];
}
function parseRatesMap(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || '{}'); } catch { return {}; }
}
const lineRows = computed(() => {
  if (!detail.value) return [];
  const n = nightsCount.value;
  const ci = detail.value.check_in_date;
  return safeLines(detail.value).map((ln) => {
    const name = roomTypeMap.value[ln.room_type_id] || '未选房型';
    const rooms = Number(ln.rooms) || 1;
    const map = parseRatesMap(ln.rates);
    const perNight = [];
    for (let i = 0; i < n; i++) {
      const d = addDays(ci, i);
      perNight.push({ date: d, price: map[d] != null ? Number(map[d]) : (Number(ln.rate) || 0) });
    }
    const subtotal = Math.round(rooms * perNight.reduce((s, x) => s + x.price, 0) * 100) / 100;
    return { name, rooms, perNight, subtotal };
  });
});
const typeSummary = computed(() => lineRows.value.map((lr) => `${lr.name} ${lr.rooms}间`).join('、'));
function perNightText(lr) {
  return lr.perNight.map((p) => `¥${Number(p.price).toFixed(2)}`).join(' · ') || fmtMoney(0);
}
const assignedUnits = computed(() => (detail.value?.room_list || []).filter((r) => r.room_no));
const assignedCount = computed(() => assignedUnits.value.length);
const assignedRoomNosText = computed(() => assignedUnits.value.map((r) => r.room_no).join('、'));
const unassignedCount = computed(() => (detail.value?.room_list || []).filter((r) => r.status === 'pending' && !r.room_id).length);
const roomListText = computed(() => (detail.value?.room_list || []).map((r) => r.room_no || '待排').join('、') || '-');
const checkedInCount = computed(() => (detail.value?.room_list || []).filter((r) => r.status === 'checked_in').length);
const hasPendingRooms = computed(() => (detail.value?.room_list || []).some((r) => r.status === 'pending'));
const cohabList = computed(() => {
  const c = curRoom.value?.cohabitors;
  if (!c) return [];
  try { const a = JSON.parse(c); return Array.isArray(a) ? a : []; } catch { return []; }
});
// 该房间的全部客人（主客 + 同住人）
const occupants = computed(() => {
  const room = curRoom.value;
  if (!room) return [];
  const list = [{ name: room.guest_name || '', id_card: room.guest_id_card || '', phone: room.guest_phone || '', isMain: true }];
  for (const c of cohabList.value) list.push({ name: c.name || '', id_card: c.id_card || '', phone: c.phone || '', isMain: false });
  return list;
});
const activeGuestIdx = ref(0);
const curGuest = computed(() => {
  const o = occupants.value;
  const idx = Math.min(Math.max(activeGuestIdx.value, 0), o.length - 1);
  return o[idx] || {};
});
const logs = computed(() => {
  const items = detail.value?.folio || [];
  const clsOf = (k) => ({ room_charge: 'lt-primary', extra_charge: 'lt-warn', payment: 'lt-ok', refund: 'lt-warn', adj: 'lt-danger', deposit_in: 'lt-info', deposit_out: 'lt-info', deposit_offset: 'lt-info', city_ledger: 'lt-danger' }[k] || 'lt-info');
  return items.map((it) => {
    const k = itemKindOf(it);
    const m = it.item_type === 'info' ? null : moneyView(it.amount);
    const amtTxt = m ? `${m.sign}${m.text}` : '';
    const parts = [it.category, it.description, it.method ? `[${it.method}]` : '', amtTxt].filter(Boolean);
    return {
      time: it.created_at,
      type: itemKindText(k),
      cls: clsOf(k),
      desc: parts.join(' '),
    };
  }).slice().reverse();
});

function openEdit() { editVisible.value = true; }
function openCheckin() { checkinVisible.value = true; }
function openAssign() { assignVisible.value = true; }
function openPriceModify() {
  if (curRoom.value?.status !== 'checked_in') return ElMessage.warning('仅可修改在住房间');
  priceVisible.value = true;
}
function openRenew() {
  if (curRoom.value?.status !== 'checked_in') return ElMessage.warning('仅可对在住房间办理续住');
  renewVisible.value = true;
}

// 修改客人：内联编辑（不弹窗）
function startGuestEdit() {
  guestForm.guest_name = curGuest.value.name || '';
  guestForm.guest_phone = curGuest.value.phone || '';
  guestForm.guest_id_card = curGuest.value.id_card || '';
  guestEditing.value = true;
}
function cancelGuestEdit() {
  guestEditing.value = false;
}
async function saveGuest() {
  if (!(guestForm.guest_name || '').trim()) return ElMessage.warning('请填写客人姓名');
  const phone = (guestForm.guest_phone || '').trim();
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) return ElMessage.warning('手机号格式不正确（1开头的11位数字）');
  if (!curRoom.value?.id) return ElMessage.warning('请先选择在住房间');
  savingGuest.value = true;
  try {
    await http.put(`/reservations/${detail.value.id}/rooms/${curRoom.value.id}/occupant`, {
      index: activeGuestIdx.value,
      guest_name: guestForm.guest_name.trim(),
      guest_phone: phone,
      guest_id_card: (guestForm.guest_id_card || '').trim().toUpperCase(),
    });
    ElMessage.success('客人信息已修改');
    await onSaved();
    guestEditing.value = false;
  } catch (e) { /* 拦截器已提示 */ } finally { savingGuest.value = false; }
}

// 新增同住人：内联编辑（不弹窗）
function startCohab() {
  cohabForm.name = ''; cohabForm.id_card = ''; cohabForm.phone = '';
  cohabEditing.value = true;
}
function cancelCohab() { cohabEditing.value = false; }
async function saveCohab() {
  const name = (cohabForm.name || '').trim();
  if (!name) return ElMessage.warning('请填写同住人姓名');
  const idCard = (cohabForm.id_card || '').trim().toUpperCase();
  if (idCard && !/^\d{17}[\dX]$/.test(idCard)) return ElMessage.warning('身份证号格式不正确（18位，末位可为X）');
  const phone = (cohabForm.phone || '').trim();
  if (phone && !/^1[3-9]\d{9}$/.test(phone)) return ElMessage.warning('手机号格式不正确（1开头的11位数字）');
  if (!curRoom.value?.id) return ElMessage.warning('请先选择在住房间');
  const next = [...cohabList.value, { name, id_card: idCard, phone }];
  savingCohab.value = true;
  try {
    await http.put(`/reservations/${detail.value.id}/rooms/${curRoom.value.id}/cohabitors`, { cohabitors: next });
    ElMessage.success('已新增同住人');
    await onSaved();
    cohabEditing.value = false;
  } catch (e) { /* 拦截器已提示 */ } finally { savingCohab.value = false; }
}

// 房间备注修改：内联编辑（仅本间备注）——仅作用于当前房间子单，不回写父订单
// 触发进入编辑态的那次点击不应被当作「点击空白处保存」
let skipNextBodyClick = false;
function startRoomEdit() {
  roomEditForm.remark = unitRemark.value;
  skipNextBodyClick = true;
  roomEditing.value = true;
  nextTick(() => { skipNextBodyClick = false; });
}
function cancelRoomEdit() { roomEditing.value = false; }
// 备注编辑中点击弹窗空白处即保存（输入框与保存/取消按钮自身不触发）
function onBodyClick(e) {
  if (skipNextBodyClick) return;
  if (!roomEditing.value || savingRoom.value) return;
  const t = e.target;
  if (t.closest('.remark-edit') || t.closest('.od-row-btns')) return;
  saveRoom();
}
async function saveRoom() {
  if (!detail.value || !curRoom.value?.id) return ElMessage.warning('请先选择在住房间');
  savingRoom.value = true;
  try {
    await http.put(`/reservations/${detail.value.id}/rooms/${curRoom.value.id}/room-info`, {
      remark: roomEditForm.remark,
    });
    ElMessage.success('房间备注已修改');
    await onSaved();
    roomEditing.value = false;
  } catch (e) { /* 拦截器已提示 */ } finally { savingRoom.value = false; }
}
function openCheckout() { checkoutVisible.value = true; }
function openChangeRoom() { changeRoomVisible.value = true; }
function openFolio() { folioVisible.value = true; }
// 复制页面：在新标签页打开一个全新的 PMS 房态图，便于并行操作
function copyPage() {
  const { href } = router.resolve({ name: 'room-status' });
  window.open(href, '_blank', 'noopener');
}
async function doCancel() {
  if (!detail.value) return;
  try {
    await ElMessageBox.confirm(`确认取消预定 ${detail.value.order_no}（${detail.value.guest_name}）？`, '提示', { type: 'warning' });
  } catch (e) { return; }
  await http.post(`/reservations/${detail.value.id}/cancel`);
  ElMessage.success('预定已取消');
  await onSaved();
}
async function doRestore() {
  if (!detail.value) return;
  try {
    await ElMessageBox.confirm(`确认恢复预定 ${detail.value.order_no}（${detail.value.guest_name}）？`, '提示', { type: 'warning' });
  } catch (e) { return; }
  await http.post(`/reservations/${detail.value.id}/restore`);
  ElMessage.success('已恢复预定');
  await onSaved();
}
// 销卡：与空房读卡弹窗的「清卡」一致，调用厂商 ClearCardData 物理清空卡片数据，
// 而非按卡号退卡（CheckOut2 只销门锁库卡号，卡内数据仍可读出）
async function doVoidCard() {
  voiding.value = true;
  try {
    await http.post('/card/management', { action: 'clear' });
    ElMessage.success('销卡成功，卡片已清空');
  } catch (e) { /* 拦截器已提示 */ } finally { voiding.value = false; }
}

// 结账退房：仅剩一间在住且无待入住子单时整单结算；否则单间退房，其余子单继续
async function doEarlyCheckout() {
  if (!detail.value) return;
  const checkedIn = rooms.value.filter((r) => r.status === 'checked_in');
  const pending = rooms.value.filter((r) => r.status === 'pending');
  if (checkedIn.length <= 1 && pending.length === 0) { openCheckout(); return; }
  const target = curRoom.value;
  if (!target || target.status !== 'checked_in' || !target.id) { openCheckout(); return; }
  try {
    await ElMessageBox.confirm(`确认房间 ${target.room_no || '该房'} 结账退房？其余房间继续在住，共用同一账单。`, '提示', { type: 'warning' });
  } catch (e) { return; }
  await http.post(`/reservations/${detail.value.id}/rooms/${target.id}/check-out`, { actual_check_out: fmtDate() });
  ElMessage.success('该房间已退房');
  await onSaved();
}

async function load() {
  if (!props.reservationId) { detail.value = null; return; }
  const [d, types] = await Promise.all([
    http.get(`/reservations/${props.reservationId}`),
    http.get('/room-types'),
  ]);
  detail.value = d;
  roomTypes.value = types;
  const list = d.room_list || [];
  const byUnit = props.unitId != null ? list.find((r) => Number(r.id) === Number(props.unitId)) : null;
  const byRoom = props.roomId != null ? list.find((r) => Number(r.room_id) === Number(props.roomId)) : null;
  activeUnitId.value = byUnit?.id ?? byRoom?.id ?? list[0]?.id ?? null;
  const len = occupants.value.length;
  if (activeGuestIdx.value > 0 && activeGuestIdx.value >= len) activeGuestIdx.value = Math.max(0, len - 1);
}
// 任何变更（含子对话框：入住/退房/续住/换房/改价/排房/预定信息）后：
// 重载本弹窗详情并向上抛 changed，让房态图/订单列表等外层同步刷新
async function onSaved() { await load(); emit('changed'); }

watch(() => props.visible, (v) => { if (v) load(); });
// 切换房间子单时退出房间信息修改状态，避免把上一间的编辑误存到另一间
watch(activeUnitId, () => { roomEditing.value = false; });
function reset() { detail.value = null; tab.value = 'guest'; checkinVisible.value = false; assignVisible.value = false; guestEditing.value = false; cohabEditing.value = false; roomEditing.value = false; priceVisible.value = false; renewVisible.value = false; }
</script>

<style scoped>
.od-body { max-height: 78vh; overflow: auto; padding-right: 4px; }
.od-head { display: flex; align-items: center; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid #f1f3f5; }
.od-head .od-no { font-size: 15px; font-weight: 700; color: #212529; }
.od-head .od-guest { color: #1c7ed6; font-weight: 700; }

.od-tabs :deep(.el-tabs__header) { margin-bottom: 12px; }
.od-tabs :deep(.el-tabs__item) { font-weight: 600; }

.od-card { margin-bottom: 12px; border: 1px solid #e9ecef; border-radius: 8px; background: #f8f9fa; padding: 14px 16px; }
.od-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 24px; }
.od-item { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.od-item .k { color: #909399; font-size: 13px; flex-shrink: 0; width: 62px; text-align: right; }
.od-item .v { color: #303133; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.od-item .v.no { color: #1c7ed6; font-weight: 700; font-size: 15px; }
.od-item .v.rate { color: #1c7ed6; font-weight: 700; }
.od-item .v.note { color: #495057; white-space: normal; }

.order-rooms { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.order-rooms .or-label { font-size: 13px; color: #909399; }
.or-item {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; border-radius: 6px; cursor: pointer;
  background: #fff; border: 1px solid #e9ecef; transition: all .12s;
}
.or-item:hover { border-color: #a5d8ff; }
.or-item.active { border-color: #1c7ed6; background: #e7f5ff; }
.or-item b { color: #1c7ed6; font-size: 14px; }
.or-item .or-guest { font-size: 12px; color: #495057; }
.or-item em { font-style: normal; font-size: 11px; }
.or-item .s-ok { color: #2f9e44; }
.or-item .s-idle { color: #e8590c; }

.od-row-btns { margin-top: 12px; display: flex; gap: 10px; }
.od-row-btns .el-button { margin: 0; }

.od-lines { display: flex; flex-direction: column; gap: 8px; }
.od-line-row {
  display: flex; align-items: center; gap: 12px;
  font-size: 14px; color: #303133;
  padding-bottom: 8px; border-bottom: 1px dashed #e9ecef;
}
.od-line-row:last-child { border-bottom: none; padding-bottom: 0; }
.od-line-row .ol-type { font-weight: 600; min-width: 90px; }
.od-line-row .ol-rooms { color: #868e96; font-size: 13px; }
.od-line-row .ol-rates { flex: 1; color: #495057; font-size: 13px; text-align: right; }
.od-line-row .ol-subtotal { font-weight: 700; color: #e03131; min-width: 84px; text-align: right; }

.guest-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #f1f3f5; }
.gt-item {
  cursor: pointer; font-size: 14px; color: #909399;
  padding: 4px 14px; border-radius: 6px; transition: all .12s;
}
.gt-item:hover { background: #f1f3f5; }
.gt-item.active { background: #e7f5ff; color: #1c7ed6; font-weight: 600; border: 1px solid #a5d8ff; }

.guest-main { display: flex; align-items: flex-start; gap: 20px; }
.g-avatar { background: #e7f5ff; color: #1c7ed6; flex-shrink: 0; }
.g-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.g-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px 16px; }
.g-cell { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-size: 14px; color: #303133; }
.g-cell .k { color: #909399; font-size: 13px; flex-shrink: 0; }
.g-cell .v { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-cell .v.name { font-size: 16px; font-weight: 700; }
.g-cell .v.muted { color: #909399; }
.g-ok { color: #2f9e44; font-weight: 600; }
.g-idle { color: #e8590c; font-weight: 600; }

.cohab-form { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.cohab-form .k { color: #909399; font-size: 13px; }

.od-bottom { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 4px; }
.od-bottom .el-button { margin: 0; }

.log-list { border: 1px solid #e9ecef; border-radius: 8px; padding: 8px 16px; }
.log-item { display: flex; gap: 14px; padding: 10px 0; border-bottom: 1px dashed #e9ecef; }
.log-item:last-child { border-bottom: none; }
.l-time { color: #868e96; font-size: 13px; flex-shrink: 0; width: 170px; }
.l-body { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex-wrap: wrap; }
.l-tag { font-size: 12px; font-weight: 600; border-radius: 3px; padding: 0 6px; color: #fff; flex-shrink: 0; }
.lt-primary { background: #1c7ed6; }
.lt-warn { background: #e8590c; }
.lt-ok { background: #2f9e44; }
.lt-danger { background: #e03131; }
.lt-info { background: #868e96; }
.l-desc { color: #495057; font-size: 13px; }
</style>

<style>
.order-detail-dialog.el-dialog {
  border-radius: 12px;
  overflow: hidden;
}
.order-detail-dialog .el-dialog__title { font-size: 16px; font-weight: 700; }
</style>
