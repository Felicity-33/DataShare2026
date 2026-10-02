// 一致性校验：poseidon-lite（浏览器用）与 circomlibjs（电路编译参考实现）
// 必须逐位相同，否则生成的证明会被链上验证器拒绝。
import { buildPoseidon } from 'circomlibjs';
import { poseidon2 } from 'poseidon-lite';

const poseidon = await buildPoseidon();
const F = poseidon.F;

const cases = [
  ['12345678901234567890', '0xC18Eaf51C2a514Ca41a823B550470E8F6Ef16588'],
  ['1000001', '0x49f880A668C62C9390Ea0E1e36cC6637A50ba3F9'],
  ['98765432109876543210987', '0x0000000000000000000000000000000000000001'],
  ['1', '0x0000000000000000000000000000000000000000'],
  ['21888242871839275222246405745257275088548364400416034343698204186575808495616',
   '0xffffffffffffffffffffffffffffffffffffffff'],
];

let allOk = true;
for (const [s, addr] of cases) {
  const a = BigInt(s);
  const b = BigInt(addr);
  const ref = BigInt(F.toObject(poseidon([a, b])));
  const got = poseidon2([a, b]);
  const ok = ref === got;
  allOk = allOk && ok;
  console.log(`${ok ? 'PASS' : 'FAIL'}  secret=${s.slice(0, 14)}  owner=${addr.slice(0, 12)}`);
  console.log(`        circomlibjs   ${ref.toString().slice(0, 46)}`);
  console.log(`        poseidon-lite ${got.toString().slice(0, 46)}`);
}

console.log('');
console.log(allOk
  ? '结论：两者完全一致 —— 可安全替换为 poseidon-lite'
  : '结论：不一致！不能替换');
process.exit(allOk ? 0 : 1);
