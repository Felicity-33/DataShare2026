// ============================================================
// build-zk.cjs —— ZK 确权链路一键构建（可重复运行、幂等）
// ------------------------------------------------------------
// 运行： node scripts/build-zk.cjs
//
// 为什么要这个脚本：
//   Circom 官方编译器需要 Rust 工具链（本机没有），因此改用 circom2（WASM 版 circom），
//   它不需要 Rust，但**它的 CLI 在 Windows 上会把路径参数过一遍 path.relative()**，
//   返回的是反斜杠（circuits\build），WASM 沙箱解析不了 → 报 "Could not write the output"。
//   所以这里不走 CLI，改用 circom2 的程序化 API，并自己传正斜杠路径。
//
// 产物：
//   circuits/build/            r1cs / sym / wasm（可重建）
//   circuits/ptau/             本地生成的 powers of tau
//   circuits/keys/             proving key (zkey) + verification key
//   contracts/ZkVerifier.sol   由 snarkjs 导出的 Groth16 验证器合约
//   frontend/public/zk/        前端生成证明所需的 wasm + zkey
//
// ⚠️ 安全声明（必须如实告知，别对评委说这是生产级）：
//   powers of tau 与最终 zkey 都是**本机单方生成**的，熵可控、没有多方可信设置。
//   演示足够；生产环境必须使用公开的多方计算（MPC）ceremony 产物。
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { CircomRunner, bindings } = require('circom2');

const ROOT = path.resolve(__dirname, '..');
const CIRCUIT = 'circuits/dataOwnership.circom';
const NAME = 'dataOwnership';
const PTAU_POWER = 10;                       // 2^10 = 1024，够本电路（517 个约束）用
const BUILD_DIR = 'circuits/build';
const PTAU_DIR = 'circuits/ptau';
const KEY_DIR = 'circuits/keys';
const SNARKJS = path.join(ROOT, 'node_modules/snarkjs/build/cli.cjs');

const rel = (p) => path.join(ROOT, p).replace(/\\/g, '/');
const log = (m) => console.log(m);

// snarkjs 用 node 直接跑 cli.cjs，避免 Windows 下 npx / .cmd 的兼容问题
function snarkjs(args, label) {
  log(`   → snarkjs ${label}`);
  execFileSync(process.execPath, [SNARKJS, ...args], { cwd: ROOT, stdio: 'inherit' });
}

async function compileCircuit() {
  const outDir = rel(BUILD_DIR);
  fs.mkdirSync(path.join(ROOT, BUILD_DIR), { recursive: true });

  const runner = new CircomRunner({
    args: [
      CIRCUIT, '--r1cs', '--wasm', '--sym',
      '-l', 'node_modules',
      '-o', outDir,
    ],
    env: process.env,
    preopens: { '.': '.' },
    bindings: {
      ...bindings,
      fs,
      exit(code) { if (code !== 0) throw new Error(`circom 退出码 ${code}`); },
      kill() { throw new Error('circom 进程被终止'); },
    },
  });

  const wasmBytes = fs.readFileSync(require.resolve('circom2/circom.wasm'));
  await runner.execute(wasmBytes);
}

function main() {
  fs.mkdirSync(path.join(ROOT, BUILD_DIR), { recursive: true });
  fs.mkdirSync(path.join(ROOT, PTAU_DIR), { recursive: true });
  fs.mkdirSync(path.join(ROOT, KEY_DIR), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'frontend/public/zk'), { recursive: true });

  // ---------- 1. 编译电路 ----------
  const r1cs = rel(`${BUILD_DIR}/${NAME}.r1cs`);
  if (fs.existsSync(r1cs)) {
    log('① 电路已编译，跳过（如需重编请先删除 circuits/build）');
  } else {
    log('① 编译电路（circom2 / WASM）...');
    compileCircuit().then(afterCompile).catch((e) => { console.error('编译失败:', e.message); process.exit(1); });
    return;
  }
  afterCompile();
}

function afterCompile() {
  const r1cs = rel(`${BUILD_DIR}/${NAME}.r1cs`);

  // ---------- 2. powers of tau（本地生成，无需下载） ----------
  const ptau0 = rel(`${PTAU_DIR}/pot${PTAU_POWER}_0.ptau`);
  const ptau1 = rel(`${PTAU_DIR}/pot${PTAU_POWER}_1.ptau`);
  const ptauFinal = rel(`${PTAU_DIR}/pot${PTAU_POWER}_final.ptau`);

  if (fs.existsSync(path.join(ROOT, ptauFinal))) {
    log('② powers of tau 已存在，跳过');
  } else {
    log('② 生成 powers of tau（本地 ceremony，仅用于演示）...');
    log(`   → powersoftau new bn128 ${PTAU_POWER}`);
    snarkjs(['powersoftau', 'new', 'bn128', String(PTAU_POWER), ptau0], 'new');
    snarkjs(['powersoftau', 'contribute', ptau0, ptau1,
      '--name=DataShare demo contributor',
      '-e=datashare-demo-entropy-please-do-not-use-in-production'], 'contribute');
    snarkjs(['powersoftau', 'prepare', 'phase2', ptau1, ptauFinal], 'prepare phase2');
  }

  // ---------- 3. Groth16 setup + 贡献熵 ----------
  const zkey0 = rel(`${KEY_DIR}/${NAME}_0.zkey`);
  const zkey = rel(`${KEY_DIR}/${NAME}.zkey`);
  const vk = rel(`${KEY_DIR}/verification_key.json`);

  if (fs.existsSync(path.join(ROOT, `${KEY_DIR}/${NAME}.zkey`))) {
    log('③ proving key 已存在，跳过');
  } else {
    log('③ Groth16 setup ...');
    snarkjs(['groth16', 'setup', r1cs, ptauFinal, zkey0], 'groth16 setup');
    snarkjs(['zkey', 'contribute', zkey0, zkey,
      '--name=DataShare demo',
      '-e=datashare-demo-zkey-entropy'], 'zkey contribute');
    fs.rmSync(path.join(ROOT, `${KEY_DIR}/${NAME}_0.zkey`), { force: true });
    snarkjs(['zkey', 'export', 'verificationkey', zkey, vk], 'export verificationkey');
  }

  // ---------- 4. 导出 Solidity 验证器 ----------
  const verifier = rel('contracts/ZkVerifier.sol');
  if (fs.existsSync(path.join(ROOT, 'contracts/ZkVerifier.sol'))) {
    log('④ 验证器合约已存在，跳过（如需重生成请先删除 contracts/ZkVerifier.sol）');
  } else {
    log('④ 导出 Solidity 验证器合约 ...');
    snarkjs(['zkey', 'export', 'solidityverifier', zkey, verifier], 'export solidityverifier');
  }

  // ---------- 5. 拷贝前端产物 ----------
  log('⑤ 拷贝前端产物到 frontend/public/zk/ ...');
  const wasmSrc = path.join(ROOT, `${BUILD_DIR}/${NAME}_js/${NAME}.wasm`);
  fs.copyFileSync(wasmSrc, path.join(ROOT, `frontend/public/zk/${NAME}.wasm`));
  fs.copyFileSync(path.join(ROOT, `${KEY_DIR}/${NAME}.zkey`), path.join(ROOT, `frontend/public/zk/${NAME}.zkey`));
  fs.copyFileSync(path.join(ROOT, `${KEY_DIR}/verification_key.json`), path.join(ROOT, 'frontend/public/zk/verification_key.json'));

  log('');
  log('==================== ZK 链路构建完成 ====================');
  for (const f of [
    `contracts/ZkVerifier.sol`,
    `${KEY_DIR}/${NAME}.zkey`,
    `${KEY_DIR}/verification_key.json`,
    `frontend/public/zk/${NAME}.wasm`,
    `frontend/public/zk/${NAME}.zkey`,
  ]) {
    const st = fs.statSync(path.join(ROOT, f));
    log(`  ${f}  (${(st.size / 1024).toFixed(1)} KB)`);
  }
}

main();
