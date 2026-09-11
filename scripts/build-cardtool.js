// 编译 32 位 C# 制卡助手 CardTool.exe
// 用法：npm run build:cardtool
// 也可被 server/card.js 在首次调用时 require 自动构建
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VENDOR_DIR = path.join(__dirname, '..', 'vendor', 'es200601');
const SOURCE = path.join(VENDOR_DIR, 'CardTool.cs');
const OUTPUT = path.join(VENDOR_DIR, 'CardTool.exe');

function findCsc() {
  const winDir = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(winDir, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),      // 32 位优先
    path.join(winDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function isUpToDate() {
  try {
    return fs.statSync(OUTPUT).mtimeMs >= fs.statSync(SOURCE).mtimeMs;
  } catch {
    return false;
  }
}

function build({ force = false } = {}) {
  if (!fs.existsSync(SOURCE)) return { ok: false, reason: `缺少源文件 ${SOURCE}` };
  if (!force && isUpToDate()) return { ok: true, path: OUTPUT, skipped: true };

  const csc = findCsc();
  if (!csc) return { ok: false, reason: '未找到 .NET Framework csc.exe，无法编译制卡助手' };

  try {
    execFileSync(csc, ['/nologo', '/platform:x86', '/optimize+', `/out:${OUTPUT}`, SOURCE], {
      cwd: VENDOR_DIR,
      stdio: 'pipe',
    });
    return { ok: true, path: OUTPUT };
  } catch (e) {
    const detail = (e.stdout || e.stderr || Buffer.from('')).toString().trim();
    return { ok: false, reason: `编译失败：${detail || e.message}` };
  }
}

if (require.main === module) {
  const r = build({ force: true });
  if (r.ok) {
    console.log(`✅ CardTool.exe 编译完成${r.skipped ? '（已是最新）' : ''}: ${r.path}`);
  } else {
    console.warn(`⚠️  CardTool.exe 未生成：${r.reason}`);
    process.exitCode = 1;
  }
}

module.exports = build;
