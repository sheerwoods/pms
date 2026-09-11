<template>
  <el-dialog
    :model-value="visible"
    title="门锁制卡"
    width="560px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
    @open="onOpen"
    @closed="reset"
  >
    <div v-loading="loading" class="card-write">
      <template v-if="targets.length">
        <el-form label-width="96px" size="default">
          <el-form-item v-if="targets.length > 1" label="制卡房间">
            <el-select v-model="index" style="width: 100%" @change="fillForm">
              <el-option
                v-for="(t, i) in targets"
                :key="t.room_id"
                :label="`${t.room_no || t.room_id}${t.lock_no ? '（' + t.lock_no + '）' : ''}`"
                :value="i"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="门锁房号">
            <span class="lock-no">{{ current.lock_no || '—' }}</span>
            <span class="lock-room">对应房号 {{ current.room_no || '-' }}</span>
          </el-form-item>
          <el-form-item label="客人姓名">
            <el-input v-model="form.guest_name" placeholder="客人姓名（客人卡建议填写）" maxlength="30" />
          </el-form-item>
          <el-form-item label="卡类型">
            <el-radio-group v-model="form.card_type">
              <el-radio :value="0">新卡</el-radio>
              <el-radio :value="1">复制卡</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="有效期">
            <el-date-picker
              v-model="form.begin_time"
              type="datetime"
              placeholder="开始时间"
              format="YYYY-MM-DD HH:mm"
              value-format="YYYY-MM-DD HH:mm"
              style="width: 190px"
            />
            <span class="sep">至</span>
            <el-date-picker
              v-model="form.end_time"
              type="datetime"
              placeholder="结束时间（可空=不限）"
              format="YYYY-MM-DD HH:mm"
              value-format="YYYY-MM-DD HH:mm"
              style="width: 190px"
            />
          </el-form-item>
          <el-form-item label="特殊房号">
            <el-input v-model="form.special_room_list" placeholder="最多9位，如 379000000" maxlength="9" @input="onSpecial" />
          </el-form-item>
          <el-form-item label="电梯楼层">
            <el-input-number v-model="form.floor1" :min="0" :max="99" :controls="false" style="width: 80px" />
            <el-input-number v-model="form.floor2" :min="0" :max="99" :controls="false" style="width: 80px; margin-left: 8px" />
            <el-input-number v-model="form.floor3" :min="0" :max="99" :controls="false" style="width: 80px; margin-left: 8px" />
            <span class="hint">除房间所在楼层外可刷的额外电梯楼层</span>
          </el-form-item>
        </el-form>

        <el-alert v-if="result" type="success" :closable="false" show-icon class="result">
          <template #title>
            制卡成功：卡号 <b>{{ result.card_no }}</b>，门锁房号 {{ result.lock_no }}，
            {{ result.begin_time }} ~ {{ result.end_time || '不限' }}
          </template>
        </el-alert>
        <el-alert v-if="error" type="warning" :closable="false" show-icon class="result" :title="error" />
      </template>
      <el-empty v-else description="没有可制卡的房间" />
    </div>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">关闭</el-button>
      <el-button plain @click="$emit('read')">读卡</el-button>
      <el-button type="primary" :loading="saving" :disabled="!targets.length" @click="submit">制卡</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';

const props = defineProps({
  visible: Boolean,
  // { reservation_id, guest_name, check_in_date, check_out_date,
  //   rooms: [{ unit_id, room_id, room_no?, guest_name?, check_out_date? }] }
  payload: { type: Object, default: null },
});
const emit = defineEmits(['update:visible', 'saved', 'read']);

const loading = ref(false);
const saving = ref(false);
const roomMap = ref({});
const index = ref(0);
const error = ref('');
const result = ref(null);
const form = reactive({
  guest_name: '', card_type: 0, begin_time: '', end_time: '',
  special_room_list: '', floor1: 0, floor2: 0, floor3: 0,
});

const targets = computed(() => {
  const rooms = (props.payload && props.payload.rooms) || [];
  return rooms.map((r) => {
    const info = roomMap.value[r.room_id] || {};
    return {
      ...r,
      room_no: r.room_no || info.room_no || '',
      lock_no: info.lock_no || info.auto_lock_no || '',
    };
  });
});
const current = computed(() => targets.value[index.value] || {});

async function loadRoomMap() {
  loading.value = true;
  try {
    const rows = await http.get('/card/rooms');
    const m = {};
    rows.forEach((r) => { m[r.id] = r; });
    roomMap.value = m;
  } catch (e) { /* 已提示 */ } finally { loading.value = false; }
}

async function onOpen() {
  error.value = '';
  result.value = null;
  index.value = 0;
  if (!Object.keys(roomMap.value).length) await loadRoomMap();
  fillForm();
}

function fillForm() {
  const p = props.payload || {};
  const c = current.value;
  form.guest_name = c.guest_name || p.guest_name || '';
  form.card_type = 0;
  form.special_room_list = '';
  form.floor1 = 0;
  form.floor2 = 0;
  form.floor3 = 0;
  form.begin_time = p.check_in_date ? `${p.check_in_date} 14:00` : '';
  const out = c.check_out_date || p.check_out_date;
  form.end_time = out ? `${out} 12:00` : '';
}

function onSpecial(v) {
  form.special_room_list = String(v || '').replace(/\D/g, '').slice(0, 9);
}

async function submit() {
  const c = current.value;
  if (!c.room_id) return ElMessage.warning('缺少房间');
  if (!(form.guest_name || '').trim()) return ElMessage.warning('请填写客人姓名');
  saving.value = true;
  error.value = '';
  result.value = null;
  try {
    const r = await http.post('/card/write-guest', {
      reservation_id: props.payload.reservation_id,
      unit_id: c.unit_id || null,
      room_id: c.room_id,
      guest_name: form.guest_name.trim(),
      card_type: form.card_type,
      special_room_list: form.special_room_list,
      begin_time: form.begin_time,
      end_time: form.end_time,
      floor1: form.floor1,
      floor2: form.floor2,
      floor3: form.floor3,
    });
    result.value = r;
    ElMessage.success(`制卡成功，卡号 ${r.card_no}`);
    emit('saved');
    // 多间时自动切到下一间未制卡房间
    if (targets.value.length > 1 && index.value < targets.value.length - 1) {
      index.value += 1;
      fillForm();
    }
  } catch (e) {
    error.value = e.response?.data?.error || e.message || '制卡失败';
  } finally {
    saving.value = false;
  }
}

function reset() {
  error.value = '';
  result.value = null;
  index.value = 0;
  Object.assign(form, {
    guest_name: '', card_type: 0, begin_time: '', end_time: '',
    special_room_list: '', floor1: 0, floor2: 0, floor3: 0,
  });
}
</script>

<style scoped>
.card-write { min-height: 140px; }
.lock-no { font-size: 18px; font-weight: 800; color: #1c7ed6; letter-spacing: 1px; }
.lock-room { margin-left: 12px; font-size: 13px; color: #868e96; }
.sep { margin: 0 8px; color: #909399; }
.hint { margin-left: 10px; font-size: 12px; color: #adb5bd; }
.result { margin-top: 8px; }
</style>
