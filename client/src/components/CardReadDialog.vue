<template>
  <el-dialog
    :model-value="visible"
    title="读门锁卡"
    width="540px"
    align-center
    @update:model-value="(v) => $emit('update:visible', v)"
    @open="doRead"
  >
    <div v-loading="loading" class="read-wrap">
      <el-alert v-if="error" :title="error" type="warning" :closable="false" show-icon />
      <template v-else-if="card">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="卡类型">{{ card.card_type_text || '-' }}（{{ card.card_type }}）</el-descriptions-item>
          <el-descriptions-item label="卡号">{{ card.card_no || '-' }}</el-descriptions-item>
          <el-descriptions-item label="批次">{{ card.batch || '-' }}</el-descriptions-item>
          <el-descriptions-item label="门锁房号">{{ card.lock_no || '-' }}</el-descriptions-item>
          <el-descriptions-item label="对应房号">{{ card.room_no || '未匹配' }}</el-descriptions-item>
          <el-descriptions-item label="特殊房">{{ card.special_room_list || '-' }}</el-descriptions-item>
          <el-descriptions-item label="开始时间">{{ card.begin_time || '-' }}</el-descriptions-item>
          <el-descriptions-item label="结束时间">{{ card.end_time || '-' }}</el-descriptions-item>
          <el-descriptions-item label="电梯楼层">
            {{ [card.floor1, card.floor2, card.floor3].filter((x) => x > 0).join('、') || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="备用数据">{{ card.ex_card_mess || '-' }}</el-descriptions-item>
        </el-descriptions>
        <div v-if="card.room_no" class="stay-tip muted">该房当前无在住订单</div>
      </template>
      <el-empty v-else description="暂无读卡数据" />
    </div>
    <template #footer>
      <el-button :loading="loading" @click="doRead">重新读卡</el-button>
      <el-button type="primary" @click="$emit('update:visible', false)">关闭</el-button>
    </template>
  </el-dialog>

  <!-- 读卡匹配到在住房间时直接打开订单详情 -->
  <OrderDetailDialog v-model:visible="orderVisible" :reservation-id="orderResId" :room-id="orderRoomId" />
</template>

<script setup>
import { ref } from 'vue';
import http from '../api';
import OrderDetailDialog from './OrderDetailDialog.vue';

defineProps({ visible: Boolean });
const emit = defineEmits(['update:visible']);

const loading = ref(false);
const error = ref('');
const card = ref(null);
const orderVisible = ref(false);
const orderResId = ref(null);
const orderRoomId = ref(null);

async function doRead() {
  loading.value = true;
  error.value = '';
  card.value = null;
  try {
    const r = await http.post('/card/read');
    if (r.ok) {
      card.value = r.card;
      // 匹配到房间且该房有在住订单：直接打开订单详情
      if (r.stay && r.room) {
        orderResId.value = r.stay.reservation_id;
        orderRoomId.value = r.room.id;
        emit('update:visible', false);
        orderVisible.value = true;
        return;
      }
    } else {
      error.value = r.message || '读卡失败';
    }
  } catch (e) {
    error.value = e.response?.data?.error || e.message || '读卡失败';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.read-wrap { min-height: 120px; }
.stay-tip { margin-top: 12px; font-size: 13px; color: #1c7ed6; }
.stay-tip.muted { color: #868e96; }
</style>
