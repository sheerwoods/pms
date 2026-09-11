<template>
  <div>
    <div class="filter-row">
      <el-button type="success" @click="openForm(null)">新增</el-button>
      <span v-if="hint" class="dict-hint">{{ hint }}</span>
    </div>

    <el-table :data="dict[kind] || []" border size="small" v-loading="loading" max-height="520">
      <el-table-column label="名称" min-width="180">
        <template #default="{ row }">
          <span>{{ row.name }}</span>
          <el-tag v-if="row.system" size="small" type="warning" effect="plain" class="dict-sys">系统</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="sort_order" label="排序" width="80" align="center" />
      <el-table-column label="状态" width="80" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.status === 'active' ? 'success' : 'info'" effect="plain">
            {{ row.status === 'active' ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="200">
        <template #default="{ row }">{{ row.remark || '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="190" align="center">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openForm(row)">编辑</el-button>
          <el-button link :type="row.status === 'active' ? 'warning' : 'success'" size="small" @click="toggle(row)">
            {{ row.status === 'active' ? '停用' : '启用' }}
          </el-button>
          <el-button link type="danger" size="small" :disabled="!!row.system" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog :model-value="formVisible" :title="form.id ? '编辑' : '新增'" width="440px" @update:model-value="formVisible = $event">
      <el-form :model="form" label-width="70px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" maxlength="20" placeholder="如：迷你吧" :disabled="!!form.system" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort_order" :min="0" :max="999" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" placeholder="选填" maxlength="50" />
        </el-form-item>
      </el-form>
      <div v-if="form.system" class="dict-hint">系统内置项不可改名，仅可调整排序与备注。</div>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';
import { dict, loadDicts } from '../utils/dict';

const props = defineProps({
  kind: { type: String, required: true },
  hint: { type: String, default: '' },
});

const loading = ref(false);
const saving = ref(false);
const formVisible = ref(false);
const form = reactive({ id: null, name: '', sort_order: 0, remark: '', system: 0 });

async function refresh() {
  loading.value = true;
  try {
    await loadDicts(true);
  } finally {
    loading.value = false;
  }
}

function openForm(row) {
  form.id = row ? row.id : null;
  form.name = row ? row.name : '';
  form.sort_order = row ? row.sort_order : (dict[props.kind]?.length || 0) + 1;
  form.remark = row ? row.remark : '';
  form.system = row ? row.system : 0;
  formVisible.value = true;
}

async function submit() {
  if (!form.name.trim()) return ElMessage.warning('请输入名称');
  saving.value = true;
  try {
    const body = { name: form.name.trim(), sort_order: form.sort_order, remark: form.remark };
    if (form.id) await http.put(`/settings/dicts/${form.id}`, body);
    else await http.post('/settings/dicts', { ...body, kind: props.kind });
    ElMessage.success('已保存');
    formVisible.value = false;
    await refresh();
  } catch { /* 已提示 */ } finally {
    saving.value = false;
  }
}

async function toggle(row) {
  try {
    await http.put(`/settings/dicts/${row.id}`, { status: row.status === 'active' ? 'disabled' : 'active' });
    ElMessage.success(row.status === 'active' ? '已停用' : '已启用');
    await refresh();
  } catch { /* 已提示 */ }
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(`确认删除「${row.name}」？已使用该类别/方式的历史流水不受影响。`, '删除确认', { type: 'warning' });
  } catch { return; }
  try {
    await http.delete(`/settings/dicts/${row.id}`);
    ElMessage.success('已删除');
    await refresh();
  } catch { /* 已提示 */ }
}
</script>

<style scoped>
.dict-hint { color: #868e96; font-size: 12px; }
.dict-sys { margin-left: 6px; }
</style>
