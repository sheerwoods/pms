<template>
  <el-dialog
    :model-value="visible"
    title="退房结算"
    width="580px"
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
    @closed="reset"
  >
    <el-descriptions :column="2" border size="small" class="mb">
      <el-descriptions-item label="客人">{{ reservation?.guest_name }}</el-descriptions-item>
      <el-descriptions-item label="房间">
        {{ reservation?.room_list?.length > 1 ? `${reservation.room_list.length} 间` : (reservation?.room_no || '-') }}
      </el-descriptions-item>
      <el-descriptions-item label="入住">{{ info?.check_in }}</el-descriptions-item>
      <el-descriptions-item label="房价/晚">{{ fmtMoney(reservation?.rate) }}</el-descriptions-item>
    </el-descriptions>

    <el-alert
      v-if="pendingCount > 0"
      type="info"
      :closable="false"
      class="mb"
      :title="`另有 ${pendingCount} 间待入住，将按「未到」一并关闭`"
    />

    <el-form :model="form" label-width="100px">
      <el-form-item label="实际离店日期">
        <el-date-picker v-model="form.actual_check_out" type="date" value-format="YYYY-MM-DD" style="width: 100%" @change="loadInfo" />
      </el-form-item>

      <el-row :gutter="12" class="mb">
        <el-col :span="8">
          <div class="info-box">
            <div class="lbl">实际间夜</div>
            <div class="val">{{ info ? info.actual_nights : '-' }} 晚</div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="info-box">
            <div class="lbl">押金余额</div>
            <div class="val">{{ fmtMoney(info?.deposit_balance) }}</div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="info-box accent">
            <div class="lbl">应收合计</div>
            <div class="val">{{ fmtMoney(info?.projected_balance) }}</div>
          </div>
        </el-col>
      </el-row>

      <el-alert
        v-if="info?.unsettled_charges > 0"
        type="warning"
        :closable="false"
        class="mb"
        :title="`当前未结账消费 ¥${fmtMoney(info.unsettled_charges)}（不含退房补计房费）`"
        description="退房时按实收自动整单结账；仍未结清的部分需先在「客账管理」中逐笔结账或挂 AR 账户，否则无法退房。"
      />

      <template v-if="info">
        <!-- 押金抵扣 -->
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

        <!-- 需补款 -->
        <template v-if="remainingDue > 0">
          <el-alert type="warning" :closable="false" class="mb" title="客人需补款" :description="`应收 ¥${remainingDue.toFixed(2)}，请选择收款方式`" />
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
                <el-input-number v-model="form.pay_amount" :min="0" :precision="2" :max="999999" :controls="false" style="width: 100%" />
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
            未结清，将挂欠款 ¥{{ (remainingDue - form.pay_amount).toFixed(2) }}
          </div>
        </template>

        <!-- 应退款 -->
        <template v-else-if="remainingDue < 0">
          <el-alert type="success" :closable="false" class="mb" title="应退客人款项" :description="`应退 ¥${(-remainingDue).toFixed(2)}，请选择退款方式`" />
          <el-form-item label="退款方式">
            <el-select v-model="form.refund_method" style="width: 100%">
              <el-option v-for="m in payMethodsNoAr" :key="m" :label="m" :value="m" />
            </el-select>
          </el-form-item>
        </template>

        <el-alert v-else type="success" :closable="false" title="账单已结清，直接退房" />
      </template>
    </el-form>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="confirm">确认退房</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { fmtMoney, fmtDate } from '../utils/format';
import { dictOptions, nonArMethods } from '../utils/dict';

const props = defineProps({
  visible: Boolean,
  reservation: { type: Object, default: null },
});
const emit = defineEmits(['update:visible', 'saved']);

const pendingCount = computed(() => (props.reservation?.room_list || []).filter((u) => u.status === 'pending').length);
const payMethodsAll = computed(() => dictOptions('payment_method'));
const payMethodsNoAr = computed(() => nonArMethods());
const info = ref(null);
const saving = ref(false);
const arAccounts = ref([]);
const form = ref({ actual_check_out: fmtDate(), pay_method: '现金', pay_amount: 0, refund_method: '现金', deposit_refund_method: '现金', use_deposit: true, ar_account_id: null });

const projected = computed(() => info.value?.projected_balance || 0);
const depositBalance = computed(() => info.value?.deposit_balance || 0);
// 押金可抵扣金额
const depositApplied = computed(() => {
  if (!form.value.use_deposit || depositBalance.value <= 0 || projected.value <= 0) return 0;
  return Math.round(Math.min(depositBalance.value, projected.value) * 100) / 100;
});
// 抵扣后的应补/应退（正=补，负=退）
const remainingDue = computed(() => Math.round((projected.value - depositApplied.value) * 100) / 100);
const depositRemainder = computed(() => Math.round((depositBalance.value - depositApplied.value) * 100) / 100);
const canUseDeposit = computed(() => depositBalance.value > 0 && projected.value > 0);
const change = computed(() => {
  if (form.value.pay_method === '挂账') return 0;
  return Math.max(0, Math.round((Number(form.value.pay_amount) - Math.max(0, remainingDue.value)) * 100) / 100);
});

async function loadArAccounts() {
  try {
    const data = await http.get('/ar/accounts', { params: { status: 'active' } });
    arAccounts.value = data.list || [];
  } catch (e) {
    arAccounts.value = [];
  }
}

async function loadInfo() {
  if (!props.reservation) return;
  info.value = await http.get(`/reservations/${props.reservation.id}/checkout-info`, {
    params: { actual_check_out: form.value.actual_check_out },
  });
  form.value.use_deposit = true;
  form.value.pay_amount = 0;
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      form.value = { actual_check_out: fmtDate(), pay_method: '现金', pay_amount: 0, refund_method: '现金', deposit_refund_method: '现金', use_deposit: true, ar_account_id: null };
      loadArAccounts();
      loadInfo();
    }
  }
);

// 应补金额变化时，默认填入应收金额
watch(remainingDue, (v) => {
  form.value.pay_amount = v > 0 && form.value.pay_method !== '挂账' ? v : 0;
});

function reset() {
  info.value = null;
}

async function confirm() {
  if (!info.value) return;
  const payload = {
    actual_check_out: form.value.actual_check_out,
    use_deposit: form.value.use_deposit,
    deposit_refund_method: form.value.deposit_refund_method,
    payments: [],
    refund: null,
  };

  const due = remainingDue.value;
  if (due > 0) {
    if (form.value.pay_method === '挂账') {
      if (!form.value.ar_account_id) return ElMessage.warning('请选择挂账的 AR 账户');
      payload.payments = [{ method: '挂账', amount: due, ar_account_id: form.value.ar_account_id }];
    } else if (Number(form.value.pay_amount) > 0) {
      // 按实收全额入账（不截断），找零另记退款
      payload.payments = [{ method: form.value.pay_method, amount: Number(form.value.pay_amount) }];
    }
  }
  if (change.value > 0) {
    payload.refund = { method: form.value.pay_method, amount: change.value };
  } else if (due < 0) {
    payload.refund = { method: form.value.refund_method, amount: -due };
  }

  saving.value = true;
  try {
    const res = await http.post(`/reservations/${props.reservation.id}/check-out`, payload);
    if (res.final_balance > 0) {
      ElMessage.warning(`已退房，仍挂欠款 ${fmtMoney(res.final_balance)}`);
    } else if (res.final_balance < 0) {
      ElMessage.warning(`已退房，仍有应退 ${fmtMoney(-res.final_balance)} 未处理`);
    } else {
      ElMessage.success('退房成功，账单已结清');
    }
    emit('saved');
    emit('update:visible', false);
  } catch (e) {
    /* 已提示 */
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.mb { margin-bottom: 12px; }
.hint { font-size: 13px; }
.green { color: #2f9e44; }
.orange { color: #e8590c; }
.info-box {
  border: 1px solid #e9ecef;
  border-radius: 6px;
  padding: 10px;
  text-align: center;
  background: #f8f9fa;
}
.info-box .lbl { font-size: 12px; color: #868e96; }
.info-box .val { font-size: 15px; font-weight: 700; color: #212529; margin-top: 4px; }
.info-box.accent { border-color: #1c7ed6; background: #e7f5ff; }
.info-box.accent .val { color: #1c7ed6; }
</style>
