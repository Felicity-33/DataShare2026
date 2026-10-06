// ============================================================
// browser-check.mjs —— 真实浏览器冒烟检查（SSR / build 都抓不到的坑）
// ------------------------------------------------------------
// 为什么需要它：
//   `npm run build` 通过 ≠ 能运行；`ssr-check.mjs`（Node 里 SSR 渲染）也抓不到
//   "浏览器专有问题" —— 因为 SSR 走 node 条件入口，浏览器走 browser 条件。
//   本项目真实案例：zk.js 顶层 import 了 circomlibjs，它需要 Node 的 Buffer，
//   浏览器里抛 `ReferenceError: Buffer is not defined` → **整页白屏**；
//   而 build 与 ssr-check **全部通过**。只有真实浏览器能发现。
//
// 实现：用 CDP（Chrome DevTools Protocol）驱动无头 Chrome，
//   能真正等待异步结果（普通 --dump-dom 在 load 事件后就 dump，等不到 async）。
//
// 用法：
//   node browser-check.mjs                                  # 检查首页
//   node browser-check.mjs http://localhost:5174/foo.html
//   node browser-check.mjs <url> --wait-text=ZK_PROBE_OK    # 等页面出现指定文本
//   node browser-check.mjs <url> --root=root --settle=3000
// 退出码非 0 表示有问题。
// ============================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const pick = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const URL_ = argv.find((a) => a.startsWith('http')) || 'http://localhost:5174/';
const WAIT_TEXT = pick('wait-text', '');
const ROOT_ID = pick('root', 'root');
const SETTLE_MS = Number(pick('settle', 3000));
// --modules=/src/a.jsx,/src/b.jsx —— 逐个动态 import，验证浏览器能否加载这些模块。
// 专治"导入期崩溃"：Node 专有 API 被打进浏览器时，模块一加载就抛错，
// 若该模块被 App 顶层引用，整个页面无法渲染。
const MODULES = pick('modules', '').split(',').map((x) => x.trim()).filter(Boolean);
const MAX_MS = Number(pick('timeout', 60000));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!chrome) {
  console.error('找不到 Chrome/Edge。可设置环境变量 CHROME_PATH 指向浏览器可执行文件。');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-browser-check-'));
const safeRm = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ } };

const fatal = [];
const externalized = [];
const missing = [];          // 404 资源（如 favicon 无害，真缺失要能看见）
const consoleCount = { n: 0 };

const FATAL_RE = /Uncaught|is not defined|is not a function|Cannot read propert|Cannot access|Failed to resolve|Failed to fetch|SyntaxError|ReferenceError|TypeError|Maximum call stack/;

console.log(`[browser-check] 浏览器: ${chrome}`);
console.log(`[browser-check] 地址  : ${URL_}`);

const child = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--remote-debugging-port=0',
  `--user-data-dir=${tmpDir}`,
  URL_,
], { stdio: 'ignore' });

const finish = (code, msg) => {
  try { child.kill(); } catch { /* ignore */ }
  safeRm(tmpDir);
  console.log('');
  console.log(msg);
  process.exit(code);
};

// ---- 1. 等 DevTools 端口就绪 ----
let port = 0;
const portFile = path.join(tmpDir, 'DevToolsActivePort');
for (let i = 0; i < 60; i++) {
  await sleep(250);
  if (fs.existsSync(portFile)) {
    const first = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0].trim();
    if (first) { port = Number(first); break; }
  }
  if (child.exitCode !== null) break;
}
if (!port) finish(2, '[browser-check] 无法连接浏览器（DevTools 端口未就绪）');

// ---- 2. 找到页面 target ----
let wsUrl = '';
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
  } catch { /* retry */ }
  await sleep(250);
}
if (!wsUrl) finish(2, '[browser-check] 找不到可用的页面 target');

// ---- 3. 连上 CDP，收集控制台与异常 ----
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')), { once: true });
  setTimeout(() => rej(new Error('WebSocket 连接超时')), 15000);
}).catch((e) => finish(2, '[browser-check] ' + e.message));

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  let msg; try { msg = JSON.parse(ev.data); } catch { return; }
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails || {};
    const txt = (d.exception && (d.exception.description || d.exception.value)) || d.text || '未知异常';
    fatal.push(String(txt).split('\n')[0]);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled') {
    consoleCount.n++;
    const txt = (msg.params.args || []).map((a) => (a.value !== undefined ? a.value : a.description)).join(' ');
    collect(txt, msg.params.type);
    return;
  }
  if (msg.method === 'Log.entryAdded') {
    const e = msg.params.entry;
    collect(e.text, e.level, e.url);
  }
});

function collect(txt, level, url) {
  if (!txt) return;
  if (/externalized for browser compatibility/.test(txt)) { externalized.push(txt); return; }
  // 资源 404 单独归类：favicon 之类的无害 404 不应判为失败，但要能看见
  if (/status of 404/.test(txt)) {
    const u = url || (txt.match(/https?:\/\/\S+/) || [])[0] || '(未知地址)';
    missing.push(u);
    return;
  }
  if (level === 'error' || FATAL_RE.test(txt)) fatal.push(String(txt).split('\n')[0]);
}

const call = (method, params = {}) => new Promise((res) => {
  const id = ++seq;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});

await call('Runtime.enable');
await call('Log.enable');

// ---- 4. 等待渲染 / 指定文本 ----
const started = Date.now();
let snapshot = { rootLen: -1, text: '' };
let textHit = false;

while (Date.now() - started < MAX_MS) {
  const r = await call('Runtime.evaluate', {
    expression: `(() => {
      const el = document.getElementById(${JSON.stringify(ROOT_ID)});
      const body = document.body;
      return JSON.stringify({
        rootLen: el ? el.innerHTML.length : -1,
        text: body ? (body.innerText || '').slice(0, 4000) : ''
      });
    })()`,
    returnByValue: true,
  });
  try { snapshot = JSON.parse(r.result.result.value); } catch { /* ignore */ }

  if (WAIT_TEXT) {
    if (new RegExp(WAIT_TEXT).test(snapshot.text)) { textHit = true; break; }
  } else if (snapshot.rootLen > 0 && Date.now() - started >= SETTLE_MS) {
    break;
  }
  await sleep(400);
}

// ---- 4b. 模块导入检查（可选）----
let moduleResults = [];
if (MODULES.length) {
  const expr = `(async () => {
    const list = ${JSON.stringify(MODULES)};
    const out = [];
    for (const m of list) {
      try {
        await import(new URL(m, location.origin).href);
        out.push({ m, ok: true });
      } catch (e) {
        out.push({ m, ok: false, err: String((e && e.message) || e).slice(0, 200) });
      }
    }
    return JSON.stringify(out);
  })()`;
  const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  try {
    moduleResults = JSON.parse(r.result.result.value);
  } catch {
    moduleResults = [];
    console.log('[browser-check] ⚠️ 模块检查的评估请求未返回结果，原始响应：');
    console.log('    ' + JSON.stringify(r).slice(0, 400));
  }
}

// ---- 5. 汇总 ----
console.log('');
console.log(`[browser-check] 控制台消息 ${consoleCount.n} 条，致命错误 ${fatal.length} 条`);
if (externalized.length) {
  console.log(`[browser-check] ⚠️ ${externalized.length} 条"模块被外部化"警告（Node 专有 API 被带进浏览器）：`);
  [...new Set(externalized)].slice(0, 6).forEach((l) => console.log('    - ' + l.slice(0, 150)));
}
if (missing.length) {
  console.log(`[browser-check] ⚠️ 有 ${missing.length} 个资源 404：`);
  [...new Set(missing)].slice(0, 8).forEach((l) => console.log('    - ' + String(l).slice(0, 200)));
}
if (fatal.length) {
  console.log('[browser-check] ❌ 致命错误：');
  [...new Set(fatal)].slice(0, 8).forEach((l) => console.log('    - ' + l.slice(0, 220)));
}
if (MODULES.length) {
  const bad = moduleResults.filter((r) => !r.ok);
  console.log(`[browser-check] 模块导入检查 ${moduleResults.length} 个，失败 ${bad.length} 个`);
  bad.forEach((b) => {
    console.log(`    - ❌ ${b.m} : ${String(b.err).slice(0, 180)}`);
    fatal.push(`模块导入失败 ${b.m}: ${b.err}`);
  });
  if (!bad.length) moduleResults.forEach((r) => console.log(`    - ✅ ${r.m}`));
}
console.log(`[browser-check] #${ROOT_ID} 渲染内容长度: ${snapshot.rootLen}`);
if (snapshot.rootLen > 0) {
  console.log(`[browser-check] 片段: ${snapshot.text.slice(0, 160).replace(/\s+/g, ' ')}`);
}

const rootOk = WAIT_TEXT ? true : snapshot.rootLen > 0;
const textOk = WAIT_TEXT ? textHit : true;
const pass = rootOk && textOk && fatal.length === 0;

const reason = [
  !rootOk ? `#${ROOT_ID} 是空的（React 未能挂载）` : '',
  !textOk ? `未等到文本 /${WAIT_TEXT}/（页面内容：${snapshot.text.slice(0, 200).replace(/\s+/g, ' ')}）` : '',
  fatal.length ? '存在致命控制台错误' : '',
].filter(Boolean).join('；');

finish(pass ? 0 : 1,
  pass
    ? '[browser-check] ✅ 通过：页面正常渲染，无致命错误'
    : '[browser-check] ❌ 未通过：' + reason);
