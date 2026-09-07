<template>
  <el-card shadow="never">
    <el-tabs v-model="activeTab">
      <!-- ============ 客账 ============ -->
      <el-tab-pane label="客账管理" name="folio">
        <div class="folio-select">
          <el-select
            v-model="selectedResId"
            filterable
            remote
            clearable
            :remote-method="searchRes"
            placeholder="按订单号 / 客人 / 手机号搜索订单"
            style="width: 380px"
            @change="onSelectRes"
          >
            <el-option
              v-for="r in resOptions"
              :key="r.id"
              :label="`${r.order_no}｜${r.guest_name}｜${r.room_no || '未分房'}｜${RES_STATUS[r.status]?.text}`"
              :value="r.id"
            />
          </el-select>
        </div>
        <el-divider style="margin: 12px 0" />
        <FolioPanel v-if="selectedResId" :key="selectedResId" :reservation-id="selectedResId" @changed="loadStats" />
        <el-empty v-else description="请选择一笔订单查看客账" :image-size="80" />
      </el-tab-pane>

      <!-- ============ 流水 ============ -->
      <el-tab-pane label="账务流水" name="transactions">
        <div class="filter-row">
          <el-date-picker v-model="txRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" style="width: 260px" />
          <el-input v-model="txKeyword" placeholder="类别/说明/单号/客人" clearable style="width: 220px" @keyup.enter="loadTx" @clear="loadTx">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-button type="primary" @click="loadTx">查询</el-button>
        </div>
        <el-table :data="txList" border size="small" v-loading="txLoading" max-height="520">
          <el-table-column label="时间" width="150">
            <template #default="{ row }">{{ row.created_at }}</template>
          </el-table-column>
          <el-table-column prop="order_no" label="单号" width="180" />
          <el-table-column prop="guest_name" label="客人" width="90" />
          <el-table-column prop="room_no" label="房号" width="60" align="center">
            <template #default="{ row }">{{ row.room_no || '-' }}</template>
          </el-table-column>
          <el-table-column label="类型" width="80">
            <template #default="{ row }">{{ itemTypeText(row.item_type) }}</template>
          </el-table-column>
          <el-table-column prop="category" label="类别" width="100" />
          <el-table-column prop="description" label="说明" min-width="140" />
          <el-table-column prop="method" label="方式" width="80" />
          <el-table-column label="金额" width="110" align="right">
            <template #default="{ row }">
              <span :class="row.amount >= 0 ? 'money-pos' : 'money-neg'">
                {{ row.amount >= 0 ? '+' : '' }}{{ row.amount.toFixed(2) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center">
            <template #default="{ row }">
              <el-button v-if="row.item_type !== 'info'" link type="danger" size="small" @click="removeTx(row)">冲销</el-button>
              <span v-else>-</span>
            </template>
          </el-table-column>
        </el-table>
        <div class="tx-total">
          合计净额：<b :class="txTotal >= 0 ? 'money-pos' : 'money-neg'">{{ fmtMoney(txTotal) }}</b>
          <span class="sub">（正=应收增加，负=实收）</span>
        </div>
      </el-tab-pane>

      <!-- ============ 报表 ============ -->
      <el-tab-pane label="营业报表" name="report">
        <div class="filter-row">
          <el-date-picker v-model="reportRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" style="width: 260px" />
          <el-button type="primary" @click="loadReport">生成报表</el-button>
        </div>

        <template v-if="report">
          <div class="stat-cards">
            <div class="stat-card"><div class="lbl">消费合计</div><div class="val money-pos">{{ fmtMoney(report.charge_total) }}</div></div>
            <div class="stat-card"><div class="lbl">房费收入</div><div class="val">{{ fmtMoney(report.room_revenue) }}</div></div>
            <div class="stat-card"><div class="lbl">杂费/其他</div><div class="val">{{ fmtMoney(report.extra_revenue + report.adj_total) }}</div></div>
            <div class="stat-card"><div class="lbl">实收金额</div><div class="val money-neg">{{ fmtMoney(report.payment_total) }}</div></div>
            <div class="stat-card"><div class="lbl">退款</div><div class="val">{{ fmtMoney(report.refund_total) }}</div></div>
            <div class="stat-card"><div class="lbl">间夜</div><div class="val">{{ report.nights_sold }}</div></div>
            <div class="stat-card"><div class="lbl">入住率</div><div class="val">{{ report.occupancy_rate }}%</div></div>
            <div class="stat-card"><div class="lbl">平均房价 ADR</div><div class="val">{{ fmtMoney(report.adr) }}</div></div>
          </div>

          <el-row :gutter="16">
            <el-col :span="12">
              <el-card shadow="never" class="report-card">
                <template #header>收入分类明细</template>
                <el-table :data="report.chargeByCategory" size="small" border>
                  <el-table-column prop="category" label="类别" />
                  <el-table-column label="金额" align="right">
                    <template #default="{ row }"><b>{{ fmtMoney(row.amount) }}</b></template>
                  </el-table-column>
                </el-table>
              </el-card>
            </el-col>
            <el-col :span="12">
              <el-card shadow="never" class="report-card">
                <template #header>收款方式明细</template>
                <el-table :data="report.paymentByMethod" size="small" border>
                  <el-table-column prop="method" label="方式" />
                  <el-table-column label="金额" align="right">
                    <template #default="{ row }"><b class="money-neg">{{ fmtMoney(row.amount) }}</b></template>
                  </el-table-column>
                </el-table>
              </el-card>
            </el-col>
          </el-row>

          <el-card shadow="never" class="report-card">
            <template #header>按日营收</template>
            <div class="chart">
              <div v-for="d in report.daily" :key="d.date" class="chart-col">
                <div class="chart-bars">
                  <div class="bar bar-room" :style="{ height: barHeight(d.room) }" :title="`房费 ${fmtMoney(d.room)}`"></div>
                  <div class="bar bar-extra" :style="{ height: barHeight(d.extra) }" :title="`杂费 ${fmtMoney(d.extra)}`"></div>
                  <div class="bar bar-payment" :style="{ height: barHeight(d.payment) }" :title="`实收 ${fmtMoney(d.payment)}`"></div>
                </div>
                <div class="chart-date">{{ d.date.slice(5) }}</div>
                <div class="chart-legend">
                  <span><i class="dot dot-room"></i>房费</span>
                  <span><i class="dot dot-extra"></i>杂费</span>
                  <span><i class="dot dot-payment"></i>实收</span>
                </div>
              </div>
            </div>
          </el-card>
        </template>
        <el-empty v-else description="请选择日期范围生成报表" />
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';
import { store } from '../store';
import { fmtMoney, fmtDate, RES_STATUS } from '../utils/format';
import FolioPanel from '../components/FolioPanel.vue';

const activeTab = ref('folio');

// ---- 客账 ----
const resOptions = ref([]);
const selectedResId = ref(null);
async function searchRes(kw) {
  const data = await http.get('/reservations', { params: { keyword: kw || '', pageSize: 20 } });
  resOptions.value = data.list;
}
function onSelectRes() { /* FolioPanel 通过 key 响应 */ }

// ---- 流水 ----
const txRange = ref([fmtDate(), fmtDate()]);
const txKeyword = ref('');
const txList = ref([]);
const txTotal = ref(0);
const txLoading = ref(false);
async function loadTx() {
  txLoading.value = true;
  try {
    const params = {};
    if (txRange.value?.length === 2) { params.start = txRange.value[0]; params.end = txRange.value[1]; }
    if (txKeyword.value) params.keyword = txKeyword.value;
    const data = await http.get('/finance/transactions', { params });
    txList.value = data.list;
    txTotal.value = data.totalAmount;
  } finally {
    txLoading.value = false;
  }
}
async function removeTx(row) {
  try {
    await ElMessageBox.confirm(`确认冲销该笔${itemTypeText(row.item_type)}？`, '提示', { type: 'warning' });
  } catch (e) { return; }
  await http.delete(`/finance/items/${row.id}`);
  ElMessage.success('已冲销');
  await loadTx();
  store.loadStats();
}

// ---- 报表 ----
const reportRange = ref([fmtDate(), fmtDate()]);
const report = ref(null);
async function loadReport() {
  if (reportRange.value?.length !== 2) return;
  report.value = await http.get('/finance/report', {
    params: { start: reportRange.value[0], end: reportRange.value[1] },
  });
}
function barHeight(v) {
  const max = Math.max(...report.value.daily.map((d) => Math.max(d.room, d.extra, d.payment)), 1);
  return Math.max(2, Math.round((Math.abs(v) / max) * 130)) + 'px';
}

function itemTypeText(t) {
  return { room_charge: '房费', extra_charge: '杂费', deposit: '押金', payment: '收款', adj: '调整', info: '备注' }[t] || t;
}

function loadStats() {
  store.loadStats();
}

onMounted(() => {
  searchRes('');
  loadTx();
});
</script>

<style scoped>
.folio-select { display: flex; }
.filter-row { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.tx-total { margin-top: 12px; font-size: 14px; color: #495057; text-align: right; }
.tx-total .sub { font-size: 12px; color: #adb5bd; }

.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stat-card {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 14px;
  text-align: center;
}
.stat-card .lbl { font-size: 12px; color: #868e96; }
.stat-card .val { font-size: 20px; font-weight: 700; margin-top: 6px; color: #212529; }

.report-card { margin-bottom: 16px; }

.chart { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 8px; }
.chart-col { display: flex; flex-direction: column; align-items: center; min-width: 64px; }
.chart-bars { display: flex; align-items: flex-end; gap: 3px; height: 135px; }
.bar { width: 12px; border-radius: 3px 3px 0 0; }
.bar-room { background: #1c7ed6; }
.bar-extra { background: #e8590c; }
.bar-payment { background: #2f9e44; }
.chart-date { font-size: 11px; color: #868e96; margin-top: 6px; }
.chart-legend { display: flex; gap: 8px; font-size: 10px; color: #868e96; margin-top: 4px; }
.chart-legend span { display: flex; align-items: center; gap: 3px; }
.dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.dot-room { background: #1c7ed6; }
.dot-extra { background: #e8590c; }
.dot-payment { background: #2f9e44; }
</style>
