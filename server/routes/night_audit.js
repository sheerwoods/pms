// 夜审接口：查询现状 / 立即执行 / 修改夜审时间
const express = require('express');
const { AppError, wrap } = require('../errors');
const {
  getAuditTime, getLastAuditDate, setAuditTime,
  collectPending, runNightAudit,
} = require('../nightAudit');

const router = express.Router();

// 现状：夜审时间、上次夜审、当前营业日、待补计数量
router.get('/night-audit', wrap((req, res) => {
  const { pending, units, business_date, last_night } = collectPending();
  res.json({
    audit_time: getAuditTime(),
    last_audit_date: getLastAuditDate() || null,
    business_date,
    last_night,
    pending_units: units,
    pending_items: pending.length,
  });
}));

// 立即执行夜审（允许提前触发）
router.post('/night-audit/run', wrap((req, res) => {
  res.json(runNightAudit());
}));

// 修改夜审时间（HH:MM）
router.put('/night-audit', wrap((req, res) => {
  const { audit_time } = req.body;
  if (!audit_time || !/^\d{2}:\d{2}$/.test(audit_time)) throw new AppError('夜审时间格式应为 HH:MM');
  setAuditTime(audit_time);
  res.json({ ok: true, audit_time });
}));

module.exports = router;
