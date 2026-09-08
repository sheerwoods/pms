<template>
  <el-dialog
    :model-value="visible"
    title="退房结算"
    width="560px"
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
            <div class="lbl">当前账单</div>
            <div class="val">{{ fmtMoney(info?.current_balance) }}</div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="info-box accent">
            <div class="lbl">应收合计</div>
            <div class="val">{{ fmtMoney(info?.projected_balance) }}</div>
          </div>
        </el-col>
      </el-row>

      <template v-if="info && info.projected_balance > 0">
        <el-alert type="warning" :closable="false" class="mb" title="客人需补款" :description="`应收 ¥${info.projected_balance.toFixed(2)}，请选择收款方式`" />
        <el-row :gutter="16">
          <el-col :span="10">
            <el-form-item label="收款方式">
              <el-select v-model="form.pay_method" style="width: 100%">
                <el-option v-for="m in PAY_METHODS" :key="m" :label="m" :value="m" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="14">
            <el-form-item label="实收金额">
              <el-input-number v-model="form.pay_amount" :min="0" :precision="2" :max="999999" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <div v-if="form.pay_amount > info.projected_balance" class="mb hint green">找零 ¥{{ (form.pay_amount - info.projected_balance).toFixed(2) }}</div>
        <div v-if="form.pay_amount < info.projected_balance" class="mb hint orange">未结清，将挂欠款 ¥{{ (info.projected_balance - form.pay_amount).toFixed(2) }}</div>
      </template>

      <template v-else-if="info && info.projected_balance < 0">
        <el-alert type="success" :closable="false" class="mb" title="应退客人款项" :description="`应退 ¥${(-info.projected_balance).toFixed(2)}，请选择退款方式`" />
        <el-form-item label="退款方式">
          <el-select v-model="form.refund_method" style="width: 100%">
            <el-option v-for="m in PAY_METHODS" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
      </template>

      <el-alert v-else-if="info && info.projected_balance === 0" type="success" :closable="false" title="账单已结清，直接退房" />
    </el-form>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="confirm">确认退房</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { fmtMoney, fmtDate, PAY_METHODS } from '../utils/format';

const props = defineProps({
  visible: Boolean,
  reservation: { type: Object, default: null },
});
const emit = defineEmits(['update:visible', 'saved']);

const info = ref(null);
const saving = ref(false);
const form = ref({ actual_check_out: fmtDate(), pay_method: '现金', pay_amount: 0, refund_method: '现金' });

async function loadInfo() {
  if (!props.reservation) return;
  info.value = await http.get(`/reservations/${props.reservation.id}/checkout-info`, {
    params: { actual_check_out: form.value.actual_check_out },
  });
  form.value.pay_amount = info.value.projected_balance > 0 ? info.value.projected_balance : 0;
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      form.value = { actual_check_out: fmtDate(), pay_method: '现金', pay_amount: 0, refund_method: '现金' };
      loadInfo();
    }
  }
);

function reset() {
  info.value = null;
}

async function confirm() {
  if (!info.value) return;
  const bal = info.value.projected_balance;
  const payload = { actual_check_out: form.value.actual_check_out, payments: [], refund: null };

  if (bal > 0) {
    const payAmount = Number(form.value.pay_amount) || 0;
    const toPay = Math.min(bal, payAmount);
    if (toPay > 0) payload.payments = [{ method: form.value.pay_method, amount: toPay }];
    if (payAmount > bal) payload.refund = { method: form.value.pay_method, amount: payAmount - bal };
  } else if (bal < 0) {
    payload.refund = { method: form.value.refund_method, amount: -bal };
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
.info-box .val { font-size: 16px; font-weight: 700; color: #212529; margin-top: 4px; }
.info-box.accent { border-color: #1c7ed6; background: #e7f5ff; }
.info-box.accent .val { color: #1c7ed6; }
</style>
