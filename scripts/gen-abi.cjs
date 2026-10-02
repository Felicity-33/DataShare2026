// ============================================================
// gen-abi.cjs —— 从编译产物自动生成前端 ABI
// ------------------------------------------------------------
// 用法：node scripts/gen-abi.cjs
//
// 为什么需要它：
//   前端 ABI 原先是**手写**在 frontend/src/config.js 里的，一旦和链上合约不一致，
//   ethers 不一定会报错，而是**静默错解返回值**（例如把 string 的长度当成 uint256），
//   界面看起来完全正常但数字全错 —— 这个项目已经踩过一次。
//   改成从 artifacts 自动生成后，只要合约编译过，ABI 就永远是对的。
//
// 注意：改完合约后要「先编译、再生成」：
//   npm run compile && node scripts/gen-abi.cjs
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ARTIFACT = path.join(ROOT, 'artifacts/contracts/DataShare.sol/DataShare.json');
const CONFIG = path.join(ROOT, 'frontend/src/config.js');

function main() {
  if (!fs.existsSync(ARTIFACT)) {
    console.error('❌ 找不到编译产物：', ARTIFACT);
    console.error('   请先运行：npm run compile');
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(ARTIFACT, 'utf8'));
  const abi = artifact.abi;

  const fns = abi.filter((e) => e.type === 'function').sort((a, b) => a.name.localeCompare(b.name));
  const evs = abi.filter((e) => e.type === 'event').sort((a, b) => a.name.localeCompare(b.name));
  const rest = abi.filter((e) => !['function', 'event'].includes(e.type));

  if (fns.length === 0) {
    console.error('❌ 编译产物里没有函数条目，ABI 可能不完整。');
    process.exit(1);
  }

  // 紧凑 JSON 稍微加点空格，读起来舒服些（ABI 里没有含逗号/冒号的字符串，替换是安全的）
  const clean = (o) => JSON.stringify(o).replace(/,/g, ', ').replace(/:/g, ': ');

  // ⚠️ 条目之间必须有逗号：用 join('，\n') 统一拼接，避免漏逗号导致语法错误
  const body = [];
  body.push(`  // ---------- 函数（${fns.length} 个）----------`);
  for (const e of fns) body.push('  ' + clean(e));
  body.push(`  // ---------- 事件（${evs.length} 个）----------`);
  for (const e of evs) body.push('  ' + clean(e));
  if (rest.length) {
    body.push(`  // ---------- 其他（${rest.length} 个）----------`);
    for (const e of rest) body.push('  ' + clean(e));
  }

  const block = [
    'export const DataShareABI = [',
    '  // ★ 本 ABI 由编译产物 artifacts/contracts/DataShare.sol/DataShare.json 自动生成，',
    '  //   请勿手工维护。手写 ABI 与链上合约不一致时，ethers 会静默错解返回值（界面正常但数据全错）。',
    '  //   重新生成：npm run compile && node scripts/gen-abi.cjs',
    body.join(',\n'),
    '];',
  ].join('\n');

  const src = fs.readFileSync(CONFIG, 'utf8');
  const start = src.indexOf('export const DataShareABI = [');
  if (start < 0) {
    console.error('❌ 在 config.js 里找不到 DataShareABI 定义。');
    process.exit(1);
  }
  const endMark = '\n];';
  const end = src.indexOf(endMark, start);
  if (end < 0) {
    console.error('❌ 找不到 DataShareABI 的结束标记。');
    process.exit(1);
  }

  const out = src.slice(0, start) + block + src.slice(end + endMark.length);
  fs.writeFileSync(CONFIG, out, 'utf8');

  console.log('✅ 已更新 frontend/src/config.js');
  console.log(`   函数 ${fns.length} 个 / 事件 ${evs.length} 个 / 其他 ${rest.length} 个`);
  console.log('   合约版本:', artifact.abi.find((e) => e.name === 'CONTRACT_VERSION') ? '(常量可查)' : '—');
  console.log('   ⚠️ 记得核对 frontend/src/config.js 的 EXPECTED_CONTRACT_VERSION 是否与链上一致');
}

main();
