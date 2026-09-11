<template>
  <el-dialog
    :model-value="visible"
    :title="title"
    width="1000px"
    align-center
    :close-on-click-modal="false"
    class="res-form"
    @update:model-value="(v) => $emit('update:visible', v)"
    @closed="reset"
  >
    <el-form :model="form" label-width="84px">
      <!-- 预定信息（宾客信息 + 入住安排 + 备注，无标题无图标） -->
      <div class="section">
        <!-- 散客直接入住：房间信息（房号/房型锁定不可改，房价可改） -->
        <el-row v-if="isWalkin" :gutter="16" class="walkin-info">
          <el-col :span="8">
            <el-form-item label="房号">
              <el-input :model-value="initial?.room_no" disabled />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="房型">
              <el-input :model-value="initial?.type_name" disabled />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="房价">
              <el-input
                class="rate-pick"
                readonly
                :model-value="fmtMoney(walkinRate)"
                title="点击修改各晚房价"
                @click="openWalkinRates"
              >
                <template #suffix><el-icon><EditPen /></el-icon></template>
              </el-input>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="预定人" required>
              <el-input v-model="form.guest_name" placeholder="请输入姓名" clearable>
                <template #prefix><el-icon><User /></el-icon></template>
              </el-input>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="手机号">
              <el-input v-model="form.guest_phone" placeholder="手机号（选填）" clearable maxlength="20">
                <template #prefix><el-icon><Iphone /></el-icon></template>
              </el-input>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="订单来源">
              <el-select v-model="form.source" style="width: 100%">
                <el-option v-for="s in sources" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="来源单号">
              <el-input v-model="form.source_order_no" placeholder="渠道单号（选填）" clearable />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="房间类型">
              <el-select v-model="form.booking_type" style="width: 100%">
                <el-option v-for="k in ROOM_KINDS" :key="k" :label="k" :value="k" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="isHourly ? 12 : 8">
            <el-form-item label="到达日期" required>
              <el-date-picker v-model="form.check_in_date" type="date" value-format="YYYY-MM-DD" :clearable="false" :disabled="isWalkin" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col v-if="!isHourly" :span="8">
            <el-form-item label="离店日期" required>
              <el-date-picker v-model="form.check_out_date" type="date" value-format="YYYY-MM-DD" :clearable="false" :disabled-date="disabledDeparture" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col v-if="!isHourly" :span="8">
            <el-form-item label="晚数">
              <el-input-number v-model="nights" :min="1" :max="99" controls-position="right" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col v-else :span="12">
            <el-form-item label="时长">
              <el-input model-value="3 小时" disabled>
                <template #prefix><el-icon><Timer /></el-icon></template>
              </el-input>
            </el-form-item>
          </el-col>
        </el-row>

        <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="特殊需求、说明（选填）" maxlength="200" show-word-limit style="margin-top: 4px" />
      </div>

      <!-- ① 房间与房价（散客直接入住时不显示，房间与房价已在顶部锁定） -->
      <div v-if="!isWalkin" class="section">
        <div class="section-title">
          房间与房价
          <el-button class="sec-action" text type="primary" @click="addLine">
            <el-icon><Plus /></el-icon>&nbsp;添加房型
          </el-button>
        </div>

        <div v-for="(line, idx) in form.lines" :key="idx" class="room-card">
          <div class="room-card-main">
            <el-select v-model="line.room_type_id" placeholder="选择房型" class="rc-type" @change="onTypeChange(line)">
              <el-option v-for="t in roomTypes" :key="t.id" :label="`${t.name}（¥${t.base_price}）· 余 ${availByType[t.id] || 0} 间`" :value="t.id" />
            </el-select>
            <el-input-number v-model="line.rooms" :min="1" :max="roomsMax(line)" controls-position="right" class="rc-rooms" />
            <div class="rc-rate">
              <span class="rc-rate-label">间晚</span>
              <el-input-number v-model="line.rate" :min="0" :precision="2" :controls="false" class="rc-rate-input" @change="onLineRateChange(line)" />
            </div>
            <div class="rc-actions">
              <el-button text type="primary" size="small" :disabled="!line.rates?.length" @click="editLineRates(line)">逐晚</el-button>
              <el-button v-if="form.lines.length > 1" text type="danger" size="small" @click="removeLine(idx)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
          <div class="room-card-foot">
            <span class="rc-sub-note">{{ line.rooms }} 间 × {{ nights }} 晚</span>
            <span class="rc-sub-label">小计</span>
            <span class="rc-subtotal">{{ fmtMoney(lineSubtotal(line)) }}</span>
          </div>
        </div>
      </div>

      <!-- 各晚房价对话框 -->
      <el-dialog :model-value="ratesVisible" title="各晚房价" width="460px" @update:model-value="ratesVisible = $event">
        <el-table :data="editingLine?.rates || []" size="small" border max-height="320">
          <el-table-column prop="date" label="日期" width="180" />
          <el-table-column label="房价" min-width="120">
            <template #default="{ row }">
              <el-input-number v-model="row.price" :min="0" :precision="2" :controls="false" style="width: 100%" />
            </template>
          </el-table-column>
        </el-table>
        <template #footer>
          <el-button @click="ratesVisible = false">关闭</el-button>
          <el-button type="primary" @click="confirmLineRates">确定</el-button>
        </template>
      </el-dialog>
    </el-form>

    <template #footer>
      <div class="res-footer">
        <div class="total-box">
          <span class="total-label">预估总额</span>
          <span class="total-amount">{{ fmtMoney(totalAmount) }}</span>
          <span class="total-detail">
            共 {{ totalRooms }} 间 · {{ isHourly ? '3 小时' : `${nights} 晚` }}
          </span>
        </div>
        <div class="res-footer-btns">
          <el-button @click="$emit('update:visible', false)">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">
            {{ isWalkin ? '确认入住' : mode === 'edit' ? '保存修改' : '保存预订' }}
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { fmtDate, addDays, nightsBetween, fmtMoney, ROOM_KINDS } from '../utils/format';
import { dictOptions } from '../utils/dict';

const props = defineProps({
  visible: Boolean,
  mode: { type: String, default: 'create' }, // create / edit / walkin
  reservation: { type: Object, default: null },
  initial: { type: Object, default: null },  // { room_id, room_type_id, room_no, type_name }
});
const emit = defineEmits(['update:visible', 'saved']);

const sources = computed(() => dictOptions('source'));
const roomTypes = ref([]);
const availableRooms = ref([]);
const saving = ref(false);

const isWalkin = computed(() => props.mode === 'walkin');
const isHourly = computed(() => form.booking_type === '钟点房');
const title = computed(() => (isWalkin.value ? '散客直接入住' : props.mode === 'edit' ? '修改预定 / 续住' : '新增预定'));
const ratesVisible = ref(false);
const editingLine = ref(null);

const form = reactive({
  guest_name: '',
  guest_id_card: '',
  guest_phone: '',
  booking_type: '全日房',
  room_id: null,
  check_in_date: fmtDate(),
  check_out_date: addDays(fmtDate(), 1),
  source: '散客',
  source_order_no: '',
  remark: '',
  lines: [], // [{ room_type_id, rooms, rate, rates:[{date,price}] }]
});

// 金额展示：单行小计 = 间数 × 各晚房价之和
function lineSubtotal(line) {
  const rooms = Number(line.rooms) || 0;
  const perNightSum = (line.rates || []).reduce((s, x) => s + (Number(x.price) || 0), 0);
  return rooms * perNightSum;
}
const totalAmount = computed(() => form.lines.reduce((s, ln) => s + lineSubtotal(ln), 0));
const totalRooms = computed(() => form.lines.reduce((s, ln) => s + (Number(ln.rooms) || 0), 0));

// 每个房型的可预订剩余间数（依据可用房统计）
const availByType = computed(() => {
  const map = {};
  availableRooms.value.forEach((r) => { map[r.type_id] = (map[r.type_id] || 0) + 1; });
  return map;
});
// 该行房型的可订上限（未选房型时放开）
function roomsMax(line) {
  const avail = availByType.value[line.room_type_id];
  return avail == null ? 99 : Math.max(avail, 1);
}
function safeJson(v) {
  try { return JSON.parse(v || '{}'); } catch { return {}; }
}

// 天数：钟点房固定 1 晚；全日房按日期计算（可编辑并自动同步离店时间）
const nights = computed({
  get() {
    if (isHourly.value) return 1;
    if (!form.check_in_date || !form.check_out_date) return 0;
    return Math.max(0, nightsBetween(form.check_in_date, form.check_out_date));
  },
  set(n) {
    if (isHourly.value || !form.check_in_date) return;
    form.check_out_date = addDays(form.check_in_date, Math.max(1, Number(n) || 1));
  },
});

// 按当前日期/天数生成每晚房价列表
function buildLineRates(existing, fallback) {
  const n = nights.value;
  if (!form.check_in_date || n <= 0) return [];
  const list = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(form.check_in_date, i);
    list.push({ date: d, price: existing[d] != null ? existing[d] : fallback });
  }
  return list;
}

// 日期变化时，重建所有行的各晚房价（保留已有价格）
function syncAllLineRates() {
  form.lines.forEach((line) => {
    const existing = Object.fromEntries((line.rates || []).map((x) => [x.date, x.price]));
    const fallback = (line.rates && line.rates.length) ? Number(line.rates[0].price) || 0 : 0;
    line.rates = buildLineRates(existing, fallback);
    line.rate = line.rates[0]?.price || 0;
  });
}

// 到达时间变化时，确保离店时间晚于到达时间（默认补 1 晚；钟点房无需该同步）
watch(
  () => form.check_in_date,
  (ci) => {
    if (!ci || isHourly.value) return;
    if (!form.check_out_date || form.check_out_date <= ci) {
      form.check_out_date = addDays(ci, 1);
    }
  }
);

// 切换房间类型时同步离店时间（钟点房=到达当天；全日房补 1 晚）
watch(
  () => form.booking_type,
  (k) => {
    if (k === '钟点房') {
      form.check_out_date = form.check_in_date || fmtDate();
    } else if (form.check_in_date && (!form.check_out_date || form.check_out_date <= form.check_in_date)) {
      form.check_out_date = addDays(form.check_in_date, 1);
    }
  }
);

// 日期变化时重建各行各晚房价
watch(() => [form.check_in_date, form.check_out_date], () => syncAllLineRates());

// 散客直接入住：房价只读展示，点击打开逐晚房价对话框修改
const walkinRate = computed(() => form.lines[0]?.rate ?? 0);
function openWalkinRates() {
  const line = form.lines[0];
  if (line) editLineRates(line);
}
// 散客直接入住：离店日期仅限到达日期（当天）之后
function disabledDeparture(d) {
  if (!isWalkin.value || !form.check_in_date) return false;
  return d.getTime() <= new Date(`${form.check_in_date}T00:00:00`).getTime();
}

async function loadRoomTypes() {
  roomTypes.value = await http.get('/room-types');
}
async function loadAvailableRooms() {
  availableRooms.value = await http.get('/rooms/available');
}

function onTypeChange(line) {
  const t = roomTypes.value.find((x) => x.id === line.room_type_id);
  if (t && line.rates?.length) line.rates.forEach((x) => { if (!x.price) x.price = t.base_price; });
  line.rate = line.rates[0]?.price || 0;
  const avail = availByType.value[line.room_type_id];
  if (avail != null) line.rooms = Math.min(line.rooms, Math.max(avail, 1));
}
function onLineRateChange(line) {
  if (line.rates?.length) line.rates[0].price = line.rate;
}
function addLine() {
  form.lines.push({ room_type_id: null, rooms: 1, rate: 0, rates: buildLineRates({}, 0) });
}
function removeLine(idx) {
  form.lines.splice(idx, 1);
  if (!form.lines.length) addLine();
}
function editLineRates(line) {
  editingLine.value = line;
  ratesVisible.value = true;
}
function confirmLineRates() {
  if (editingLine.value) editingLine.value.rate = editingLine.value.rates[0]?.price || 0;
  ratesVisible.value = false;
}

watch(
  () => props.visible,
  async (v) => {
    if (!v) return;
    await Promise.all([loadRoomTypes(), loadAvailableRooms()]);
    Object.assign(form, {
      guest_name: '', guest_id_card: '', guest_phone: '', booking_type: '全日房', room_id: null,
      check_in_date: fmtDate(), check_out_date: addDays(fmtDate(), 1),
      source: '散客', source_order_no: '', remark: '', lines: [],
    });
    if (props.mode === 'edit' && props.reservation) {
      const r = props.reservation;
      const arr = safeJson(r.lines);
      const raw = (Array.isArray(arr) && arr.length) ? arr
        : [{ room_type_id: r.room_type_id || null, rooms: r.rooms || 1, rate: r.rate || 0, rates: r.rates || '{}' }];
      const n = r.booking_type === '钟点房' ? (r.nights || 1) : (r.nights || Math.max(0, nightsBetween(r.check_in_date, r.check_out_date)));
      form.lines = raw.map((ln) => {
        const map = (typeof ln.rates === 'string') ? safeJson(ln.rates) : (ln.rates || {});
        const rates = [];
        for (let i = 0; i < n; i++) {
          const d = addDays(r.check_in_date, i);
          rates.push({ date: d, price: map[d] != null ? map[d] : (Number(ln.rate) || 0) });
        }
        return { room_type_id: ln.room_type_id || null, rooms: ln.rooms || 1, rate: rates[0]?.price || 0, rates };
      });
      Object.assign(form, {
        guest_name: r.guest_name, guest_id_card: r.guest_id_card || '', guest_phone: r.guest_phone || '',
        booking_type: r.booking_type || '全日房',
        room_id: r.room_id, check_in_date: r.check_in_date, check_out_date: r.check_out_date,
        source: r.source || '散客', source_order_no: r.source_order_no || '', remark: r.remark || '',
      });
    } else {
      form.lines = [{ room_type_id: null, rooms: 1, rate: 0, rates: buildLineRates({}, 0) }];
      if (props.initial) {
        form.room_id = props.initial.room_id || null;
        if (props.initial.room_type_id && form.lines[0]) {
          form.lines[0].room_type_id = props.initial.room_type_id;
          onTypeChange(form.lines[0]);
        }
        syncAllLineRates();
      }
    }
  }
);

function reset() {
  form.guest_name = ''; form.guest_id_card = ''; form.guest_phone = '';
  form.booking_type = '全日房'; form.room_id = null;
  form.source = '散客'; form.source_order_no = '';
  form.remark = ''; form.lines = [];
}

async function save() {
  if (!form.guest_name) return ElMessage.warning('请填写预定人姓名');
  if (!form.check_in_date) return ElMessage.warning('请选择到达时间');
  if (!isHourly.value && (!form.check_out_date || form.check_out_date <= form.check_in_date)) {
    return ElMessage.warning('离店时间必须晚于到达时间');
  }
  if (!form.lines?.length) return ElMessage.warning('请至少添加一个房型');
  if (!form.lines.some((ln) => Number(ln.rate) > 0 || (ln.rates || []).some((x) => Number(x.price) > 0))) return ElMessage.warning('请设置房价');
  if (isWalkin.value && !form.room_id) return ElMessage.warning('未获取到入住房间信息');

  const dates = isHourly.value
    ? { check_in_date: form.check_in_date, check_out_date: form.check_in_date }
    : { check_in_date: form.check_in_date, check_out_date: form.check_out_date };
  const linesPayload = form.lines.map((ln) => {
    const rate = Number(ln.rate) || 0;
    let rates = (ln.rates || []).map((x) => ({ date: x.date, price: Number(x.price) || 0 }));
    // 间晚房价已填但各晚未同步时，以间晚房价补齐所有晚
    if (rate > 0 && !rates.some((x) => x.price > 0)) {
      rates = rates.map((x) => ({ ...x, price: rate }));
    }
    return { room_type_id: ln.room_type_id || null, rooms: Number(ln.rooms) || 1, rate, rates };
  });
  // 兼容：附带首行房型的旧字段（正向校验/旧接口不因缺 rate 报错）
  const first = linesPayload[0] || {};
  const legacy = {
    room_type_id: first.room_type_id || null,
    rooms: first.rooms || 1,
    rate: first.rate || 0,
    rates: first.rates || [],
  };

  saving.value = true;
  try {
    const guest_id_card = (form.guest_id_card || '').trim().toUpperCase();
    if (props.mode === 'edit') {
      await http.put(`/reservations/${props.reservation.id}`, {
        guest_name: form.guest_name, guest_phone: form.guest_phone, guest_id_card,
        booking_type: form.booking_type, room_id: form.room_id,
        ...dates, lines: linesPayload, ...legacy,
        source: form.source, source_order_no: form.source_order_no, remark: form.remark,
      });
      ElMessage.success('预定已修改');
    } else {
      const payload = {
        guest_name: form.guest_name, guest_phone: form.guest_phone, guest_id_card,
        booking_type: form.booking_type, room_id: form.room_id,
        ...dates, lines: linesPayload, ...legacy,
        source: form.source, source_order_no: form.source_order_no, remark: form.remark,
      };
      if (isWalkin.value) payload.auto_checkin = true;
      await http.post('/reservations', payload);
      ElMessage.success(isWalkin.value ? '已办理入住' : '预定已创建');
    }
    emit('saved');
    emit('update:visible', false);
  } catch (e) {
    /* 拦截器已提示 */
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
/* 分区标题 */
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
.sec-action { margin-left: auto; }

/* 房型卡片 */
.room-card {
  border: 1px solid #e9ecef;
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 10px;
  background: #f8f9fa;
  transition: border-color .15s;
}
.room-card:hover { border-color: #a5d8ff; }
.room-card-main { display: flex; align-items: center; gap: 10px; }
.rc-type { flex: 1; min-width: 0; }
.rc-rooms { width: 100px; flex-shrink: 0; }
.rc-rate { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.rc-rate-label { font-size: 12px; color: #868e96; }
.rc-rate-input { width: 104px; }
.rc-actions { display: flex; align-items: center; flex-shrink: 0; }
.room-card-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #dee2e6;
}
.rc-sub-note { font-size: 12px; color: #868e96; margin-right: auto; }
.rc-sub-label { font-size: 12px; color: #868e96; }
.rc-subtotal { font-size: 15px; font-weight: 700; color: #e03131; }

/* 散客直接入住：锁定房间信息条 */
.walkin-info {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 10px;
  padding: 12px 12px 0;
  margin-bottom: 6px;
}
.rate-pick { cursor: pointer; }
.rate-pick :deep(.el-input__wrapper) { cursor: pointer; }
.rate-pick :deep(.el-input__inner) { cursor: pointer; color: #1c7ed6; font-weight: 600; }
.rate-pick :deep(.el-input__suffix) { color: #1c7ed6; cursor: pointer; }

/* 底部合计 */
.res-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.total-box { display: flex; align-items: baseline; gap: 8px; }
.total-label { font-size: 13px; color: #868e96; }
.total-amount { font-size: 24px; font-weight: 700; color: #e03131; }
.total-detail { font-size: 12px; color: #868e96; }
.res-footer-btns { display: flex; gap: 10px; }

/* 表单项间距微调 */
.section :deep(.el-form-item) { margin-bottom: 14px; }
.section :deep(.el-input__prefix-inner) { color: #adb5bd; }
</style>

<style>
/* 弹窗整体（class 挂在 el-dialog 根元素上，需非 scoped） */
.res-form.el-dialog {
  border-radius: 14px;
  overflow: hidden;
  height: 80%;
  display: flex;
  flex-direction: column;
}
.res-form .el-dialog__header {
  margin-right: 0;
  padding: 18px 24px 14px;
  border-bottom: 1px solid #f1f3f5;
}
.res-form .el-dialog__title {
  font-size: 16px;
  font-weight: 600;
  color: #212529;
}
.res-form .el-dialog__body {
  padding: 14px 24px 18px;
  flex: 1 1 auto;
  overflow-y: auto;
}
.res-form .el-dialog__footer {
  padding: 14px 24px 18px;
  border-top: 1px solid #f1f3f5;
  background: #fcfcfd;
}
</style>
