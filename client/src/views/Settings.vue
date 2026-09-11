<template>
  <el-card shadow="never">
    <el-tabs v-model="activeTab">
      <el-tab-pane label="消费类别" name="charge_category">
        <DictManager kind="charge_category" hint="前台「消费」可选的类别，停用后不再出现在下拉中。" />
      </el-tab-pane>
      <el-tab-pane label="收款方式" name="payment_method">
        <DictManager kind="payment_method" hint="收款 / 退款 / 押金时的结算方式；「挂账」为系统内置项（走 AR 账户），不可删除或改名。" />
      </el-tab-pane>
      <el-tab-pane label="收款类别" name="payment_category">
        <DictManager kind="payment_category" hint="前台「收款」登记的收款事由类别。" />
      </el-tab-pane>
      <el-tab-pane label="客源渠道" name="source">
        <DictManager kind="source" hint="预订表单的订单来源渠道。" />
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import DictManager from '../components/DictManager.vue';
import { loadDicts } from '../utils/dict';

const activeTab = ref('charge_category');

onMounted(() => loadDicts(true));
</script>
