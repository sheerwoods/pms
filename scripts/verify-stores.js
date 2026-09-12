// 多店隔离验证脚本（临时环境，不碰真实数据）
// 用法：node scripts/verify-stores.js <first|second|removed>
//   first   首次建库 + 造一张引用 A103 的订单
//   second  再次建库，验证幂等（房号 id 不变）
//   removed 用「已删除 A103」的配置再建库，验证被订单引用的房间不会被删
const path = require('path');
const fs = require('fs');
const os = require('os');

const MODE = process.argv[2] || 'first';
const ROOT = path.join(__dirname, '..');
// 固定目录：三个模式共用同一个库，才能验证幂等与「配置删房间但订单仍在」
const SANDBOX = process.env.PMS_VERIFY_DIR || path.join(os.tmpdir(), 'pmsverify-fixed');
const CONFIG_DIR = path.join(SANDBOX, 'config');
const DATA_DIR = path.join(SANDBOX, 'data');
fs.mkdirSync(path.join(CONFIG_DIR, 'rooms'), { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

process.env.PMS_DATA_DIR = DATA_DIR;
process.env.PMS_CONFIG = path.join(CONFIG_DIR, 'stores.json');

const { hashPassword } = require(path.join(ROOT, 'server', 'auth', 'session'));

// removed 模式下 A103 从配置中移除，并开启 removeMissingRooms
const roomsA = MODE === 'removed'
  ? [{ roomNo: 'A101', floor: 1, type: '标间' }, { roomNo: 'A102', floor: 1, type: '标间' }]
  : [{ roomNo: 'A101', floor: 1, type: '标间' }, { roomNo: 'A102', floor: 1, type: '标间' }, { roomNo: 'A103', floor: 1, type: '标间' }];

fs.writeFileSync(path.join(CONFIG_DIR, 'rooms', 'a.json'), JSON.stringify({
  roomTypes: [{ name: '标间', basePrice: 100 }],
  rooms: roomsA,
}));
fs.writeFileSync(path.join(CONFIG_DIR, 'rooms', 'b.json'), JSON.stringify({
  roomTypes: [{ name: '大床房', basePrice: 200 }],
  rooms: [{ roomNo: 'B201', floor: 2, type: '大床房' }, { roomNo: 'B202', floor: 2, type: '大床房' }],
}));
fs.writeFileSync(path.join(CONFIG_DIR, 'stores.json'), JSON.stringify({
  version: 1,
  stores: [
    { key: 'a', name: 'A店', enabled: true, account: { username: 'a', displayName: 'A', passwordHash: hashPassword('x') }, roomPlanFile: 'rooms/a.json', removeMissingRooms: MODE === 'removed', card: { building: '01', sub: 1 } },
    { key: 'b', name: 'B店', enabled: true, account: { username: 'b', displayName: 'B', passwordHash: hashPassword('x') }, roomPlanFile: 'rooms/b.json', removeMissingRooms: false, card: { building: '02', sub: 1 } },
  ],
}));

const db = require(path.join(ROOT, 'server', 'db'));
const registry = require(path.join(ROOT, 'server', 'stores', 'registry'));
const { withTx } = require(path.join(ROOT, 'server', 'tx'));
const { q, get, run, runWithStore } = db;

const results = [];
const check = (name, cond, extra = '') => results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);

// 1) 失效安全：无门店上下文必须抛错
let noCtx = false;
try { registry.getDb(); } catch (e) { noCtx = /NO_STORE_CONTEXT/.test(e.message); }
check('无门店上下文时拒绝访问数据库', noCtx);
let unknown = false;
runWithStore('nope', () => { try { registry.getDb(); } catch (e) { unknown = /UNKNOWN_STORE/.test(e.message); } });
check('访问未打开的门店抛错', unknown);

// 2) 隔离：两店房间互不可见
const count = (k) => runWithStore(k, () => get('SELECT COUNT(*) c FROM rooms').c);
// removed 模式下 A103 因有订单引用被保留，故 A 店仍为 3 间
const expectedA = MODE === 'removed' ? 3 : roomsA.length;
check('门店房间数隔离', count('a') === expectedA && count('b') === 2, `a=${count('a')} b=${count('b')}`);

// 3) 幂等：房号 id 稳定
const idInfo = (k) => runWithStore(k, () => get('SELECT MIN(id) mn, MAX(id) mx, COUNT(*) c, SUM(id) s FROM rooms').s);
const idA = idInfo('a');
const idB = idInfo('b');

// 4) 事务深度按店独立：B 店回滚不影响 A 店提交
if (MODE === 'first') {
  runWithStore('a', () => run("DELETE FROM settings WHERE key='tx_a'"));
  runWithStore('a', () => {
    withTx(() => {
      run("INSERT INTO settings (key,value) VALUES ('tx_a','1')");
      runWithStore('b', () => {
        try {
          withTx(() => {
            run("INSERT INTO settings (key,value) VALUES ('tx_b','1')");
            throw new Error('boom');
          });
        } catch { /* 预期回滚 */ }
      });
    });
  });
  const aHas = runWithStore('a', () => !!get("SELECT 1 x FROM settings WHERE key='tx_a'"));
  const bHas = runWithStore('b', () => !!get("SELECT 1 x FROM settings WHERE key='tx_b'"));
  check('交错事务：A 店提交', aHas);
  check('交错事务：B 店回滚', !bHas);
}

// 5) 夜审时间按店独立
runWithStore('a', () => run("INSERT INTO settings (key,value) VALUES ('night_audit_time','05:00') ON CONFLICT(key) DO UPDATE SET value='05:00'"));
runWithStore('b', () => run("INSERT INTO settings (key,value) VALUES ('night_audit_time','07:00') ON CONFLICT(key) DO UPDATE SET value='07:00'"));
const ta = runWithStore('a', () => get("SELECT value FROM settings WHERE key='night_audit_time'").value);
const tb = runWithStore('b', () => get("SELECT value FROM settings WHERE key='night_audit_time'").value);
check('夜审时间按店独立', ta === '05:00' && tb === '07:00', `a=${ta} b=${tb}`);

// 6) 造一张引用 A103 的订单（仅 first 模式）
if (MODE === 'first') {
  runWithStore('a', () => {
    const room = get("SELECT id FROM rooms WHERE room_no='A103'");
    const type = get("SELECT id FROM room_types WHERE name='标间'");
    const rid = Number(run(
      `INSERT INTO reservations (order_no, guest_name, room_type_id, room_id,
         check_in_date, check_out_date, nights, rate, total_amount, status)
       VALUES ('TESTORDER1','验证客',?,?, '2026-01-01','2026-01-03', 2, 100, 200, 'checked_in')`,
      type.id, room.id
    ).lastInsertRowid);
    run(
      'INSERT INTO reservation_rooms (reservation_id, room_id, room_type_id, status) VALUES (?,?,?,?)',
      rid, room.id, type.id, 'checked_in'
    );
  });
}

// 7) removed 模式：被订单引用的房间必须保留
if (MODE === 'removed') {
  const kept = runWithStore('a', () => get("SELECT COUNT(*) c FROM rooms WHERE room_no='A103'").c);
  const ordOk = runWithStore('a', () => get(
    `SELECT COUNT(*) c FROM reservations r JOIN rooms rm ON rm.id=r.room_id WHERE r.order_no='TESTORDER1'`
  ).c);
  check('配置移除但有订单引用的房间被保留', kept === 1);
  check('订单仍能关联到房间', ordOk === 1);
}

console.log(`--- MODE=${MODE} ---`);
console.log(results.join('\n'));
console.log(`roomIdSum a=${idA} b=${idB}`);
