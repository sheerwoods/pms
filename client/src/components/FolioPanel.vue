<template>
  <div v-if="folio">
    <div v-if="!plain" class="folio-head">
      <div>
        <div class="fg-name">{{ folio.reservation.guest_name }}
          <el-tag size="small" :type="statusMeta?.type" style="margin-left: 8px">{{ statusMeta?.text }}</el-tag>
        </div>
        <div class="fg-sub">{{ folio.reservation.order_no }}｜{{ folio.reservation.room_no || '未分房' }}｜{{ folio.reservation.check_in_date }} ~ {{ folio.reservation.check_out_date }}</div>
      </div>
      <div class="folio-balance">
        <span>账户余额</span>
        <b :class="bal.cls">{{ bal.sign }}{{ bal.text }}</b>
        <em :class="bal.cls">{{ bal.label }}</em>
      </div>
    </div>

    <el-table
      ref="tableRef"
      :data="folio.items"
      size="small"
      border
      max-height="360"
      :row-class-name="rowClass"
      @selection-change="onSelectionChange"
    >
      <el-table-column type="selection" width="40" :selectable="selectable" />
      <el-table-column label="时间" width="150">
        <template #default="{ row }">{{ row.created_at }}</template>
      </el-table-column>
      <el-table-column prop="category" label="类别" min-width="120" />
      <el-table-column label="房间" width="76" align="center">
        <template #default="{ row }">
          <span v-if="row.room_unit_id">{{ row.unit_room_no || '待排房' }}</span>
          <span v-else class="amt-zero">—</span>
        </template>
      </el-table-column>
      <el-table-column label="金额" width="112" align="right">
        <template #default="{ row }">
          <template v-if="row.item_type === 'info'"><span class="amt-zero">—</span></template>
          <span v-else :class="mv(row.amount).cls">{{ mv(row.amount).sign }}{{ mv(row.amount).text }}</span>
        </template>
      </el-table-column>
      <el-table-column label="结账状态" width="104" align="center">
        <template #default="{ row }">
          <el-tooltip v-if="row.settle_side" :content="statusTip(row)" placement="top">
            <el-tag size="small" :type="stMeta(row).tag" effect="plain">{{ stMeta(row).text }}</el-tag>
          </el-tooltip>
          <span v-else class="amt-zero">—</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="66" align="center">
        <template #default="{ row }">
          <el-button v-if="row.item_type !== 'info' && !row.ar_locked" link type="danger" size="small" @click="removeItem(row)">冲销</el-button>
          <span v-else-if="row.ar_locked" class="locked">已挂AR</span>
          <span v-else>-</span>
        </template>
      </el-table-column>
    </el-table>

    <div class="folio-foot">
      <div class="folio-actions">
        <el-button type="warning" size="small" plain @click="openAdd('extra_charge')">消费</el-button>
        <el-button type="success" size="small" plain @click="openAdd('payment')">收款</el-button>
        <el-button type="success" size="small" plain @click="openAdd('refund')">退款</el-button>
        <el-button size="small" plain @click="openAdd('adj')">调整</el-button>
        <el-button type="primary" size="small" plain @click="openAdd('deposit')">收押金</el-button>
        <el-button size="small" plain @click="openAdd('deposit_refund')">退押金</el-button>
        <el-divider direction="vertical" />
        <el-button type="danger" size="small" :disabled="!canSettle" :loading="saving" @click="submitSettle">结账</el-button>
        <el-button type="danger" size="small" plain :disabled="!canPostAr" @click="openAr">挂 AR</el-button>
        <el-button size="small" plain :disabled="!revokeTargets.length" @click="revokeSettlements()">撤销结账</el-button>
        <el-button size="small" plain :disabled="!settlements.length" @click="recordVisible = true">结账记录</el-button>
      </div>
      <div class="sel-bar">
        <template v-if="picked.length">
          已选：
          <span>消费 <b :class="selCharge ? 'amt-out' : 'amt-zero'">−{{ fmtMoney(selCharge) }}</b></span>
          ｜
          <span>收款 <b :class="selPay ? 'amt-in' : 'amt-zero'">+{{ fmtMoney(selPay) }}</b></span>
          <span v-if="selCharge !== selPay" class="warn">（两侧金额需相等才能结账）</span>
          <span v-else-if="selCharge > 0" class="ok">（可结账）</span>
        </template>
        <template v-else>
          勾选「消费 + 收款」按同额配对结账；只勾未结消费可挂 AR 账户
        </template>
      </div>
    </div>

    <div class="folio-summary">
      <span>消费 <b class="amt-out">−{{ fmtMoney(summary.charges) }}</b></span>
      <span>收款 <b class="amt-in">+{{ fmtMoney(summary.payments) }}</b></span>
      <span v-if="summary.refunds">退款 <b class="amt-out">−{{ fmtMoney(summary.refunds) }}</b></span>
      <span v-if="summary.cityLedger">挂账 <b class="amt-in">+{{ fmtMoney(summary.cityLedger) }}</b></span>
      <span>押金 <b :class="mv(summary.depositBalance).cls">{{ mv(summary.depositBalance).sign }}{{ mv(summary.depositBalance).text }}</b></span>
      <span>未结消费 <b :class="unsettledTotal > 0 ? 'amt-out' : 'amt-zero'">−{{ fmtMoney(unsettledTotal) }}</b></span>
      <span>余额 <b :class="bal.cls">{{ bal.sign }}{{ bal.text }}</b><em :class="bal.cls">（{{ bal.label }}）</em></span>
    </div>

    <!-- 加账对话框 -->
    <el-dialog :model-value="addVisible" :title="addTitle" width="460px" @update:model-value="addVisible = $event">
      <el-form :model="addForm" label-width="90px">
        <el-form-item label="类别">
          <el-select v-model="addForm.category" allow-create filterable style="width: 100%">
            <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="addForm.item_type === 'extra_charge' && units.length" label="房间" required>
          <el-select v-model="addForm.room_unit_id" placeholder="选择消费所属房间" style="width: 100%">
            <el-option v-for="u in units" :key="u.id" :label="unitLabel(u)" :value="u.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="金额" required>
          <el-input-number v-model="addForm.amount" :min="0" :precision="2" :max="999999" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item v-if="addForm.item_type === 'adj'" label="方向">
          <el-radio-group v-model="addForm.adjSign">
            <el-radio :value="1">增加应收</el-radio>
            <el-radio :value="-1">冲减应收</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="hasMethod" label="方式">
          <el-select v-model="addForm.method" style="width: 100%">
            <el-option v-for="m in payMethods" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitAdd">确认</el-button>
      </template>
    </el-dialog>

    <!-- 挂账到 AR 账户（按笔） -->
    <el-dialog :model-value="arVisible" title="挂账到 AR 账户" width="460px" @update:model-value="arVisible = $event">
      <el-form :model="arForm" label-width="100px">
        <el-form-item label="挂账消费">
          <div class="ar-picked">
            <div v-for="r in arRows" :key="r.id" class="ar-picked-row">
              <span>{{ r.description || r.category || kindText(r) }}<em v-if="r.unit_room_no" class="ar-room">（{{ r.unit_room_no }}）</em></span>
              <b class="amt-out">−{{ fmtMoney(r.unsettled_amount) }}</b>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="挂账金额">
          <b class="bal-due">{{ fmtMoney(selCharge) }}</b>
        </el-form-item>
        <el-form-item label="AR 账户" required>
          <el-select v-model="arForm.ar_account_id" filterable placeholder="选择账户" style="width: 100%">
            <el-option v-for="a in arAccounts" :key="a.id" :label="`${a.code || ''} ${a.name}`" :value="a.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="arForm.remark" placeholder="选填" />
        </el-form-item>
      </el-form>
      <div class="ar-hint">挂账后所选消费转为 AR 应收、客账余额相应减少，再到「AR 账户」中统一付款结账。</div>
      <template #footer>
        <el-button @click="arVisible = false">取消</el-button>
        <el-button type="primary" :loading="arSaving" @click="submitAr">确认挂账</el-button>
      </template>
    </el-dialog>

    <!-- 结账记录 -->
    <el-dialog :model-value="recordVisible" title="结账记录" width="620px" @update:model-value="recordVisible = $event">
      <el-empty v-if="!settlements.length" description="暂无结账记录" :image-size="60" />
      <div v-for="s in settlements" :key="s.id" class="rec">
        <div class="rec-head">
          <el-tag size="small" :type="s.kind === 'ar' ? 'danger' : 'success'" effect="plain">{{ s.kind === 'ar' ? '挂 AR' : '结账' }}</el-tag>
          <b>{{ fmtMoney(s.amount) }}</b>
          <span class="rec-time">{{ s.created_at }}｜营业日 {{ s.business_date }}</span>
          <el-button v-if="s.kind !== 'ar'" link type="danger" size="small" class="rec-revoke" @click="revokeSettlements([s])">撤销</el-button>
          <span v-else class="rec-locked">挂账请在 AR 账户处理</span>
        </div>
        <div v-for="a in s.allocations" :key="a.id" class="rec-line">
          <span class="rec-side" :class="a.side === 'charge' ? 'amt-out' : 'amt-in'">{{ a.side === 'charge' ? '消费' : '收款' }}</span>
          <span class="rec-desc">{{ a.description || a.category || a.item_type }}</span>
          <span class="rec-amt">{{ fmtMoney(a.amount) }}</span>
        </div>
        <div v-if="s.remark" class="rec-remark">备注：{{ s.remark }}</div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';
import { fmtMoney, RES_STATUS } from '../utils/format';
import { dictOptions, nonArMethods } from '../utils/dict';
import { moneyView, balanceView, itemKindOf, itemKindText } from '../utils/money';

const props = defineProps({
  reservationId: { type: [Number, String], default: null },
  plain: Boolean,
});
const emit = defineEmits(['changed']);

const EMPTY_SUMMARY = {
  charges: 0, payments: 0, refunds: 0, cityLedger: 0, depositBalance: 0, accountBalance: 0,
};

// 逐笔结账状态：未结账 / 部分结账 / 已结账 / 挂AR
const SETTLE_STATUS = {
  open: { text: '未结账', tag: 'info' },
  partial: { text: '部分结账', tag: 'warning' },
  settled: { text: '已结账', tag: 'success' },
  ar: { text: '挂AR', tag: 'danger' },
};

const folio = ref(null);
const tableRef = ref(null);
const saving = ref(false);
const addVisible = ref(false);
const addForm = reactive({ item_type: 'extra_charge', category: '迷你吧', amount: 0, method: '现金', adjSign: 1, room_unit_id: null });

const statusMeta = computed(() => (folio.value ? RES_STATUS[folio.value.reservation.status] : null));
const summary = computed(() => folio.value?.summary || EMPTY_SUMMARY);
const bal = computed(() => balanceView(summary.value.accountBalance));
const settlements = computed(() => folio.value?.settlements || []);
const unsettledTotal = computed(() => folio.value?.unsettled_charges?.total || 0);
// 子单房间（多子单账单消费需选择房间）
const units = computed(() => folio.value?.units || []);
function unitLabel(u) {
  const no = u.room_no || '待排房';
  return u.type_name ? `${no}（${u.type_name}）` : no;
}

const mv = (n) => moneyView(n);
const kindOf = (row) => itemKindOf(row);
const kindText = (row) => itemKindText(kindOf(row));
const rowClass = ({ row }) => (row.item_type === 'info' ? 'row-info' : '');
const stMeta = (row) => SETTLE_STATUS[row.settle_status] || SETTLE_STATUS.open;
// 已挂 AR 结清的明细在客账内不可操作（不可勾选、不可冲销、不可撤销）
const selectable = (row) => !!row.settle_side && !row.ar_locked;
function statusTip(row) {
  const s = (settleOf.value[row.id] || [])[0];
  if (row.settle_status === 'ar') {
    return `已挂 AR${row.ar_amount ? ' ¥' + fmtMoney(row.ar_amount) : ''}${s?.kind === 'ar' ? '（批次 #' + s.id + '）' : ''}，客账内不可操作，请到「AR 账户」处理`;
  }
  if (row.settle_status === 'partial') return `已结 ¥${fmtMoney(row.settled_amount)}，未结 ¥${fmtMoney(row.unsettled_amount)}`;
  if (s) return `结账批次 #${s.id}｜${s.created_at}`;
  return `未结 ¥${fmtMoney(row.unsettled_amount)}`;
}

const hasMethod = computed(() => ['payment', 'refund', 'deposit', 'deposit_refund'].includes(addForm.item_type));

const chargeCategories = computed(() => dictOptions('charge_category'));
const paymentCategories = computed(() => dictOptions('payment_category'));
const payMethods = computed(() => nonArMethods());

const categoryOptions = computed(() => ({
  extra_charge: chargeCategories.value,
  payment: paymentCategories.value,
  refund: ['退款'],
  adj: ['调整', '补房费'],
  deposit: ['押金'],
  deposit_refund: ['退押金'],
}[addForm.item_type] || []));
const addTitle = computed(() => ({
  extra_charge: '消费', payment: '收款', refund: '退款', adj: '账务调整', deposit: '收取押金', deposit_refund: '退还押金',
}[addForm.item_type] || '消费'));

// ---- 勾选 / 结账 / 挂账 ----
const picked = ref([]);
const onSelectionChange = (rows) => { picked.value = rows; };
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// 仅未结部分参与本次结账；已结清的行勾选后用于「撤销结账」
const pendingCharges = computed(() => picked.value.filter((r) => r.settle_side === 'charge' && r.unsettled_amount > 0));
const pendingPays = computed(() => picked.value.filter((r) => r.settle_side === 'payment' && r.unsettled_amount > 0));
const selCharge = computed(() => round2(pendingCharges.value.reduce((s, r) => s + r.unsettled_amount, 0)));
const selPay = computed(() => round2(pendingPays.value.reduce((s, r) => s + r.unsettled_amount, 0)));
const canSettle = computed(() => selCharge > 0 && selCharge === selPay);
const arRows = computed(() => pendingCharges.value);
const canPostAr = computed(() => pendingCharges.value.length > 0 && !pendingPays.value.length);

// 明细 id -> 其所属结账批次
const settleOf = computed(() => {
  const m = {};
  for (const s of settlements.value) for (const a of s.allocations) (m[a.item_id] = m[a.item_id] || []).push(s);
  return m;
});
const revokeTargets = computed(() => {
  const ids = new Set();
  for (const r of picked.value) for (const s of settleOf.value[r.id] || []) ids.add(s.id);
  return [...ids];
});

async function submitSettle() {
  if (!canSettle.value) return ElMessage.warning('所选消费与收款金额需相等');
  try {
    await ElMessageBox.confirm(`确认结账：消费 ¥${fmtMoney(selCharge.value)} ｜ 收款 ¥${fmtMoney(selPay.value)}？`, '结账', { type: 'warning' });
  } catch (e) { return; }
  saving.value = true;
  try {
    await http.post('/finance/settle', {
      reservation_id: props.reservationId,
      charge_ids: pendingCharges.value.map((r) => r.id),
      payment_ids: pendingPays.value.map((r) => r.id),
    });
    ElMessage.success('已结账');
    await load();
    emit('changed');
  } catch (e) {
    /* 已提示 */
  } finally {
    saving.value = false;
  }
}

// 传批次列表则撤销该列表；否则按勾选行归集批次
async function revokeSettlements(list) {
  const targets = Array.isArray(list) && list.length
    ? list
    : revokeTargets.value.map((id) => settlements.value.find((s) => s.id === id)).filter(Boolean);
  if (!targets.length) return;
  try {
    await ElMessageBox.confirm(`确认撤销 ${targets.length} 个结账批次？撤销后相关明细回到未结账。`, '撤销结账', { type: 'warning' });
  } catch (e) { return; }
  try {
    for (const s of targets) await http.post(`/finance/settlements/${s.id}/revoke`);
  } catch (e) {
    await load();
    emit('changed');
    return; // 已提示
  }
  ElMessage.success('已撤销结账');
  recordVisible.value = false;
  await load();
  emit('changed');
}

async function load() {
  if (!props.reservationId) { folio.value = null; return; }
  folio.value = await http.get('/finance/folio', { params: { reservation_id: props.reservationId } });
  picked.value = [];
  tableRef.value?.clearSelection();
}

watch(
  () => props.reservationId,
  () => load(),
  { immediate: true }
);

function openAdd(item_type) {
  addForm.item_type = item_type;
  addForm.category = categoryOptions.value[0] || '';
  addForm.amount = 0;
  addForm.method = '现金';
  addForm.adjSign = 1;
  addForm.room_unit_id = item_type === 'extra_charge' ? (units.value[0]?.id ?? null) : null;
  addVisible.value = true;
}

async function submitAdd() {
  if (!addForm.amount || addForm.amount <= 0) return ElMessage.warning('请输入金额');
  if (addForm.item_type === 'extra_charge' && units.value.length && !addForm.room_unit_id) {
    return ElMessage.warning('请选择消费所属房间');
  }
  saving.value = true;
  try {
    const amount = addForm.item_type === 'adj' ? addForm.amount * addForm.adjSign : addForm.amount;
    const payload = {
      reservation_id: props.reservationId,
      item_type: addForm.item_type,
      category: addForm.category,
      amount,
      method: addForm.method,
    };
    if (addForm.item_type === 'extra_charge') payload.room_unit_id = addForm.room_unit_id;
    await http.post('/finance/items', payload);
    ElMessage.success('已入账');
    addVisible.value = false;
    await load();
    emit('changed');
  } catch (e) {
    /* 已提示 */
  } finally {
    saving.value = false;
  }
}

// ---- 挂账到 AR 账户（按笔） ----
const arVisible = ref(false);
const arSaving = ref(false);
const recordVisible = ref(false);
const arAccounts = ref([]);
const arForm = reactive({ ar_account_id: null, remark: '' });

async function openAr() {
  arForm.ar_account_id = null;
  arForm.remark = '';
  arVisible.value = true;
  try {
    const data = await http.get('/ar/accounts', { params: { status: 'active' } });
    arAccounts.value = data.list || [];
  } catch (e) {
    arAccounts.value = [];
  }
}

async function submitAr() {
  if (!arForm.ar_account_id) return ElMessage.warning('请选择 AR 账户');
  if (!arRows.value.length) return ElMessage.warning('请先勾选要挂账的消费');
  arSaving.value = true;
  try {
    await http.post('/ar/charge', {
      reservation_id: props.reservationId,
      ar_account_id: arForm.ar_account_id,
      charge_ids: arRows.value.map((r) => r.id),
      remark: arForm.remark,
    });
    ElMessage.success('已挂账到 AR 账户');
    arVisible.value = false;
    await load();
    emit('changed');
  } catch (e) {
    /* 已提示 */
  } finally {
    arSaving.value = false;
  }
}

async function removeItem(row) {
  try {
    await ElMessageBox.confirm(`确认冲销该笔${kindText(row)}（${moneyView(row.amount).sign}${moneyView(row.amount).text}）？`, '提示', { type: 'warning' });
  } catch (e) {
    return;
  }
  try {
    await http.delete(`/finance/items/${row.id}`);
  } catch (e) {
    return; // 已提示（已结账需先撤销、挂账需先处理台账）
  }
  ElMessage.success('已冲销');
  await load();
  emit('changed');
}
</script>

<style scoped>
.folio-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px 12px;
}
.fg-name { font-size: 16px; font-weight: 700; }
.fg-sub { font-size: 12px; color: #868e96; margin-top: 2px; }
.folio-balance { font-size: 13px; color: #495057; text-align: right; }
.folio-balance b { font-size: 18px; margin-left: 6px; }
.folio-balance em { display: block; font-style: normal; font-size: 12px; margin-top: 2px; }
.folio-foot { margin-top: 12px; }
.folio-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.sel-bar { margin-top: 8px; font-size: 12px; color: #868e96; }
.sel-bar .warn { color: #e8590c; }
.sel-bar .ok { color: #2f9e44; }
.folio-summary {
  display: flex; flex-wrap: wrap; gap: 16px;
  margin-top: 10px; padding-top: 10px; border-top: 1px dashed #dee2e6;
  font-size: 13px; color: #495057;
}
.folio-summary em { font-style: normal; }
.ar-hint { font-size: 12px; color: #868e96; margin-top: -4px; }
.ar-picked { max-height: 120px; overflow: auto; width: 100%; }
.ar-picked-row { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; line-height: 20px; }
.ar-picked-row .ar-room { font-style: normal; color: #868e96; }
.rec { border: 1px solid #e9ecef; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; }
.rec-head { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.rec-head b { font-size: 15px; }
.rec-time { color: #868e96; font-size: 12px; }
.rec-revoke { margin-left: auto; }
.rec-locked { margin-left: auto; font-size: 12px; color: #868e96; }
.locked { font-size: 12px; color: #868e96; }
.rec-line { display: flex; gap: 8px; font-size: 12px; color: #495057; padding: 2px 0 0 6px; }
.rec-side { width: 30px; }
.rec-desc { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rec-amt { width: 90px; text-align: right; }
.rec-remark { font-size: 12px; color: #868e96; margin-top: 4px; }
:deep(.row-info) { color: #868e96; }
</style>
