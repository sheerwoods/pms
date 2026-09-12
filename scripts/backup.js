// 数据库备份：WAL 模式下直接复制 db 文件会丢失未 checkpoint 的事务，
// 改用 VACUUM INTO 生成完整、自洽的单文件快照。一店一个库，逐库备份。
// 用法：node scripts/backup.js
//   PMS_DATA_DIR    数据目录（默认 ../data）
//   PMS_BACKUP_DIR  备份目录（默认 <PMS_DATA_DIR>/backup/<门店>/）
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.PMS_DATA_DIR || path.join(__dirname, '..', 'data');
const OUT_DIR = process.env.PMS_BACKUP_DIR || path.join(DATA_DIR, 'backup');
const STORES_DIR = path.join(DATA_DIR, 'stores');

const sources = [];
if (fs.existsSync(STORES_DIR)) {
  for (const f of fs.readdirSync(STORES_DIR)) {
    if (f.endsWith('.db')) sources.push({ name: f.replace(/\.db$/, ''), file: path.join(STORES_DIR, f) });
  }
}
const legacy = path.join(DATA_DIR, 'pms.db');
if (fs.existsSync(legacy)) sources.push({ name: 'legacy-pms', file: legacy });

if (!sources.length) {
  console.error('未找到任何数据库：', STORES_DIR, '与', legacy);
  process.exit(1);
}

const d = new Date();
const p = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;

for (const s of sources) {
  const dir = path.join(OUT_DIR, s.name);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${s.name}-${stamp}.db`);
  const db = new DatabaseSync(s.file);
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  console.log('已备份:', dest);
}
console.log(`共备份 ${sources.length} 个数据库 → ${OUT_DIR}`);
