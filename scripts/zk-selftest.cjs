// ============================================================
// zk-selftest.cjs —— ZK 确权链路自检（生成证明 → 本地验证 → 输出上链 calldata）
// ------------------------------------------------------------
// 运行： node scripts/zk-selftest.cjs
//
// 作用：
//   1. 用 Poseidon(secret, owner) 算出承诺 commitment（与电路里的约束一致）
//   2. 用 wasm + zkey 生成 Groth16 证明
//   3. 本地验证证明有效性
//   4. 反向用例：篡改公开信号后验证必须失败（证明「证明确实与承诺绑定」）
//   5. 打印可直接喂给合约 verifyProof 的 calldata
// 用途：改电路 / 换 zkey 后跑一次，确认整条链路没断。
// ============================================================
const fs = require('fs');
const path = require('path');
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');

const ROOT = path.resolve(__dirname, '..');
const WASM = path.join(ROOT, 'frontend/public/zk/dataOwnership.wasm');
const ZKEY = path.join(ROOT, 'frontend/public/zk/dataOwnership.zkey');
// 验证密钥：优先取 frontend/public/zk 下的副本。
// 交付包会排除 circuits/keys（中间产物，可用 build:zk 重算），
// 但 frontend/public/zk 是运行时依赖、必然随包交付 —— 先试它，跑得更稳。
const VK = [
  path.join(ROOT, 'frontend/public/zk/verification_key.json'),
  path.join(ROOT, 'circuits/keys/verification_key.json'),
].find((p) => fs.existsSync(p));
if (!VK) {
  console.error('❌ 找不到 verification_key.json，请先执行 `npm run build:zk` 生成 ZK 产物。');
  process.exit(1);
}

(async () => {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  // —— 1. 构造权属承诺 ——
  const secret = 98765432109876543210n;                       // 私有：只有数据所有者知道
  const owner = BigInt('0x49f880A668C62C9390Ea0E1e36cC6637A50ba3F9'); // 公开：提交者地址
  const commitment = BigInt(F.toObject(poseidon([secret, owner])));   // 公开：链上存证
  console.log('① 权属承诺');
  console.log('   secret（私有，不上链）:', secret.toString());
  console.log('   owner （公开，合约校验 == msg.sender）:', '0x' + owner.toString(16));
  console.log('   commitment（公开，上链存证）:', commitment.toString());

  // —— 2. 生成证明 ——
  console.log('\n② 生成 Groth16 证明 ...');
  const t0 = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { secret: secret.toString(), commitment: commitment.toString(), owner: owner.toString() },
    WASM, ZKEY,
  );
  const ms = Date.now() - t0;
  console.log(`   证明生成耗时 ${ms} ms（浏览器端量级相当）`);
  console.log('   公开信号 publicSignals =', publicSignals);

  // —— 3. 本地验证 ——
  const vk = JSON.parse(fs.readFileSync(VK, 'utf8'));
  const ok = await snarkjs.groth16.verify(vk, publicSignals, proof);
  console.log('\n③ 本地验证:', ok ? '✅ 通过' : '❌ 失败');

  // —— 4. 反例：篡改公开信号必须验证失败 ——
  const tampered = [...publicSignals];
  tampered[0] = (BigInt(tampered[0]) + 1n).toString();
  const badOk = await snarkjs.groth16.verify(vk, tampered, proof);
  console.log('④ 反例（篡改 commitment）:', badOk ? '❌ 竟然通过了（严重问题）' : '✅ 正确拒绝');

  // —— 5. 上链 calldata ——
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  console.log('\n⑤ 可直接喂给合约 verifyProof 的 calldata:');
  console.log(calldata);

  const pass = ok && !badOk;
  console.log(`\n==================== 自检${pass ? '通过' : '失败'} ====================`);
  // snarkjs / circomlibjs 会残留 wasm 相关的句柄，显式收尾避免进程挂起或异常退出码
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('自检失败:', e); process.exit(1); });
