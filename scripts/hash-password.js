// 生成账号密码哈希，粘贴到 config/stores.json 的 account.passwordHash 字段
// 用法：npm run hash-password -- <密码>
const { hashPassword } = require('../server/auth/session');

const password = process.argv.slice(2).join(' ');
if (!password) {
  console.error('用法: npm run hash-password -- <密码>');
  process.exit(1);
}
console.log(hashPassword(password));
