<template>
  <el-dialog
    :model-value="visible"
    title="客账管理"
    width="760px"
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
  >
    <FolioPanel v-if="visible" :reservation-id="reservationId" @changed="$emit('changed')" />
  </el-dialog>
</template>

<script setup>
import FolioPanel from './FolioPanel.vue';

defineProps({
  visible: Boolean,
  reservationId: { type: [Number, String], default: null },
});
const emit = defineEmits(['update:visible', 'changed']);
</script>
