<template>
  <el-dialog
    :model-value="visible"
    title="换房"
    width="480px"
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
  >
    <el-form :model="form" label-width="90px">
      <el-form-item label="当前房间">
        <el-input :model-value="currentRoomText" disabled />
      </el-form-item>
      <el-form-item label="新房间" required>
        <el-select v-model="form.new_room_id" placeholder="请选择新房间" style="width: 100%">
          <el-option v-for="r in roomOptions" :key="r.id" :label="`${r.room_no}（${r.type_name}）`" :value="r.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="换房原因">
        <el-input v-model="form.reason" type="textarea" :rows="2" placeholder="选填" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="confirm">确认换房</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';

const props = defineProps({
  visible: Boolean,
  reservation: { type: Object, default: null },
  unitId: { type: [Number, String], default: null }, // 要更换的房间子单（多间订单）
});
const emit = defineEmits(['update:visible', 'saved']);

const availableRooms = ref([]);
const saving = ref(false);
const form = ref({ new_room_id: null, reason: '' });

// 目标子单：显式 unitId 优先，否则回退订单首间
const targetUnit = computed(() => {
  const list = props.reservation?.room_list || [];
  if (props.unitId != null) return list.find((u) => Number(u.id) === Number(props.unitId)) || null;
  return list.find((u) => u.status === 'checked_in') || null;
});
const currentRoomId = computed(() => targetUnit.value?.room_id ?? props.reservation?.room_id);
const currentRoomText = computed(() => {
  const u = targetUnit.value;
  const no = u?.room_no || props.reservation?.room_no || '-';
  return `${no}（${props.reservation?.type_name || '-'}）`;
});

const roomOptions = computed(() =>
  availableRooms.value.filter((r) => r.id !== currentRoomId.value)
);

watch(
  () => props.visible,
  async (v) => {
    if (!v) return;
    availableRooms.value = await http.get('/rooms/available');
    form.value = { new_room_id: null, reason: '' };
  }
);

async function confirm() {
  if (!form.value.new_room_id) return ElMessage.warning('请选择新房间');
  saving.value = true;
  try {
    await http.post(`/reservations/${props.reservation.id}/change-room`, {
      ...form.value,
      unit_id: targetUnit.value?.id ?? null,
    });
    ElMessage.success('换房成功');
    emit('saved');
    emit('update:visible', false);
  } catch (e) {
    /* 已提示 */
  } finally {
    saving.value = false;
  }
}
</script>
