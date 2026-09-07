<template>
  <el-dialog
    :model-value="visible"
    title="办理入住"
    width="520px"
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
    @closed="reset"
  >
    <el-descriptions :column="2" border size="small" class="mb">
      <el-descriptions-item label="客人">{{ reservation?.guest_name }}</el-descriptions-item>
      <el-descriptions-item label="订单号">{{ reservation?.order_no }}</el-descriptions-item>
      <el-descriptions-item label="入住">{{ reservation?.check_in_date }}</el-descriptions-item>
      <el-descriptions-item label="离店">{{ reservation?.check_out_date }}</el-descriptions-item>
      <el-descriptions-item label="间夜">{{ reservation?.nights }}</el-descriptions-item>
      <el-descriptions-item label="房价/晚">{{ fmtMoney(reservation?.rate) }}</el-descriptions-item>
    </el-descriptions>

    <el-form :model="form" label-width="90px">
      <el-form-item label="房间" required>
        <el-select v-model="form.room_id" placeholder="请选择房间" style="width: 100%">
          <el-option v-for="r in roomOptions" :key="r.id" :label="`${r.room_no}（${r.type_name}）`" :value="r.id" />
        </el-select>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="confirm">确认入住</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { fmtMoney } from '../utils/format';

const props = defineProps({
  visible: Boolean,
  reservation: { type: Object, default: null },
});
const emit = defineEmits(['update:visible', 'saved']);

const availableRooms = ref([]);
const saving = ref(false);
const form = ref({ room_id: null });

const roomOptions = computed(() => {
  let list = [...availableRooms.value];
  const cur = props.reservation?.room_id && !list.find((r) => r.id === props.reservation.room_id)
    ? {
        id: props.reservation.room_id, room_no: props.reservation.room_no,
        type_id: props.reservation.room_type_id, type_name: props.reservation.type_name,
      }
    : null;
  if (cur) list.unshift(cur);
  if (props.reservation?.room_type_id) list = list.filter((r) => r.type_id === props.reservation.room_type_id);
  return list;
});

watch(
  () => props.visible,
  async (v) => {
    if (!v) return;
    availableRooms.value = await http.get('/rooms/available');
    form.value.room_id = props.reservation?.room_id || null;
  }
);

function reset() {
  form.value = { room_id: null };
}

async function confirm() {
  if (!form.value.room_id) return ElMessage.warning('请选择房间');
  saving.value = true;
  try {
    await http.post(`/reservations/${props.reservation.id}/check-in`, form.value);
    ElMessage.success('入住成功');
    emit('saved');
    emit('update:visible', false);
  } catch (e) {
    /* 已提示 */
  } finally {
    saving.value = false;
  }
}
</script>
