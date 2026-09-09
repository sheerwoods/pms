<template>
  <el-dialog
    :model-value="visible"
    title="排房"
    width="820px"
    align-center
    :close-on-click-modal="false"
    @update:model-value="(v) => $emit('update:visible', v)"
    @closed="reset"
    class="room-assign-dialog"
  >
    <div v-if="detail">
      <div class="head-info">
        <span class="hi">{{ detail.guest_name }}</span>
        <span class="hs">{{ detail.order_no }}｜{{ detail.check_in_date }} ~ {{ detail.check_out_date }}</span>
      </div>

      <el-table :data="rows" border size="default">
        <el-table-column label="房型" min-width="120">
          <template #default="{ row }">{{ row.type_name }}</template>
        </el-table-column>
        <el-table-column label="价格" width="90" align="right">
          <template #default="{ row }">{{ fmtMoney(row.price) }}</template>
        </el-table-column>
        <el-table-column label="可定数" width="90" align="center">
          <template #default="{ row }">{{ row.avail }}</template>
        </el-table-column>
        <el-table-column label="预订间数" width="90" align="center">
          <template #default="{ row }">{{ row.reserved }}</template>
        </el-table-column>
        <el-table-column label="未排房" width="90" align="center">
          <template #default="{ row }">
            <span v-if="row.unassigned > 0" class="u-warn">{{ row.unassigned }}</span>
            <span v-else class="u-ok">0</span>
          </template>
        </el-table-column>
        <el-table-column label="已排房" min-width="140">
          <template #default="{ row }">{{ row.assigned || '-' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button size="small" type="primary" plain :disabled="row.unassigned <= 0" @click="openAssign(row)">排房</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">关闭</el-button>
      <el-button type="success" @click="save">保存</el-button>
    </template>

    <!-- 排房：为某房型的未排房单元选择房间 -->
    <el-dialog :model-value="assignVisible" :title="assignTitle" width="520px" @update:model-value="assignVisible = $event">
      <el-table :data="assignSelections" size="small" border max-height="320">
        <el-table-column label="#" type="index" width="46" align="center" />
        <el-table-column label="房间" width="60" align="center">
          <template #default>
            <span class="sub">待排</span>
          </template>
        </el-table-column>
        <el-table-column label="选择房间" min-width="200">
          <template #default="{ row, $index }">
            <el-select v-model="row.room_id" size="small" filterable clearable placeholder="选择房间（不选则不排）" style="width: 100%" @change="() => onPick($index)">
              <el-option v-for="r in candidateRooms($index)" :key="r.id" :label="`${r.room_no}（${r.type_name}）`" :value="r.id" />
            </el-select>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="confirmAssign">确定</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { fmtMoney } from '../utils/format';

const props = defineProps({
  visible: Boolean,
  reservation: { type: Object, default: null },
});
const emit = defineEmits(['update:visible', 'saved']);

const detail = ref(null);
const availableRooms = ref([]);
const roomTypes = ref([]);
const saving = ref(false);

const assignVisible = ref(false);
const assignType = ref(null);
const assignSelections = ref([]);

const roomTypeMap = computed(() => {
  const m = {};
  roomTypes.value.forEach((t) => { m[t.id] = t.name; });
  return m;
});

// 按房型分组聚合
const rows = computed(() => {
  const byType = {};
  (detail.value?.room_list || []).forEach((u) => {
    const tid = u.room_type_id || 0;
    (byType[tid] = byType[tid] || []).push(u);
  });
  return Object.entries(byType).map(([tid, units]) => {
    const t = roomTypeMap.value[tid];
    const reserved = units.length;
    const assigned = units.filter((u) => u.room_no).map((u) => u.room_no).join('、');
    const unassigned = units.filter((u) => u.status === 'pending' && !u.room_id).length;
    const avail = availableRooms.value.filter((r) => r.type_id == tid).length;
    return {
      type_id: tid,
      type_name: t?.name || units[0]?.room_type_name || '未选房型',
      price: t?.base_price ?? 0,
      avail,
      reserved,
      unassigned,
      assigned,
    };
  });
});

const assignTitle = computed(() => {
  const name = assignType.value?.type_name || '';
  return name ? `排房 · ${name}` : '排房';
});

// 每个待排单元可选的房间：可用房中该房型，排除已由其它单元选中的房间
function candidateRooms(idx) {
  const typeId = assignType.value?.type_id;
  const chosen = assignSelections.value.filter((s, i) => i !== idx && s.room_id).map((s) => s.room_id);
  return availableRooms.value.filter((r) => r.type_id == typeId && !chosen.includes(r.id));
}

function onPick(idx) {
  // 重复选择时清空后选者，确保一间房只分配给一个单元
  const sel = assignSelections.value[idx];
  if (!sel.room_id) return;
  const dup = assignSelections.value.findIndex((s, i) => i !== idx && s.room_id && s.room_id === sel.room_id);
  if (dup >= 0) assignSelections.value[dup].room_id = null;
}

function openAssign(row) {
  assignType.value = row;
  assignSelections.value = (detail.value?.room_list || [])
    .filter((u) => u.status === 'pending' && !u.room_id && (u.room_type_id || 0) == row.type_id)
    .map((u) => ({ unit: u, room_id: null }));
  assignVisible.value = true;
}

async function load() {
  if (!props.reservation?.id) { detail.value = null; return; }
  const [d, avail, types] = await Promise.all([
    http.get(`/reservations/${props.reservation.id}`),
    http.get('/rooms/available'),
    http.get('/room-types'),
  ]);
  detail.value = d;
  availableRooms.value = avail;
  roomTypes.value = types;
}

watch(() => props.visible, (v) => { if (v) load(); });

async function confirmAssign() {
  const assignments = assignSelections.value
    .filter((s) => s.room_id)
    .map((s) => ({ row_id: s.unit.id, room_id: s.room_id }));
  if (!assignments.length) return ElMessage.warning('请至少为一间未排房选择房间');
  saving.value = true;
  try {
    await http.post(`/reservations/${props.reservation.id}/assign`, { assignments });
    ElMessage.success(`已排房 ${assignments.length} 间`);
    assignVisible.value = false;
    await load();
    emit('saved');
  } catch (e) {
    /* 已提示 */
  } finally {
    saving.value = false;
  }
}

async function save() {
  await load();
  emit('saved');
  emit('update:visible', false);
}

function reset() {
  detail.value = null;
  assignVisible.value = false;
  assignType.value = null;
  assignSelections.value = [];
}
</script>

<style scoped>
.head-info { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.head-info .hi { font-size: 15px; font-weight: 600; color: #212529; }
.head-info .hs { font-size: 12px; color: #868e96; }
.u-warn { color: #e03131; font-weight: 700; }
.u-ok { color: #868e96; }
.sub { font-size: 12px; color: #adb5bd; }
</style>

<style>
.room-assign-dialog.el-dialog {
  border-radius: 14px;
  overflow: hidden;
}
.room-assign-dialog .el-dialog__title {
  font-size: 16px;
  font-weight: 600;
}
</style>
