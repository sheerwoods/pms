<template>
  <el-dialog
    :model-value="visible"
    title="续住"
    width="760px"
    top="5vh"
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
    @closed="reset"
    class="renew-dialog"
  >
    <div v-if="detail && unit" class="rd-body">
      <!-- 当前在住 -->
      <el-descriptions :column="4" border size="small" class="mb">
        <el-descriptions-item label="房间">{{ unit.room_no || detail.room_no || '-' }}</el-descriptions-item>
        <el-descriptions-item label="入住人">{{ occupantName || '-' }}</el-descriptions-item>
        <el-descriptions-item label="入住">{{ startDate }}</el-descriptions-item>
        <el-descriptions-item label="原预离">{{ unit.check_out_date || detail.check_out_date }}</el-descriptions-item>
      </el-descriptions>

      <el-alert
        v-if="!canRenew"
        type="warning"
        :closable="false"
        class="mb"
        title="当前房间预离日不是今日，不可续住"
        :description="`续住要求：离店日 = 今日 = 续住单入住日。该房间预离「${oldCheckOut || '未设置'}」。`"
      />

      <!-- 旧单结账退房 -->
      <div class="rd-title">旧单结账退房（{{ detail.order_no }}）</div>
      <el-alert
        v-if="info?.unsettled_charges > 0"
        type="warning"
        :closable="false"
        class="mb"
        :title="`当前未结账消费 ¥${fmtMoney(info.unsettled_charges)}（不含退房补计房费）`"
        description="续住会先结账退房旧单；未结清将无法完成，请在此录入收款或挂 AR 账户。"
      />
      <el-form v-if="info" label-width="100px" class="rd-settle">
        <el-row :gutter="12" class="mb">
          <el-col :span="8"><div class="info-box"><div class="lbl">实际间夜</div><div class="val">{{ info.actual_nights }} 晚</div></div></el-col>
          <el-col :span="8"><div class="info-box"><div class="lbl">押金余额</div><div class="val">{{ fmtMoney(info.deposit_balance) }}</div></div></el-col>
          <el-col :span="8"><div class="info-box accent"><div class="lbl">应收合计</div><div class="val">{{ fmtMoney(info.projected_balance) }}</div></div></el-col>
        </el-row>

        <el-form-item v-if="canUseDeposit" label="押金抵扣">
          <el-checkbox v-model="form.use_deposit">
            使用押金抵扣 <b class="amt-in">¥{{ fmtMoney(depositApplied) }}</b>，抵扣后应补 <b class="amt-out">¥{{ fmtMoney(remainingDue) }}</b>
          </el-checkbox>
        </el-form-item>
        <div v-if="depositRemainder > 0" class="mb hint">
          押金抵扣后剩余 <b class="amt-in">¥{{ fmtMoney(depositRemainder) }}</b> 将按
          <el-select v-model="form.deposit_refund_method" size="small" style="width: 110px">
            <el-option v-for="m in payMethodsNoAr" :key="m" :label="m" :value="m" />
          </el-select>
          退还
        </div>

        <template v-if="remainingDue > 0">
          <el-row :gutter="16">
            <el-col :span="10">
              <el-form-item label="收款方式">
                <el-select v-model="form.pay_method" style="width: 100%">
                  <el-option v-for="m in payMethodsAll" :key="m" :label="m" :value="m" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="14">
              <el-form-item label="实收金额">
                <el-input-number v-model="form.pay_amount" :min="0" :precision="2" :controls="false" style="width: 100%" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item v-if="form.pay_method === '挂账'" label="AR 账户" required>
            <el-select v-model="form.ar_account_id" filterable placeholder="选择挂账账户" style="width: 100%">
              <el-option v-for="a in arAccounts" :key="a.id" :label="`${a.code || ''} ${a.name}`" :value="a.id" />
            </el-select>
          </el-form-item>
          <div v-if="change > 0" class="mb hint green">应找零 ¥{{ change.toFixed(2) }}</div>
          <div v-if="form.pay_method !== '挂账' && form.pay_amount < remainingDue" class="mb hint orange">
            未结清，将挂欠款 ¥{{ (remainingDue - form.pay_amount).toFixed(2) }}（续住需结清，否则失败）
          </div>
        </template>
        <template v-else-if="remainingDue < 0">
          <el-form-item label="退款方式">
            <el-select v-model="form.refund_method" style="width: 200px">
              <el-option v-for="m in payMethodsNoAr" :key="m" :label="m" :value="m" />
            </el-select>
          </el-form-item>
        </template>
        <el-alert v-else type="success" :closable="false" title="旧单账单已结清" />
      </el-form>

      <!-- 续住新单 -->
      <div class="rd-title">续住新单</div>
      <el-form :model="form" label-width="100px">
        <el-form-item label="来源">
          <el-radio-group v-model="form.mode" @change="onModeChange">
            <el-radio value="new">新建续住单</el-radio>
            <el-radio value="source">选用来源预订单</el-radio>
          </el-radio-group>
        </el-form-item>

        <!-- 选用来源预订单：信息取自该预订单，只读不可编辑 -->
        <template v-if="form.mode === 'source'">
          <el-form-item label="来源预订单" required>
            <el-select
              v-model="form.source_reservation_id"
              filterable
              remote
              clearable
              :remote-method="loadSrcOptions"
              :loading="srcLoading"
              placeholder="搜索单号/预定人/手机号（仅单间预订单）"
              style="width: 100%"
              @change="onSrcChange"
            >
              <el-option
                v-for="o in srcOptions"
                :key="o.id"
                :label="`${o.order_no}｜${o.guest_name}｜${o.check_in_date}~${o.check_out_date}`"
                :value="o.id"
              />
            </el-select>
            <div class="hint">仅列出「今日入住」的单间预订单；续住按该单自身的房型/日期/房价执行、不可编辑，仅房间号与入住人取自当前在住。</div>
          </el-form-item>
          <el-descriptions v-if="selectedSrc" :column="2" border size="small" class="src-box">
            <el-descriptions-item label="房型">{{ srcTypeName }}</el-descriptions-item>
            <el-descriptions-item label="晚数">{{ srcNights }} 晚</el-descriptions-item>
            <el-descriptions-item label="入住">{{ selectedSrc.check_in_date }}</el-descriptions-item>
            <el-descriptions-item label="预离">{{ selectedSrc.check_out_date }}</el-descriptions-item>
            <el-descriptions-item label="房价" :span="2">{{ srcRateText }}</el-descriptions-item>
          </el-descriptions>
        </template>

        <!-- 新建续住单：可编辑 -->
        <template v-else>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="房间类型">
                <el-select v-model="form.booking_type" style="width: 100%" @change="buildRows(false)">
                  <el-option v-for="k in ROOM_KINDS" :key="k" :label="k" :value="k" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col v-if="form.booking_type !== '钟点房'" :span="12">
              <el-form-item label="预离日期" required>
                <el-date-picker
                  v-model="form.check_out_date"
                  type="date"
                  value-format="YYYY-MM-DD"
                  :clearable="false"
                  :disabled-date="disabledDeparture"
                  style="width: 100%"
                  @change="buildRows(true)"
                />
              </el-form-item>
            </el-col>
            <el-col v-else :span="12">
              <el-form-item label="时长"><el-input model-value="3 小时" disabled /></el-form-item>
            </el-col>
          </el-row>

          <el-table :data="rows" size="small" border max-height="240">
            <el-table-column label="日期" width="150"><template #default="{ row }">{{ row.date }}</template></el-table-column>
            <el-table-column label="星期" width="100"><template #default="{ row }">{{ weekday(row.date) }}</template></el-table-column>
            <el-table-column label="房价" min-width="160">
              <template #default="{ row }">
                <el-input-number v-model="row.price" :min="0" :precision="2" :controls="false" size="small" style="width: 140px" />
              </template>
            </el-table-column>
          </el-table>

          <el-form-item label="备注" style="margin-top: 12px">
            <el-input v-model="form.remark" type="textarea" :rows="2" placeholder="续住备注（选填）" />
          </el-form-item>
        </template>
      </el-form>
    </div>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="!canRenew" @click="confirm">确认续住</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { fmtMoney, fmtDate, addDays, nightsBetween, ROOM_KINDS } from '../utils/format';
import { dictOptions, nonArMethods } from '../utils/dict';

const props = defineProps({
  visible: Boolean,
  reservationId: { type: [Number, String], default: null },
  unitId: { type: [Number, String], default: null },
});
const emit = defineEmits(['update:visible', 'saved']);

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const weekday = (d) => '星期' + WEEKDAYS[new Date(d + 'T00:00:00').getDay()];

const detail = ref(null);
const unit = ref(null);
const info = ref(null);
const arAccounts = ref([]);
const srcOptions = ref([]);
const srcLoading = ref(false);
const saving = ref(false);
const rows = ref([]);
const selectedSrc = ref(null); // 选中的来源预订单（只读展示其自身信息）

const payMethodsAll = computed(() => dictOptions('payment_method'));
const payMethodsNoAr = computed(() => nonArMethods());

const form = ref({
  mode: 'new',
  source_reservation_id: null,
  booking_type: '全日房',
  check_out_date: addDays(fmtDate(), 1),
  remark: '',
  use_deposit: true,
  pay_method: '现金',
  pay_amount: 0,
  refund_method: '现金',
  deposit_refund_method: '现金',
  ar_account_id: null,
});

const startDate = computed(() => (detail.value?.actual_check_in ? String(detail.value.actual_check_in).slice(0, 10) : detail.value?.check_in_date) || '');
// 续住前提：当前子单预离日 = 今日
const oldCheckOut = computed(() => String(unit.value?.check_out_date || detail.value?.check_out_date || '').slice(0, 10));
const canRenew = computed(() => !!oldCheckOut.value && oldCheckOut.value === fmtDate());
const occupantName = computed(() => {
  const u = unit.value;
  if (!u) return detail.value?.guest_name || '';
  const names = [u.guest_name].filter(Boolean);
  try { JSON.parse(u.cohabitors || '[]').forEach((c) => { if (c?.name) names.push(c.name); }); } catch { /* ignore */ }
  return names.join('、') || detail.value?.guest_name || '';
});

const srcTypeName = computed(() => selectedSrc.value?.type_name || '未选房型');
const srcNights = computed(() => {
  const o = selectedSrc.value;
  if (!o) return 0;
  if (o.booking_type === '钟点房') return 1;
  return Number(o.nights) || Math.max(1, nightsBetween(o.check_in_date, o.check_out_date));
});
// 来源预订单自身逐晚房价（只读展示）
const srcRateText = computed(() => {
  const o = selectedSrc.value;
  if (!o) return '-';
  let map = {};
  try {
    const ln = (JSON.parse(o.lines || '[]') || [])[0] || {};
    map = parseMap(ln.rates);
  } catch { /* 忽略脏数据 */ }
  if (!Object.keys(map).length) map = parseMap(o.rates);
  const keys = Object.keys(map).sort();
  if (!keys.length) return fmtMoney(Number(o.rate) || 0);
  return keys.map((d) => `¥${Number(map[d]).toFixed(2)}`).join(' · ');
});

const projected = computed(() => info.value?.projected_balance || 0);
const depositBalance = computed(() => info.value?.deposit_balance || 0);
const depositApplied = computed(() => {
  if (!form.value.use_deposit || depositBalance.value <= 0 || projected.value <= 0) return 0;
  return Math.round(Math.min(depositBalance.value, projected.value) * 100) / 100;
});
const remainingDue = computed(() => Math.round((projected.value - depositApplied.value) * 100) / 100);
const depositRemainder = computed(() => Math.round((depositBalance.value - depositApplied.value) * 100) / 100);
const canUseDeposit = computed(() => depositBalance.value > 0 && projected.value > 0);
const change = computed(() => {
  if (form.value.pay_method === '挂账') return 0;
  return Math.max(0, Math.round((Number(form.value.pay_amount) - Math.max(0, remainingDue.value)) * 100) / 100);
});

watch(remainingDue, (v) => {
  form.value.pay_amount = v > 0 && form.value.pay_method !== '挂账' ? v : 0;
});

function parseMap(v) {
  if (v && typeof v === 'object') return v;
  try { return JSON.parse(v || '{}'); } catch { return {}; }
}
function safeLines(r) {
  try {
    const a = JSON.parse(r.lines || '[]');
    if (Array.isArray(a) && a.length) return a;
  } catch { /* fall through */ }
  return [{ room_type_id: r.room_type_id || null, rooms: 1, rate: r.rate || 0, rates: r.rates || '{}' }];
}
// 当前子单当日房价：逐晚覆盖 -> 子单值 -> 线路当晚价 -> 线路价
function unitBaseRate() {
  const u = unit.value; const r = detail.value;
  if (!u || !r) return 0;
  const t = fmtDate();
  const um = parseMap(u.rates);
  if (um[t] != null) return Number(um[t]) || 0;
  if (Number(u.rate) > 0) return Number(u.rate);
  const lines = safeLines(r);
  const ln = lines[u.line_index ?? 0] || lines[0] || {};
  const lm = parseMap(ln.rates);
  if (lm[t] != null) return Number(lm[t]) || 0;
  return Number(ln.rate) || Number(r.rate) || 0;
}
function nightsCount() {
  if (form.value.booking_type === '钟点房') return 1;
  return Math.max(1, nightsBetween(fmtDate(), form.value.check_out_date));
}
function buildRows(preserve = false) {
  const n = nightsCount();
  const prev = {};
  if (preserve) rows.value.forEach((x) => { prev[x.date] = x.price; });
  const def = unitBaseRate();
  const t = fmtDate();
  const arr = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(t, i);
    arr.push({ date: d, price: prev[d] != null ? prev[d] : def });
  }
  rows.value = arr;
}
function disabledDeparture(d) {
  return d.getTime() <= new Date(fmtDate() + 'T00:00:00').getTime();
}
function onModeChange() {
  if (form.value.mode === 'new') {
    form.value.source_reservation_id = null;
    selectedSrc.value = null;
  }
}
function onSrcChange(id) {
  selectedSrc.value = srcOptions.value.find((o) => Number(o.id) === Number(id)) || null;
}

async function loadArAccounts() {
  try {
    const data = await http.get('/ar/accounts', { params: { status: 'active' } });
    arAccounts.value = data.list || [];
  } catch { arAccounts.value = []; }
}
async function loadInfo() {
  if (!props.reservationId) return;
  info.value = await http.get(`/reservations/${props.reservationId}/checkout-info`, { params: { actual_check_out: fmtDate() } });
}
async function loadSrcOptions(keyword = '') {
  srcLoading.value = true;
  try {
    const data = await http.get('/reservations', { params: { status: 'reserved', keyword: keyword || '', page: 1, pageSize: 50 } });
    srcOptions.value = (data.list || []).filter((o) =>
      Number(o.id) !== Number(props.reservationId)
      && !(o.unit_counts?.checked_in || o.unit_counts?.checked_out)
      && (o.room_list || []).length === 1              // 仅单间预订单可作为续住来源
      && String(o.check_in_date || '').slice(0, 10) === fmtDate()  // 来源单入住日须为今日
    );
  } catch { srcOptions.value = []; } finally { srcLoading.value = false; }
}

async function load() {
  if (!props.reservationId) return;
  const d = await http.get(`/reservations/${props.reservationId}`);
  detail.value = d;
  const list = d.room_list || [];
  unit.value = list.find((x) => Number(x.id) === Number(props.unitId)) || list.find((x) => x.status === 'checked_in') || list[0] || null;
  form.value = {
    mode: 'new',
    source_reservation_id: null,
    booking_type: '全日房',
    check_out_date: addDays(fmtDate(), 1),
    remark: '',
    use_deposit: true,
    pay_method: '现金',
    pay_amount: 0,
    refund_method: '现金',
    deposit_refund_method: '现金',
    ar_account_id: null,
  };
  buildRows(false);
  selectedSrc.value = null;
  await Promise.all([loadArAccounts(), loadInfo(), loadSrcOptions('')]);
}

async function confirm() {
  if (!detail.value || !unit.value) return;
  if (!canRenew.value) return ElMessage.warning(`仅可对今日离店的房间办理续住（当前预离 ${oldCheckOut.value || '未设置'}）`);
  if (!unit.value.room_id) return ElMessage.warning('该房间尚未分配房号，无法续住');

  const isSource = form.value.mode === 'source';
  if (isSource) {
    if (!selectedSrc.value) return ElMessage.warning('请选择来源预订单');
  } else {
    if (form.value.booking_type !== '钟点房' && (!form.value.check_out_date || form.value.check_out_date <= fmtDate())) {
      return ElMessage.warning('离店日期必须晚于今日');
    }
    if (!rows.value.length || !rows.value.some((x) => Number(x.price) > 0)) return ElMessage.warning('请设置续住房价');
  }

  const payload = {
    source_reservation_id: isSource ? selectedSrc.value.id : null,
    use_deposit: form.value.use_deposit,
    deposit_refund_method: form.value.deposit_refund_method,
    payments: [],
    refund: null,
  };
  if (!isSource) {
    payload.booking_type = form.value.booking_type;
    payload.check_out_date = form.value.check_out_date;
    payload.rates = rows.value.map((x) => ({ date: x.date, price: Number(x.price) || 0 }));
    payload.remark = form.value.remark;
  }

  const due = remainingDue.value;
  if (due > 0) {
    if (form.value.pay_method === '挂账') {
      if (!form.value.ar_account_id) return ElMessage.warning('请选择挂账的 AR 账户');
      payload.payments = [{ method: '挂账', amount: due, ar_account_id: form.value.ar_account_id }];
    } else if (Number(form.value.pay_amount) >= due) {
      payload.payments = [{ method: form.value.pay_method, amount: Number(form.value.pay_amount) }];
    }
  }
  if (change.value > 0) payload.refund = { method: form.value.pay_method, amount: change.value };
  else if (due < 0) payload.refund = { method: form.value.refund_method, amount: -due };

  saving.value = true;
  try {
    const res = await http.post(`/reservations/${detail.value.id}/rooms/${unit.value.id}/renew`, payload);
    ElMessage.success(`续住成功：旧单已结账退房，新单 ${res.order_no} 已入住`);
    emit('saved');
    emit('update:visible', false);
  } catch (e) { /* 拦截器已提示 */ } finally { saving.value = false; }
}

function reset() { detail.value = null; unit.value = null; info.value = null; rows.value = []; selectedSrc.value = null; }

watch(() => props.visible, (v) => { if (v) load(); });
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.hint { font-size: 12px; color: #909399; margin-top: 4px; }
.green { color: #2f9e44; }
.orange { color: #e8590c; }
.rd-body { max-height: 72vh; overflow: auto; padding-right: 4px; }
.rd-title { font-size: 15px; font-weight: 700; color: #303133; margin: 6px 0 12px; padding-left: 8px; border-left: 3px solid #1c7ed6; }
.rd-settle { border: 1px solid #e9ecef; border-radius: 8px; padding: 12px 12px 0; background: #f8f9fa; }
.src-box { margin-bottom: 12px; }
.info-box { border: 1px solid #e9ecef; border-radius: 6px; padding: 10px; text-align: center; background: #fff; }
.info-box .lbl { font-size: 12px; color: #868e96; }
.info-box .val { font-size: 15px; font-weight: 700; color: #212529; margin-top: 4px; }
.info-box.accent { border-color: #1c7ed6; background: #e7f5ff; }
.info-box.accent .val { color: #1c7ed6; }
.amt-in { color: #e03131; }
.amt-out { color: #2f9e44; }
</style>

<style>
.renew-dialog.el-dialog { border-radius: 12px; overflow: hidden; }
</style>
