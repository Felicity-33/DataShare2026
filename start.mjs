#!/usr/bin/env node
/**
 * DataShare 一键启动（Windows / macOS / Linux 通用）
 * ------------------------------------------------------------
 * 用法（任选其一）：
 *   双击项目根目录的 start.bat
 *   npm start
 *   node start.mjs
 *
 * 它会依次做五件事，且**可重复执行**（已在运行的环节会自动跳过）：
 *   ① 确认 Ganache 本地链在跑（没跑就用项目依赖里的 ganache 启动，助记词与 hardhat.config.js 一致）
 *   ② 校验前端配置指向的合约在当前链上是否存在（链被重置过就会提醒你重新部署）
 *   ③ 启动前端 dev server（固定 5174 端口）
 *   ④ 打开浏览器
 *
 * 按 Ctrl+C 可一次性停掉它启动的所有进程。
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';


const require = createRequire(import.meta.url);

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.join(ROOT, 'frontend');
const RPC = 'http://127.0.0.1:7545';
const APP_URL = 'http://localhost:5174/';
// 必须与 hardhat.config.js 里的一致，否则派生出的账户和 MetaMask 里导入的对不上
const MNEMONIC = 'any ivory brain wild text hurt embrace arrow famous juice tower refuse';

const children = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);

/** 探测某个 http 地址是否有服务在监听 */
async function reachable(url, timeoutMs = 1500) {
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

/** 探测 Ganache 是否在出块（要求 JSON-RPC 正常响应，不只是端口开着） */
async function ganacheAlive() {
  try {
    const r = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: AbortSignal.timeout(2000),
    });
    const j = await r.json();
    return typeof j.result === 'string';
  } catch {
    return false;
  }
}

/** 读取前端 config.js 里的合约地址与期望版本 */
function readFrontendConfig() {
  const p = path.join(FRONTEND, 'src', 'config.js');
  const s = fs.readFileSync(p, 'utf8');
  const addr = s.match(/CONTRACT_ADDRESS\s*=\s*'([^']+)'/)?.[1];
  const ver = s.match(/EXPECTED_CONTRACT_VERSION\s*=\s*'([^']+)'/)?.[1];
  return { addr, ver };
}

/** 调链上 CONTRACT_VERSION 校验前端指向的合约是否真的存在于当前链上 */
async function checkContractOnChain(addr) {
  // CONTRACT_VERSION() 的函数选择器
  const { ethers } = await import('ethers');
  const provider = new ethers.JsonRpcProvider(RPC);
  const c = new ethers.Contract(addr, ['function CONTRACT_VERSION() view returns (string)'], provider);
  try {
    return await c.CONTRACT_VERSION();
  } catch {
    return null;
  }
}

function openBrowser(url) {
  const cmd = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  } catch { /* 打不开就算了，把地址打出来即可 */ }
}

/** 启动一个会跟随主进程一起退出的子进程 */
function startChild(label, command, args, opts = {}) {
  log(`   → 启动 ${label}：${command} ${args.join(' ')}`);
  const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', shell: false, ...opts });
  child.on('error', (e) => log(`   ⚠️ ${label} 启动失败：${e.message}`));
  children.push({ label, child });
  return child;
}

/** 解析项目内可执行文件路径（Windows 上是 .cmd） */
function binPath(name) {
  const base = path.join(ROOT, 'node_modules', '.bin', name);
  return process.platform === 'win32' ? `${base}.cmd` : base;
}

async function main() {
  log('==================== DataShare 启动中 ====================');

  // ---------- ① Ganache ----------
  if (await ganacheAlive()) {
    log('① Ganache 已在运行 —— 跳过');
  } else {
    log('① Ganache 未运行，正在启动本地链 ...');
    startChild('Ganache', binPath('ganache'), ['-m', MNEMONIC, '-p', '7545', '--chain.chainId', '1337']);
    let ok = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      if (await ganacheAlive()) { ok = true; break; }
    }
    if (!ok) {
      log('   ❌ Ganache 启动超时。请手动跑一次 `npx ganache -m "' + MNEMONIC + '" -p 7545` 看看报错。');
      process.exit(1);
    }
    log('   ✅ Ganache 已就绪');
  }

  // ---------- ② 校验前端指向的合约 ----------
  const { addr, ver } = readFrontendConfig();
  log(`② 前端配置：合约 ${addr}（期望版本 ${ver}）`);
  const onChainVer = await checkContractOnChain(addr);
  if (onChainVer === null) {
    log('   ⚠️  当前链上找不到这个合约 —— 通常是 Ganache 被重置过（换链了）。');
    log('      请先重新部署并更新前端地址：');
    log('        1) npm run deploy');
    log('        2) 把输出里的合约地址填到 frontend/src/config.js 的 CONTRACT_ADDRESS');
    log('      界面仍会打开，但读不到数据。');
  } else if (onChainVer !== ver) {
    log(`   ⚠️  版本不一致：链上是 ${onChainVer}，前端期望 ${ver} —— ABI 可能对不上，界面会异常。`);
  } else {
    log(`   ✅ 链上版本 ${onChainVer} 与前端一致`);
  }

  // ---------- ③ 前端 dev server ----------
  if (await reachable(APP_URL)) {
    log('③ 前端已在运行 —— 跳过');
  } else {
    log('③ 正在启动前端 dev server（端口 5174）...');
    startChild('Vite', 'npm', ['run', 'dev'], { cwd: FRONTEND, shell: process.platform === 'win32' });
    let ok = false;
    for (let i = 0; i < 30; i++) {
      await sleep(1000);
      if (await reachable(APP_URL)) { ok = true; break; }
    }
    if (!ok) {
      log('   ❌ 前端启动超时。请到 frontend 目录手动跑 `npm run dev` 看报错。');
      process.exit(1);
    }
    log('   ✅ 前端已就绪');
  }

  // ---------- ④ 打开浏览器 ----------
  log('④ 打开浏览器 ...');
  openBrowser(APP_URL);

  log('');
  log('==================== 启动完成 ====================');
  log(`  界面地址：   ${APP_URL}`);
  log('  MetaMask：   需要切到本地网络 http://127.0.0.1:7545 / ChainID 1337');
  log('  停止服务：   在本窗口按 Ctrl+C');
  log('');
}

main().catch((e) => { console.error('启动失败:', e); process.exit(1); });

// Ctrl+C 时把启动的子进程一起收掉，避免端口被占着
process.on('SIGINT', () => {
  log('\n正在停止服务 ...');
  for (const { label, child } of children) {
    try { child.kill(); log(`   已停止 ${label}`); } catch { /* 忽略 */ }
  }
  process.exit(0);
});
