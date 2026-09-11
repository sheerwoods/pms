// 系统设置：字典项维护（消费类别 / 收款类别 / 收款方式 / 客源渠道）
// 口径：这里只维护前台下拉候选，不做强制校验，历史数据照常显示
const express = require('express');
const { q, get, run } = require('../db');
const { AppError, wrap } = require('../errors');

const router = express.Router();

const KINDS = ['charge_category', 'payment_category', 'payment_method', 'source'];

function getItem(id) {
  const row = get('SELECT * FROM dict_items WHERE id=?', id);
  if (!row) throw new AppError('配置项不存在', 404);
  return row;
}

// 全量字典（含停用项，前端按 status 过滤）
router.get('/settings/dicts', wrap((req, res) => {
  const rows = q('SELECT * FROM dict_items ORDER BY sort_order, id');
  const out = {};
  for (const k of KINDS) out[k] = [];
  for (const r of rows) if (out[r.kind]) out[r.kind].push(r);
  res.json(out);
}));

router.post('/settings/dicts', wrap((req, res) => {
  const { kind, name, sort_order = 0, remark = '' } = req.body;
  if (!KINDS.includes(kind)) throw new AppError('未知的配置类型');
  const n = String(name || '').trim();
  if (!n) throw new AppError('名称不能为空');
  if (get('SELECT id FROM dict_items WHERE kind=? AND name=?', kind, n)) throw new AppError('已存在同名项');
  const r = run('INSERT INTO dict_items (kind, name, sort_order, remark) VALUES (?,?,?,?)', kind, n, Number(sort_order) || 0, String(remark || ''));
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
}));

router.put('/settings/dicts/:id', wrap((req, res) => {
  const item = getItem(req.params.id);
  const { name, sort_order, status, remark } = req.body;
  const n = name === undefined ? item.name : String(name).trim();
  if (!n) throw new AppError('名称不能为空');
  if (item.system && n !== item.name) throw new AppError('系统内置项不可改名');
  if (get('SELECT id FROM dict_items WHERE kind=? AND name=? AND id<>?', item.kind, n, item.id)) throw new AppError('已存在同名项');
  const st = status === undefined ? item.status : String(status);
  if (!['active', 'disabled'].includes(st)) throw new AppError('状态不合法');
  const sort = sort_order === undefined ? item.sort_order : Number(sort_order) || 0;
  run('UPDATE dict_items SET name=?, sort_order=?, status=?, remark=? WHERE id=?',
    n, sort, st, remark === undefined ? item.remark : String(remark || ''), item.id);
  res.json({ ok: true });
}));

router.delete('/settings/dicts/:id', wrap((req, res) => {
  const item = getItem(req.params.id);
  if (item.system) throw new AppError('系统内置项不可删除');
  run('DELETE FROM dict_items WHERE id=?', item.id);
  res.json({ ok: true });
}));

module.exports = router;
