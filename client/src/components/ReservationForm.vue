<template>
  <el-dialog
    :model-value="visible"
    :title="title"
    width="640px"
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
    @closed="reset"
  >
    <el-form :model="form" label-width="90px">
      <el-divider content-position="left">预定信息</el-divider>
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="预定人" required>
            <el-input v-model="form.guest_name" placeholder="必填" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="电话号码">
            <el-input v-model="form.guest_phone" placeholder="选填" />
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
        <el-col :span="12">
          <el-form-item label="订单来源">
            <el-select v-model="form.source" style="width: 100%">
              <el-option v-for="s in RES_SOURCES" :key="s" :label="s" :value="s" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="来源单号">
        <el-input v-model="form.source_order_no" placeholder="选填" />
      </el-form-item>

      <el-row :gutter="16">
        <el-col :span="isHourly ? 12 : 8">
          <el-form-item label="到达时间" required>
            <el-date-picker v-model="form.check_in_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
        </el-col>
        <el-col v-if="!isHourly" :span="8">
          <el-form-item label="离店时间" required>
            <el-date-picker v-model="form.check_out_date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
        </el-col>
        <el-col v-if="!isHourly" :span="8">
          <el-form-item label="天数">
            <el-input-number v-model="nights" :min="1" :max="99" style="width: 100%" />
          </el-form-item>
        </el-col>
        <el-col v-else :span="12">
          <el-form-item label="时长">
            <el-input :model-value="'3 小时'" disabled />
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="选填" />
      </el-form-item>

      <el-divider content-position="left">房间信息</el-divider>
      <div v-for="(line, idx) in form.lines" :key="idx" class="room-line">
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item :label="idx === 0 ? '房型' : '房型'">
              <el-select v-model="line.room_type_id" placeholder="选择房型" style="width: 100%" @change="onTypeChange(line)">
                <el-option v-for="t in roomTypes" :key="t.id" :label="`${t.name}（¥${t.base_price}）`" :value="t.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item :label="idx === 0 ? '间数' : '间数'">
              <el-input-number v-model="line.rooms" :min="1" :max="99" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item :label="idx === 0 ? '间晚房价' : '间晚房价'">
              <div style="width: 100%; display: flex; flex-direction: column; gap: 2px;">
                <el-input-number v-model="line.rate" :min="0" :precision="2" :controls="false" style="width: 100%" @change="onLineRateChange(line)" />
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <el-button text type="primary" size="small" @click="editLineRates(line)" :disabled="!line.rates?.length">逐晚修改</el-button>
                  <el-button v-if="form.lines.length > 1" text type="danger" size="small" @click="removeLine(idx)">删除</el-button>
                </div>
              </div>
            </el-form-item>
          </el-col>
        </el-row>
      </div>

      <el-form-item v-if="isWalkin" label="指定房间" required>
        <el-select v-model="form.room_id" placeholder="请选择房间" clearable style="width: 100%">
          <el-option v-for="r in roomOptions" :key="r.id" :label="`${r.room_no}（${r.type_name}）`" :value="r.id" />
        </el-select>
      </el-form-item>

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

    <!-- 左下角：新增预定房型 -->
    <div style="margin-top: 4px; text-align: left;">
      <el-button text type="primary" @click="addLine">＋ 新增预定房型</el-button>
    </div>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">
        {{ isWalkin ? '确认入住' : mode === 'edit' ? '保存修改' : '保存预订' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { fmtDate, addDays, nightsBetween, RES_SOURCES, ROOM_KINDS } from '../utils/format';

const props = defineProps({
  visible: Boolean,
  mode: { type: String, default: 'create' }, // create / edit / walkin
  reservation: { type: Object, default: null },
  initial: { type: Object, default: null },  // { room_id, room_type_id }
});
const emit = defineEmits(['update:visible', 'saved']);

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

const roomOptions = computed(() => {
  let list = [...availableRooms.value];
  const cur = props.reservation?.room_id && !list.find((r) => r.id === props.reservation.room_id)
    ? { id: props.reservation.room_id, room_no: props.reservation.room_no, type_id: props.reservation.room_type_id, type_name: props.reservation.type_name }
    : null;
  if (cur) list.unshift(cur);
  const firstType = form.lines[0]?.room_type_id;
  if (firstType) list = list.filter((r) => r.type_id === firstType);
  return list;
});

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
      guest_name: '', guest_phone: '', booking_type: '全日房', room_id: null,
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
        guest_name: r.guest_name, guest_phone: r.guest_phone || '',
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
  form.guest_name = ''; form.guest_phone = '';
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
  if (isWalkin.value && !form.room_id) return ElMessage.warning('请选择指定房间');

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
    if (props.mode === 'edit') {
      await http.put(`/reservations/${props.reservation.id}`, {
        guest_name: form.guest_name, guest_phone: form.guest_phone,
        booking_type: form.booking_type, room_id: form.room_id,
        ...dates, lines: linesPayload, ...legacy,
        source: form.source, source_order_no: form.source_order_no, remark: form.remark,
      });
      ElMessage.success('预定已修改');
    } else {
      const payload = {
        guest_name: form.guest_name, guest_phone: form.guest_phone,
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
