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
          <el-date-picker v-model="txRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始营业日" end-placeholder="结束营业日" style="width: 260px" />
          <el-input v-model="txKeyword" placeholder="类别/说明/单号/客人" clearable style="width: 220px" @keyup.enter="loadTx" @clear="loadTx">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-button type="primary" @click="loadTx">查询</el-button>
        </div>
        <el-table :data="txList" border size="small" v-loading="txLoading" max-height="520">
          <el-table-column label="时间" width="150">
            <template #default="{ row }">{{ row.created_at }}</template>
          </el-table-column>
          <el-table-column prop="bdate" label="营业日" width="108" />
          <el-table-column prop="order_no" label="单号" width="170" />
          <el-table-column prop="guest_name" label="客人" width="80" />
          <el-table-column prop="room_no" label="房号" width="56" align="center">
            <template #default="{ row }">{{ row.room_no || '-' }}</template>
          </el-table-column>
          <el-table-column label="类型" width="84">
            <template #default="{ row }">
              <el-tag size="small" :type="kindTag(row)" effect="plain">{{ kindText(row) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="category" label="类别" width="90" />
          <el-table-column prop="description" label="说明" min-width="130" />
          <el-table-column prop="method" label="方式" width="76" />
          <el-table-column label="金额" width="118" align="right">
            <template #default="{ row }">
              <template v-if="row.item_type === 'info'"><span class="amt-zero">—</span></template>
              <span v-else :class="mv(row.amount).cls">{{ mv(row.amount).sign }}{{ mv(row.amount).text }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="66" align="center">
            <template #default="{ row }">
              <el-button v-if="row.item_type !== 'info'" link type="danger" size="small" @click="removeTx(row)">冲销</el-button>
              <span v-else>-</span>
            </template>
          </el-table-column>
        </el-table>
        <div class="tx-total">
          入账 <b class="amt-in">+{{ fmtMoney(txSum.inSum) }}</b>
          ｜ 出账 <b class="amt-out">−{{ fmtMoney(txSum.outSum) }}</b>
          ｜ 净额 <b :class="netBal.cls">{{ netBal.sign }}{{ netBal.text }}</b>
          <span class="sub">（账户视角：收款红 +，消费绿 −）</span>
        </div>
      </el-tab-pane>

      <!-- ============ AR 账户（应收账款） ============ -->
      <el-tab-pane label="AR 账户" name="ar">
        <div class="filter-row">
          <el-select v-model="arStatus" style="width: 130px" @change="loadArAccounts">
            <el-option label="启用" value="active" />
            <el-option label="停用" value="disabled" />
            <el-option label="全部" value="" />
          </el-select>
          <el-input v-model="arKeyword" placeholder="编号 / 名称 / 联系人 / 电话" clearable style="width: 230px" @keyup.enter="loadArAccounts" @clear="loadArAccounts">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-button type="primary" @click="loadArAccounts">查询</el-button>
          <el-button type="success" @click="openAcctForm(null)">新建账户</el-button>
        </div>
        <el-table :data="arList" border size="small" v-loading="arLoading" max-height="520">
          <el-table-column prop="code" label="编号" width="100" />
          <el-table-column prop="name" label="账户名称" min-width="160" />
          <el-table-column prop="contact" label="联系人" width="100" />
          <el-table-column prop="phone" label="电话" width="130" />
          <el-table-column label="未结余额" width="120" align="right">
            <template #default="{ row }"><b :class="row.outstanding > 0 ? 'bal-due' : 'bal-settled'">{{ fmtMoney(row.outstanding) }}</b></template>
          </el-table-column>
          <el-table-column label="状态" width="80" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.status === 'active' ? 'success' : 'info'" effect="plain">{{ row.status === 'active' ? '启用' : '停用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="openAcctDetail(row)">详情</el-button>
              <el-button link type="primary" size="small" @click="openAcctForm(row)">编辑</el-button>
              <el-button link :type="row.status === 'active' ? 'warning' : 'success'" size="small" @click="toggleAccount(row)">
                {{ row.status === 'active' ? '停用' : '启用' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="tx-total">启用账户未结合计：<b class="bal-due">{{ fmtMoney(arTotal) }}</b></div>
      </el-tab-pane>

      <!-- ============ 报表 ============ -->
      <el-tab-pane label="营业报表" name="report">
        <div class="filter-row">
          <el-date-picker v-model="reportRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始营业日" end-placeholder="结束营业日" style="width: 260px" />
          <el-button type="primary" @click="loadReport">生成报表</el-button>
        </div>

        <template v-if="report">
          <div class="stat-cards">
            <div class="stat-card"><div class="lbl">消费合计</div><div class="val amt-out">−{{ fmtMoney(report.charge_total) }}</div></div>
            <div class="stat-card"><div class="lbl">房费收入</div><div class="val">{{ fmtMoney(report.room_revenue) }}</div></div>
            <div class="stat-card"><div class="lbl">杂费</div><div class="val">{{ fmtMoney(report.extra_revenue) }}</div></div>
            <div class="stat-card"><div class="lbl">调整</div><div class="val">{{ fmtMoney(report.adj_total) }}</div></div>
            <div class="stat-card"><div class="lbl">实收金额</div><div class="val amt-in">+{{ fmtMoney(report.payment_total) }}</div></div>
            <div class="stat-card"><div class="lbl">退款</div><div class="val">{{ fmtMoney(report.refund_total) }}</div></div>
            <div class="stat-card"><div class="lbl">净收</div><div class="val amt-in">+{{ fmtMoney(report.net_receipt) }}</div></div>
            <div class="stat-card"><div class="lbl">挂账应收</div><div class="val">{{ fmtMoney(report.city_ledger_total) }}</div></div>
            <div class="stat-card"><div class="lbl">AR 回款</div><div class="val amt-in">+{{ fmtMoney(report.ar_receipt_total) }}</div></div>
            <div class="stat-card"><div class="lbl">押金收 / 退</div><div class="val">{{ fmtMoney(report.deposit_in) }} / {{ fmtMoney(report.deposit_out) }}</div></div>
            <div class="stat-card"><div class="lbl">间夜</div><div class="val">{{ report.nights_sold }}</div></div>
            <div class="stat-card"><div class="lbl">入住率</div><div class="val">{{ report.occupancy_rate }}%</div></div>
            <div class="stat-card"><div class="lbl">平均房价 ADR</div><div class="val">{{ fmtMoney(report.adr) }}</div></div>
            <div class="stat-card"><div class="lbl">RevPAR</div><div class="val">{{ fmtMoney(report.revpar) }}</div></div>
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
                <template #header>收款方式明细（实收）</template>
                <el-table :data="report.paymentByMethod" size="small" border>
                  <el-table-column prop="method" label="方式" />
                  <el-table-column label="金额" align="right">
                    <template #default="{ row }"><b class="amt-in">{{ fmtMoney(row.amount) }}</b></template>
                  </el-table-column>
                </el-table>
              </el-card>
            </el-col>
          </el-row>

          <el-card shadow="never" class="report-card">
            <template #header>按营业日营收</template>
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

    <!-- 新建/编辑 AR 账户 -->
    <el-dialog :model-value="acctFormVisible" :title="acctForm.id ? '编辑账户' : '新建 AR 账户'" width="440px" @update:model-value="acctFormVisible = $event">
      <el-form :model="acctForm" label-width="90px">
        <el-form-item label="编号">
          <el-input v-model="acctForm.code" placeholder="留空自动生成 AR0001" />
        </el-form-item>
        <el-form-item label="账户名称" required>
          <el-input v-model="acctForm.name" placeholder="公司 / 协议单位" />
        </el-form-item>
        <el-form-item label="联系人">
          <el-input v-model="acctForm.contact" />
        </el-form-item>
        <el-form-item label="电话">
          <el-input v-model="acctForm.phone" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="acctForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="acctFormVisible = false">取消</el-button>
        <el-button type="primary" :loading="acctSaving" @click="submitAcctForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- AR 账户详情 -->
    <el-dialog :model-value="acctDetailVisible" :title="`AR 账户：${acctDetail?.account?.name || ''}`" width="900px" @update:model-value="acctDetailVisible = $event">
      <template v-if="acctDetail">
        <el-descriptions :column="4" border size="small" class="mb">
          <el-descriptions-item label="编号">{{ acctDetail.account.code }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ acctDetail.account.status === 'active' ? '启用' : '停用' }}</el-descriptions-item>
          <el-descriptions-item label="联系人">{{ acctDetail.account.contact || '-' }}</el-descriptions-item>
          <el-descriptions-item label="电话">{{ acctDetail.account.phone || '-' }}</el-descriptions-item>
          <el-descriptions-item label="挂账合计">{{ fmtMoney(acctDetail.totals.total) }}</el-descriptions-item>
          <el-descriptions-item label="已核销">{{ fmtMoney(acctDetail.totals.settled) }}</el-descriptions-item>
          <el-descriptions-item label="未结余额"><b class="bal-due">{{ fmtMoney(acctDetail.totals.outstanding) }}</b></el-descriptions-item>
          <el-descriptions-item label="操作">
            <el-button size="small" type="primary" :disabled="acctDetail.totals.outstanding <= 0" @click="openReceipt(null)">账户回款</el-button>
          </el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">应收明细</el-divider>
        <div class="entry-bar">
          <el-button size="small" type="primary" :disabled="!selEntries.length" @click="openBatch">
            选中结账<span v-if="selEntries.length">（¥{{ fmtMoney(selEntryTotal) }}）</span>
          </el-button>
          <span class="entry-hint">勾选应收明细后按所选未结合计付款结账；单项可点「核销」。</span>
        </div>
        <el-table ref="entryTable" :data="acctDetail.entries" border size="small" max-height="260" @selection-change="onEntrySelect">
          <el-table-column type="selection" width="40" :selectable="(row) => row.outstanding > 0" />
          <el-table-column prop="business_date" label="营业日" width="100" />
          <el-table-column prop="order_no" label="关联单号" width="160" />
          <el-table-column prop="guest_name" label="客人" width="90" />
          <el-table-column prop="remark" label="备注" min-width="120" />
          <el-table-column label="挂账额" width="100" align="right">
            <template #default="{ row }"><b class="amt-in">{{ fmtMoney(row.amount) }}</b></template>
          </el-table-column>
          <el-table-column label="已核销" width="100" align="right">
            <template #default="{ row }">{{ fmtMoney(row.settled_amount) }}</template>
          </el-table-column>
          <el-table-column label="未结" width="100" align="right">
            <template #default="{ row }"><b :class="row.outstanding > 0 ? 'bal-due' : 'bal-settled'">{{ fmtMoney(row.outstanding) }}</b></template>
          </el-table-column>
          <el-table-column label="操作" width="80" align="center">
            <template #default="{ row }">
              <el-button v-if="row.outstanding > 0" link type="primary" size="small" @click="openReceipt(row)">核销</el-button>
              <span v-else>-</span>
            </template>
          </el-table-column>
        </el-table>

        <el-divider content-position="left">回款记录</el-divider>
        <el-table :data="acctDetail.receipts" border size="small" max-height="220">
          <el-table-column prop="business_date" label="营业日" width="100" />
          <el-table-column prop="method" label="方式" width="90" />
          <el-table-column prop="remark" label="备注" min-width="120" />
          <el-table-column label="回款额" width="110" align="right">
            <template #default="{ row }"><b class="amt-in">{{ fmtMoney(row.amount) }}</b></template>
          </el-table-column>
          <el-table-column label="核销明细" min-width="220">
            <template #default="{ row }">
              <span v-for="a in row.allocations" :key="a.id" class="alloc-chip">
                {{ a.order_no || ('#' + a.entry_id) }} ¥{{ fmtMoney(a.amount) }}
              </span>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-dialog>

    <!-- 回款 / 单笔核销 / 选中结账 -->
    <el-dialog :model-value="receiptVisible" :title="receiptTitle" width="440px" @update:model-value="receiptVisible = $event">
      <el-form :model="receiptForm" label-width="90px">
        <el-form-item label="账户">{{ acctDetail?.account?.name }}</el-form-item>
        <el-form-item :label="receiptForm.entry_ids.length ? '所选未结' : (receiptForm.entry_id ? '该笔未结' : '账户未结')">
          <b class="bal-due">{{ fmtMoney(receiptForm.max) }}</b>
        </el-form-item>
        <el-form-item label="回款金额" required>
          <el-input-number v-model="receiptForm.amount" :min="0" :max="receiptForm.max" :precision="2" :controls="false" :disabled="receiptForm.entry_ids.length > 0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="收款方式">
          <el-select v-model="receiptForm.method" style="width: 100%">
            <el-option v-for="m in payMethods" :key="m" :label="m" :value="m" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="receiptForm.remark" placeholder="选填" />
        </el-form-item>
      </el-form>
      <div class="ar-hint">{{ receiptHint }}</div>
      <template #footer>
        <el-button @click="receiptVisible = false">取消</el-button>
        <el-button type="primary" :loading="receiptSaving" @click="submitReceipt">确认</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';
import { store } from '../store';
import { fmtMoney, fmtDate, RES_STATUS } from '../utils/format';
import { nonArMethods } from '../utils/dict';
import { moneyView, balanceView, itemKindOf, itemKindText, itemKindTag } from '../utils/money';
import FolioPanel from '../components/FolioPanel.vue';

const activeTab = ref('folio');
const payMethods = computed(() => nonArMethods());
const mv = (n) => moneyView(n);
const kindOf = (row) => itemKindOf(row);
const kindText = (row) => itemKindText(kindOf(row));
const kindTag = (row) => itemKindTag(kindOf(row));

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
const txLoading = ref(false);
const txSum = computed(() => {
  let inSum = 0, outSum = 0;
  for (const r of txList.value) {
    if (r.item_type === 'info') continue;
    if (r.amount < 0) inSum += -r.amount; else outSum += r.amount;
  }
  return { inSum: Math.round(inSum * 100) / 100, outSum: Math.round(outSum * 100) / 100, net: Math.round((inSum - outSum) * 100) / 100 };
});
// 净额：>0 净流入（红 +），<0 净流出（绿 −）
const netBal = computed(() => balanceView(txSum.value.net));
async function loadTx() {
  txLoading.value = true;
  try {
    const params = {};
    if (txRange.value?.length === 2) { params.start = txRange.value[0]; params.end = txRange.value[1]; }
    if (txKeyword.value) params.keyword = txKeyword.value;
    const data = await http.get('/finance/transactions', { params });
    txList.value = data.list;
  } finally {
    txLoading.value = false;
  }
}
async function removeTx(row) {
  try {
    await ElMessageBox.confirm(`确认冲销该笔${kindText(row)}？`, '提示', { type: 'warning' });
  } catch (e) { return; }
  try {
    await http.delete(`/finance/items/${row.id}`);
  } catch (e) { return; }
  ElMessage.success('已冲销');
  await loadTx();
  store.loadStats();
}

// ---- AR 账户 ----
const arStatus = ref('active');
const arKeyword = ref('');
const arList = ref([]);
const arTotal = ref(0);
const arLoading = ref(false);
async function loadArAccounts() {
  arLoading.value = true;
  try {
    const params = {};
    if (arStatus.value) params.status = arStatus.value;
    if (arKeyword.value) params.keyword = arKeyword.value;
    const data = await http.get('/ar/accounts', { params });
    arList.value = data.list;
    arTotal.value = data.totalOutstanding;
  } finally {
    arLoading.value = false;
  }
}

// 新建 / 编辑账户
const acctFormVisible = ref(false);
const acctSaving = ref(false);
const acctForm = reactive({ id: null, code: '', name: '', contact: '', phone: '', remark: '' });
function openAcctForm(row) {
  acctForm.id = row?.id || null;
  acctForm.code = row?.code || '';
  acctForm.name = row?.name || '';
  acctForm.contact = row?.contact || '';
  acctForm.phone = row?.phone || '';
  acctForm.remark = row?.remark || '';
  acctFormVisible.value = true;
}
async function submitAcctForm() {
  if (!acctForm.name.trim()) return ElMessage.warning('请填写账户名称');
  acctSaving.value = true;
  try {
    const body = { code: acctForm.code, name: acctForm.name, contact: acctForm.contact, phone: acctForm.phone, remark: acctForm.remark };
    if (acctForm.id) await http.put(`/ar/accounts/${acctForm.id}`, body);
    else await http.post('/ar/accounts', body);
    ElMessage.success('已保存');
    acctFormVisible.value = false;
    await loadArAccounts();
  } catch (e) {
    /* 已提示 */
  } finally {
    acctSaving.value = false;
  }
}
async function toggleAccount(row) {
  const next = row.status === 'active' ? 'disabled' : 'active';
  try {
    await ElMessageBox.confirm(`确认${next === 'disabled' ? '停用' : '启用'}账户「${row.name}」？`, '提示', { type: 'warning' });
  } catch (e) { return; }
  await http.put(`/ar/accounts/${row.id}`, { status: next });
  ElMessage.success('已更新');
  await loadArAccounts();
}

// 账户详情
const acctDetailVisible = ref(false);
const acctDetail = ref(null);
async function loadAcctDetail(id) {
  acctDetail.value = await http.get(`/ar/accounts/${id}`);
  selEntries.value = [];
  entryTable.value?.clearSelection();
}
async function openAcctDetail(row) {
  await loadAcctDetail(row.id);
  acctDetailVisible.value = true;
}

// 回款 / 单笔核销 / 选中结账
const receiptVisible = ref(false);
const receiptSaving = ref(false);
const entryTable = ref(null);
const selEntries = ref([]);
const receiptForm = reactive({ entry_id: null, entry_ids: [], amount: 0, max: 0, method: '银行卡', remark: '' });
const selEntryTotal = computed(() => round2(selEntries.value.reduce((s, r) => s + r.outstanding, 0)));
const receiptTitle = computed(() => (receiptForm.entry_ids.length ? '选中结账' : (receiptForm.entry_id ? '单笔核销' : '账户回款')));
const receiptHint = computed(() => (receiptForm.entry_ids.length
  ? '按所选明细逐笔核销，金额须等于所选未结合计。'
  : (receiptForm.entry_id ? '仅核销所选明细。' : '按最早未结明细自动依次核销（FIFO）。')));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const onEntrySelect = (rows) => { selEntries.value = rows; };

function openBatch() {
  if (!selEntries.value.length) return;
  receiptForm.entry_ids = selEntries.value.map((r) => r.id);
  receiptForm.entry_id = null;
  receiptForm.max = selEntryTotal.value;
  receiptForm.amount = receiptForm.max;
  receiptForm.method = '银行卡';
  receiptForm.remark = '';
  receiptVisible.value = true;
}
function openReceipt(entry) {
  receiptForm.entry_ids = [];
  if (entry) {
    receiptForm.entry_id = entry.id;
    receiptForm.max = entry.outstanding;
  } else {
    receiptForm.entry_id = null;
    receiptForm.max = acctDetail.value?.totals?.outstanding || 0;
  }
  receiptForm.amount = receiptForm.max;
  receiptForm.method = '银行卡';
  receiptForm.remark = '';
  receiptVisible.value = true;
}
async function submitReceipt() {
  if (!(receiptForm.amount > 0)) return ElMessage.warning('请输入金额');
  if (receiptForm.amount > receiptForm.max + 0.005) return ElMessage.warning(`金额不能超过未结 ¥${receiptForm.max.toFixed(2)}`);
  receiptSaving.value = true;
  try {
    const body = { amount: receiptForm.amount, method: receiptForm.method, remark: receiptForm.remark };
    if (receiptForm.entry_ids.length) await http.post('/ar/entries/batch-settle', { ...body, entry_ids: receiptForm.entry_ids });
    else if (receiptForm.entry_id) await http.post(`/ar/entries/${receiptForm.entry_id}/settle`, body);
    else await http.post(`/ar/accounts/${acctDetail.value.account.id}/receipt`, body);
    ElMessage.success(receiptForm.entry_ids.length ? '已结账' : (receiptForm.entry_id ? '已核销' : '已回款'));
    receiptVisible.value = false;
    await Promise.all([loadArAccounts(), loadAcctDetail(acctDetail.value.account.id)]);
    store.loadStats();
  } catch (e) {
    /* 已提示 */
  } finally {
    receiptSaving.value = false;
  }
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

function loadStats() {
  store.loadStats();
}

onMounted(() => {
  searchRes('');
  loadTx();
  loadArAccounts();
});
</script>

<style scoped>
.folio-select { display: flex; }
.filter-row { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.tx-total { margin-top: 12px; font-size: 14px; color: #495057; text-align: right; }
.tx-total .sub { font-size: 12px; color: #adb5bd; }

.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stat-card {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}
.stat-card .lbl { font-size: 12px; color: #868e96; }
.stat-card .val { font-size: 18px; font-weight: 700; margin-top: 6px; color: #212529; }

.report-card { margin-bottom: 16px; }

.ar-hint { font-size: 12px; color: #868e96; }
.entry-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.entry-hint { font-size: 12px; color: #868e96; }
.alloc-chip {
  display: inline-block; margin: 2px 6px 2px 0; padding: 1px 6px;
  font-size: 12px; color: #495057; background: #f1f3f5; border-radius: 4px;
}

.chart { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 8px; }
.chart-col { display: flex; flex-direction: column; align-items: center; min-width: 64px; }
.chart-bars { display: flex; align-items: flex-end; gap: 3px; height: 135px; }
.bar { width: 12px; border-radius: 3px 3px 0 0; }
.bar-room { background: #1c7ed6; }
.bar-extra { background: #e8590c; }
.bar-payment { background: #e03131; }
.chart-date { font-size: 11px; color: #868e96; margin-top: 6px; }
.chart-legend { display: flex; gap: 8px; font-size: 10px; color: #868e96; margin-top: 4px; }
.chart-legend span { display: flex; align-items: center; gap: 3px; }
.dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.dot-room { background: #1c7ed6; }
.dot-extra { background: #e8590c; }
.dot-payment { background: #e03131; }
</style>
