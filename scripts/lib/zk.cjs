// ============================================================
// scripts/lib/zk.cjs —— ZK 权属证明的共用工具（部署脚本 + 测试都走这一份）
// ------------------------------------------------------------
// 为什么放在 scripts/lib 而不是 test/：
//   deploy.js 也需要生成证明来给演示账号完成确权，两处各写一份容易漂移。
//   这里作为唯一实现，test/helpers/zk.js 只做一次转发。
//
// 证明在运行时现场生成（约 0.1-0.7s/次），因此不依赖任何硬编码的证明文件。
// ============================================================
const path = require('path');
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');
const hre = require('hardhat');

const WASM = path.join(__dirname, '../../frontend/public/zk/dataOwnership.wasm');
const ZKEY = path.join(__dirname, '../../frontend/public/zk/dataOwnership.zkey');

let poseidon = null;

async function initZk() {
  if (!poseidon) poseidon = await buildPoseidon();
  return poseidon;
}

/// 计算权属承诺：与 dataOwnership.circom 里的 Poseidon(2) 约束完全一致
async function commitmentOf(secret, ownerAddress) {
  const p = await initZk();
  return BigInt(p.F.toObject(p([BigInt(secret), BigInt(ownerAddress)])));
}

/// 生成一份可直接喂给 Solidity 验证器的 Groth16 证明
/// @dev pB 需要做一次 (x, y) 交换 —— 这是 snarkjs 导出验证器时的坐标约定
async function makeProof(secret, ownerAddress) {
  const p = await initZk();
  const owner = BigInt(ownerAddress);
  const commitment = BigInt(p.F.toObject(p([BigInt(secret), owner])));

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { secret: String(secret), commitment: String(commitment), owner: String(owner) },
    WASM, ZKEY,
  );

  return {
    commitment,
    secret,
    pA: [proof.pi_a[0], proof.pi_a[1]],
    pB: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    pC: [proof.pi_c[0], proof.pi_c[1]],
    pubSignals: [publicSignals[0], publicSignals[1]],
  };
}

/// 用一个账号 + 权属密钥完成一次「带 ZK 证明的确权」
/// @param dataRef 链下数据文件标识（链上索引）。为空表示暂未关联链下数据文件
async function registerFieldWithZk(contract, signer, name, secret, dataRef = '') {
  const pf = await makeProof(secret, await signer.getAddress());
  await (await contract.connect(signer)
    .registerField(name, dataRef, pf.pA, pf.pB, pf.pC, pf.pubSignals)).wait();
  pf.dataRef = dataRef;
  return pf;
}

/// 部署 Groth16 验证器 + DataShare（两地址构造参数）
async function deploySystem(platformTreasury) {
  const { ethers } = hre;
  const verifier = await (await ethers.getContractFactory('Groth16Verifier')).deploy();
  await verifier.waitForDeployment();
  const dv = await (await ethers.getContractFactory('DataShare')).deploy(
    platformTreasury, await verifier.getAddress(),
  );
  await dv.waitForDeployment();
  return { verifier, dv };
}

module.exports = { initZk, commitmentOf, makeProof, registerFieldWithZk, deploySystem, WASM, ZKEY };
