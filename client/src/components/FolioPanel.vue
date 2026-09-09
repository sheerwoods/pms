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
        <span>账单余额：</span>
        <b :class="balance > 0 ? 'money-pos' : balance < 0 ? 'money-neg' : ''">{{ balance > 0 ? '+' : balance < 0 ? '-' : '' }}{{ fmtMoney(Math.abs(balance)) }}</b>
      </div>
    </div>

    <el-table :data="folio.items" size="small" border max-height="360">
      <el-table-column label="时间" width="150">
        <template #default="{ row }">{{ row.created_at }}</template>
      </el-table-column>
      <el-table-column label="类型" width="80">
        <template #default="{ row }">
          <el-tag size="small" :type="typeTag(row.item_type)" effect="plain">{{ itemTypeText(row.item_type) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="category" label="类别" width="100" />
      <el-table-column prop="description" label="说明" min-width="140" />
      <el-table-column prop="method" label="方式" width="90" />
      <el-table-column label="金额" width="110" align="right">
        <template #default="{ row }">
          <span :class="row.amount >= 0 ? 'money-neg' : 'money-pos'">
            {{ row.amount >= 0 ? '-' : '+' }}{{ Math.abs(row.amount).toFixed(2) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="70" align="center">
        <template #default="{ row }">
          <el-button v-if="row.item_type !== 'info'" link type="danger" size="small" @click="removeItem(row)">冲销</el-button>
          <span v-else>-</span>
        </template>
      </el-table-column>
    </el-table>

    <div class="folio-foot">
      <div>
        <el-button type="success" size="small" @click="openAdd('extra_charge')">消费</el-button>
        <el-button type="danger" size="small" @click="openAdd('payment')">收款</el-button>
        <el-button size="small" @click="openAdd('adj')">调整</el-button>
      </div>
      <div class="folio-summary">
        <span>消费 <b class="money-neg">-{{ fmtMoney(summary.charges) }}</b></span>
        <span>收款 <b class="money-pos">+{{ fmtMoney(summary.paid) }}</b></span>
        <span>余额 <b :class="balance > 0 ? 'money-pos' : balance < 0 ? 'money-neg' : ''">{{ balance > 0 ? '+' : balance < 0 ? '-' : '' }}{{ fmtMoney(Math.abs(balance)) }}</b></span>
      </div>
    </div>

    <!-- 加账对话框 -->
    <el-dialog :model-value="addVisible" :title="addTitle" width="460px" @update:model-value="addVisible = $event">
      <el-form :model="addForm" label-width="90px">
        <el-form-item label="类别">
          <el-select v-model="addForm.category" allow-create filterable style="width: 100%">
            <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="addForm.description" placeholder="选填" />
        </el-form-item>
        <el-form-item label="金额" required>
          <el-input-number v-model="addForm.amount" :min="0" :precision="2" :max="999999" style="width: 100%" />
        </el-form-item>
        <el-form-item v-if="addForm.item_type === 'payment'" label="方式">
          <el-select v-model="addForm.method" style="width: 100%">
            <el-option v-for="m in PAY_METHODS" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitAdd">确认</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';
import { fmtMoney, RES_STATUS, PAY_METHODS } from '../utils/format';

const props = defineProps({
  reservationId: { type: [Number, String], default: null },
  plain: Boolean,
});
const emit = defineEmits(['changed']);

const folio = ref(null);
const saving = ref(false);
const addVisible = ref(false);
const addForm = reactive({ item_type: 'extra_charge', category: '迷你吧', description: '', amount: 0, method: '现金' });

const statusMeta = computed(() => (folio.value ? RES_STATUS[folio.value.reservation.status] : null));

const summary = computed(() => {
  if (!folio.value) return { charges: 0, paid: 0 };
  let charges = 0, paid = 0;
  for (const it of folio.value.items) {
    if (it.amount >= 0) charges += it.amount;
    else paid += -it.amount;
  }
  return { charges, paid };
});

// 余额 = 已收 − 消费（消费减少余额、收款增加余额）
const balance = computed(() => {
  const s = summary.value;
  return Math.round((s.paid - s.charges) * 100) / 100;
});

const categoryOptions = computed(() => {
  if (addForm.item_type === 'payment') return ['房费', '杂费', '预付'];
  if (addForm.item_type === 'adj') return ['调整', '补房费', '冲减'];
  return ['迷你吧', '洗衣', '电话', '赔偿', '早餐', '其他'];
});
const addTitle = computed(() => ({ extra_charge: '消费', payment: '收款', adj: '账务调整' }[addForm.item_type] || '消费'));

function itemTypeText(t) {
  return { room_charge: '房费', extra_charge: '杂费', deposit: '押金', payment: '收款', adj: '调整', info: '备注' }[t] || t;
}
function typeTag(t) {
  return { room_charge: 'primary', extra_charge: 'warning', deposit: 'info', payment: 'success', adj: 'danger', info: '' }[t] || '';
}

async function load() {
  if (!props.reservationId) { folio.value = null; return; }
  folio.value = await http.get('/finance/folio', { params: { reservation_id: props.reservationId } });
}

watch(
  () => props.reservationId,
  () => load(),
  { immediate: true }
);

function openAdd(item_type) {
  addForm.item_type = item_type;
  addForm.category = categoryOptions.value[0];
  addForm.description = '';
  addForm.amount = 0;
  addForm.method = '现金';
  addVisible.value = true;
}

async function submitAdd() {
  if (!addForm.amount || addForm.amount <= 0) return ElMessage.warning('请输入金额');
  saving.value = true;
  try {
    await http.post('/finance/items', {
      reservation_id: props.reservationId,
      item_type: addForm.item_type,
      category: addForm.category,
      description: addForm.description,
      amount: addForm.amount,
      method: addForm.method,
    });
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

async function removeItem(row) {
  try {
    await ElMessageBox.confirm(`确认冲销该笔${itemTypeText(row.item_type)}（${fmtMoney(row.amount)}）？`, '提示', { type: 'warning' });
  } catch (e) {
    return;
  }
  await http.delete(`/finance/items/${row.id}`);
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
.folio-balance { font-size: 14px; color: #495057; }
.folio-balance b { font-size: 18px; }
.folio-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
}
.folio-summary { display: flex; gap: 18px; font-size: 13px; color: #495057; }
</style>
