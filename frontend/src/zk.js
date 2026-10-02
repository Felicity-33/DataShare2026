// ============================================================
// zk.js —— 浏览器端生成「数据权属证明」（仅用于确权阶段）
// ------------------------------------------------------------
// 与 circuits/dataOwnership.circom 配套：
//   私有输入 secret        —— 权属密钥，只在本地生成与保存，**永远不上链**
//   公开输入 commitment    —— Poseidon(secret, owner)，链上存证
//   公开输入 owner         —— 提交者地址，合约会校验它等于 msg.sender
//
// 为什么要证明：
//   确权时必须让合约确认"提交者确实掌握该数据的权属密钥"，
//   但若把密钥明文提交上链就等于把钥匙公开。ZK 证明让合约在不看到密钥的前提下完成校验。
//
// 证明产物（wasm / zkey）放在 public/zk/，由 npm run build:zk 生成。
// 确权之后不再需要生成任何证明（申请、授权、调用都不涉及 ZK）。
//
// ★★ 两个必须遵守的工程约束（踩过坑，别改回去）★★
//  1) **不要 import circomlibjs**。它依赖 Node 的 Buffer / events / util，
//     浏览器里会抛 `ReferenceError: Buffer is not defined`；而这个文件被 App 顶层引入，
//     一旦报错就导致**整页白屏**（React 根本挂载不了）。
//     Poseidon 改用 poseidon-lite：纯 JS、零 Node 依赖，且与 circomlibjs 结果**逐位一致**
//     （校验脚本 frontend/poseidon-check.mjs，两者输出完全相同）。
//  2) **snarkjs 按需动态加载**（click 时才 import）。它体积近 1MB，
//     且静态引入会让"证明库的问题"升级为"整个页面打不开"。动态加载把风险限制在确权这一步。
// ============================================================
import { poseidon2 } from 'poseidon-lite';

const WASM_URL = '/zk/dataOwnership.wasm';
const ZKEY_URL = '/zk/dataOwnership.zkey';
const SECRET_PREFIX = 'datashare.zk.secret.';

/// 计算权属承诺：Poseidon(secret, owner)
/// 与电路里的约束完全一致（已逐位校验），且与链上 commitment 字段同源。
export function commitmentOf(secret, ownerAddress) {
  return poseidon2([BigInt(secret), BigInt(ownerAddress)]);
}

/// 取得（或首次生成）当前账户的权属密钥。
/// 保存在浏览器 localStorage，按账户地址隔离；只在本机，不上链、不离开浏览器。
export function getOwnershipSecret(account) {
  const key = SECRET_PREFIX + String(account).toLowerCase();
  let v = localStorage.getItem(key);
  if (v) return v;

  // 生成 31 字节随机数（小于 bn128 标量域，作为 field 元素是安全的）
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let s = 0n;
  for (const b of bytes) s = (s << 8n) | BigInt(b);
  v = s.toString();
  localStorage.setItem(key, v);
  return v;
}

// ---- snarkjs 按需加载（首次点击确权时才拉取，失败可重试）----
let groth16Promise = null;

async function getGroth16() {
  if (!groth16Promise) {
    groth16Promise = import('snarkjs')
      .then((m) => m.groth16 || (m.default && m.default.groth16))
      .catch((e) => {
        groth16Promise = null;   // 允许下次重试
        throw new Error('证明库加载失败，请检查网络后重试：' + (e && e.message ? e.message : e));
      });
    const g = await groth16Promise;
    if (!g) {
      groth16Promise = null;
      throw new Error('证明库加载异常（未找到 groth16）');
    }
  }
  return groth16Promise;
}

/// 生成一份可直接喂给合约 registerField 的 Groth16 证明
/// @returns {Promise<{commitment:bigint, pA:any[], pB:any[][], pC:any[], pubSignals:string[]}>}
/// @dev pB 要做一次 (x, y) 交换 —— 这是 snarkjs 导出验证器时的坐标约定
export async function makeOwnershipProof(secret, ownerAddress) {
  const owner = BigInt(ownerAddress);
  const commitment = commitmentOf(secret, owner);

  const groth16 = await getGroth16();
  const { proof, publicSignals } = await groth16.fullProve(
    {
      secret: String(secret),
      commitment: String(commitment),
      owner: String(owner),
    },
    WASM_URL,
    ZKEY_URL,
  );

  return {
    commitment,
    pA: [proof.pi_a[0], proof.pi_a[1]],
    pB: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    pC: [proof.pi_c[0], proof.pi_c[1]],
    pubSignals: [publicSignals[0], publicSignals[1]],
  };
}
