// ============================================================
// e2e-check.mjs —— 真实浏览器端到端巡检（三个角色 × 全部导航页）
// ------------------------------------------------------------
// 为什么需要它：
//   JSX 引用了未声明 / 未导入的组件时，构建仍会通过，但页面渲染期
//   抛出 ReferenceError → React 卸载整棵树 → 页面无法显示。
//   静态构建与模块加载类检查均无法覆盖这类「渲染期才暴露」的缺陷，
//   唯一可靠的办法：真实浏览器里逐页点开验证。
//
// 本脚本用 CDP 驱动无头 Chrome，并注入一个把 JSON-RPC 转发到本地 Ganache 的
// EIP-1193 钱包代理（无需安装 MetaMask），因此可以：
//   连接钱包 → 按链上角色进入工作台 → 逐个点开每个导航页
//   每一步都记录：未捕获异常数 / console.error / #root 内容长度
// 只要某个页面抛异常或把 #root 渲染成空，即判失败。
//
// 前置条件：Ganache(7545) 与前端 devServer(5174) 已在运行（见 start.bat）。
// 用法：cd frontend && node e2e-check.mjs
//      node e2e-check.mjs --only=regulator        # 只跑一个角色
//      node e2e-check.mjs --shot=regulator:2      # 顺带截图第 2 个导航页
// 退出码 0 = 全部通过；非 0 = 有页面抛异常或白屏。
// ============================================================
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const APP = 'http://localhost:5174/';
const GANACHE = 'http://127.0.0.1:7545';

// 三个角色 → Ganache 账户索引（与 scripts/deploy.js 的 getSigners 顺序一致）
// 顺序：0=deployer 1=user 2=enterprise 3=regulator
const ROLES = {
  user: { index: 1, navs: ['概览', '我的数据', '授权申请', '托管结算', '收益流水', '取用凭证'] },
  enterprise: { index: 2, navs: ['概览', '充值押金', '数据市场', '托管结算', '调用记录'] },
  regulator: { index: 3, navs: ['全局概览', '凭证审计', '审计日志', '争议裁决', '异常监控'] },
};

const argv = process.argv.slice(2);
const arg = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const ONLY = arg('only', '');
const SHOT = arg('shot', '');            // 形如 regulator:2
const [SHOT_ROLE, SHOT_NAV] = SHOT ? SHOT.split(':') : ['', '-1'];

const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].filter(Boolean).find((p) => { try { return fs.existsSync(p); } catch { return false; } });

if (!CHROME) {
  console.error('[e2e-check] 找不到 Chrome/Edge。可设置环境变量 CHROME_PATH。');
  process.exit(2);
}

const OUT_DIR = path.join(os.tmpdir(), 'datashare-e2e');
fs.mkdirSync(OUT_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rpc = async (method, params = []) => {
  const r = await fetch(GANACHE, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};

// ------------------------------------------------------------
// 跑一个角色：起浏览器 → 连钱包 → 点遍导航页
// ------------------------------------------------------------
async function runRole(roleKey) {
  const { index, navs } = ROLES[roleKey];
  const log = [];
  const say = (s) => { log.push(s); console.log(s); };

  let accounts;
  try { accounts = await rpc('eth_accounts'); } catch (e) {
    say(`❌ 连不上 Ganache(${GANACHE})：${e.message}`);
    return { ok: false, log };
  }
  const ACCOUNT = String(accounts[index] || '').toLowerCase();
  if (!ACCOUNT) { say(`❌ Ganache 账户不足，取不到 index=${index}`); return { ok: false, log }; }

  say(`\n══════ 角色 ${roleKey}（账户 #${index} ${ACCOUNT}）══════`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `dv-e2e-${roleKey}-`));
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--remote-debugging-port=0', `--user-data-dir=${tmp}`, 'about:blank',
  ], { stdio: 'ignore' });

  const cleanup = () => {
    try { child.kill(); } catch { /* ignore */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  try {
    // ---- 等 DevTools 端口 ----
    let port = 0;
    const portFile = path.join(tmp, 'DevToolsActivePort');
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      if (fs.existsSync(portFile)) {
        const p = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0].trim();
        if (p) { port = Number(p); break; }
      }
      if (child.exitCode !== null) break;
    }
    if (!port) { say('❌ DevTools 端口未就绪'); cleanup(); return { ok: false, log }; }

    let wsUrl = '';
    for (let i = 0; i < 80; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
      } catch { /* retry */ }
      await sleep(250);
    }
    if (!wsUrl) { say('❌ 找不到页面 target'); cleanup(); return { ok: false, log }; }

    // ---- 连 CDP ----
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')), { once: true });
      setTimeout(() => rej(new Error('WebSocket 连接超时')), 15000);
    }).catch((e) => { say('❌ ' + e.message); });

    let seq = 0;
    const pending = new Map();
    const exceptions = [];
    const consoleErrors = [];
    let phase = 'boot';

    ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails || {};
        const t = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'unknown';
        exceptions.push(`[${phase}] ${String(t).split('\n')[0]}`);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        consoleErrors.push(`[${phase}] ${(m.params.args || []).map((a) => a.value ?? a.description).join(' ').slice(0, 220)}`);
      }
    });

    const call = (method, params = {}) => new Promise((res) => {
      const id = ++seq; pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evalJs = async (expr) => {
      const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true });
      return r?.result?.result?.value;
    };
    const rootLen = () => evalJs(`(() => { const e = document.getElementById('root'); return e ? e.innerHTML.length : -1; })()`);
    const bodyText = () => evalJs(`document.body ? document.body.innerText : ''`);
    const clickByText = (txt) => evalJs(`(() => {
      const all = [...document.querySelectorAll('button, a, [role="button"]')].filter(el => el.offsetParent !== null);
      let hit = all.find(el => (el.innerText||'').trim() === ${JSON.stringify(txt)});
      if (!hit) hit = all.find(el => (el.innerText||'').trim().includes(${JSON.stringify(txt)}));
      // ★ v5.1 兜底：侧栏手动收起后导航按钮只保留图标 + title 提示，
      //   文字匹配不到时按 title 精确匹配（如「概览」按钮收起后 title=概览）
      if (!hit) hit = all.find(el => (el.title||'').trim() === ${JSON.stringify(txt)});
      if (!hit) return 'NOT_FOUND';
      hit.click(); return 'OK';
    })()`);

    await call('Page.enable');
    await call('Runtime.enable');

    // ---- 注入钱包代理（务必在页面脚本之前）----
    const shim = `(() => {
      const GANACHE = ${JSON.stringify(GANACHE)};
      const ACC = ${JSON.stringify(ACCOUNT)};
      let id = 0;
      const raw = (method, params) => fetch(GANACHE, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params: params || [] }),
      }).then(r => r.json()).then(j => {
        if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; }
        return j.result;
      });
      const request = ({ method, params }) => {
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return Promise.resolve([ACC]);
        if (method === 'eth_chainId') return Promise.resolve('0x539');
        if (method === 'net_version') return Promise.resolve('1337');
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return Promise.resolve(null);
        if (method === 'wallet_requestPermissions') return Promise.resolve([{ parentCapability: 'eth_accounts' }]);
        return raw(method, params);
      };
      window.ethereum = {
        isMetaMask: true, _metamask: { isUnlocked: () => Promise.resolve(true) },
        request, on() {}, off() {}, once() {}, addListener() {}, removeListener() {},
        send(m, p) { return (typeof m === 'string') ? request({ method: m, params: p }) : request(m); },
        sendAsync(p, cb) { request(p).then(r => cb(null, { result: r })).catch(e => cb(e)); },
      };
    })();`;
    await call('Page.addScriptToEvaluateOnNewDocument', { source: shim });

    // ---- 加载首页 ----
    phase = 'load';
    await call('Page.navigate', { url: APP });
    for (let i = 0; i < 40; i++) { await sleep(500); if ((await rootLen()) > 500) break; }
    say(`  首页 #root=${await rootLen()}`);

    // ---- 连接钱包（头部「登录 / 注册」→ 模态框「连接钱包」）----
    phase = 'connect';
    let r = await clickByText('登录 / 注册');
    await sleep(800);
    let r2 = await clickByText('连接钱包');
    say(`  连接钱包：头部=${r} 模态框=${r2}`);
    for (let i = 0; i < 40; i++) {
      await sleep(700);
      // ★ v5.1 侧栏为完全手动控制（默认展开，导航文字始终可见），无需再注入展开操作
      const t = String(await bodyText());
      if (t.includes(navs[0]) && t.includes('设置')) break;
    }

    // ---- 逐个点导航页 ----
    const marks = [];
    const record = async (label) => {
      const len = await rootLen();
      // ★ 横向溢出检测：页面级 scrollWidth 超出视口即记为遮挡隐患（对齐「MetaMask 侧栏打开时内容完整可见」标准）
      const ov = await evalJs(`(() => {
        const vw = window.innerWidth;
        const over = document.documentElement.scrollWidth - vw;
        if (over <= 1) return { over: 0, culprits: [] };
        // 只报真实溢出：右缘超出视口，且未被任何 overflow 裁剪型祖先包裹（被 clip 的装饰元素不算）
        const clipped = (el) => {
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const o = getComputedStyle(p).overflowX;
            if (o !== 'visible') return true;
          }
          return false;
        };
        const bad = [];
        document.querySelectorAll('body *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right > vw + 1 && !clipped(el)) {
            bad.push({ tag: el.tagName, cls: String(el.className).slice(0, 70), right: Math.round(r.right) });
          }
        });
        bad.sort((a, b) => b.right - a.right);
        const seen = new Set(); const culprits = [];
        for (const c of bad) {
          const k = c.tag + '|' + c.cls.slice(0, 30);
          if (!seen.has(k)) { seen.add(k); culprits.push(c); }
          if (culprits.length >= 4) break;
        }
        return { over, culprits };
      })()`);
      marks.push({ label, len, over: (ov && ov.over) || 0 });
      say(`  · ${label.padEnd(14)} #root=${len}${ov && ov.over > 1 ? `  ⚠️横向溢出${ov.over}px` : ''}`);
      if (ov && ov.culprits.length) ov.culprits.forEach((c) => say(`      ↳ 元凶 ${c.tag}.${c.cls} right=${c.right}`));
    };
    await record('连接后');

    for (let ni = 0; ni < navs.length; ni++) {
      const n = navs[ni];
      phase = `nav:${n}`;
      const before = exceptions.length;
      const cr = await clickByText(n);
      await sleep(1800);
      await record(`${n}${cr === 'NOT_FOUND' ? '(未找到!)' : ''}`);
      if (exceptions.length > before) say(`      ⚠️ 抛出 ${exceptions.length - before} 个异常`);

      if (SHOT_ROLE === roleKey && ni === Number(SHOT_NAV)) {
        try {
          await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1600, deviceScaleFactor: 1, mobile: false });
          await sleep(1200);
          const s = await call('Page.captureScreenshot', { format: 'png' });
          if (s?.result?.data) {
            const f = path.join(OUT_DIR, `${roleKey}-${ni}.png`);
            fs.writeFileSync(f, Buffer.from(s.result.data, 'base64'));
            say(`      📷 截图 → ${f}`);
          }
          await call('Emulation.clearDeviceMetricsOverride');
          await sleep(400);
        } catch (e) { say(`      ⚠️ 截图失败 ${e.message}`); }
      }
    }

    // ---- 侧栏手动收缩/展开回归（v5.1.1：onToggle 必须收到显式布尔）----
    const clickTitled = async (t) => evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].find(el => (el.title||'') === ${JSON.stringify(t)});
      if (!b) return 'NO_BTN'; b.click(); return 'OK';
    })()`);
    const asideCls = () => evalJs(`(() => { const a = document.querySelector('aside'); return a ? a.className : 'NO_ASIDE'; })()`);
    const c1 = await clickTitled('收起侧栏');
    await sleep(500);
    const collapsedOk = String(await asideCls()).includes('w-16');
    const c2 = await clickTitled('展开侧栏');
    await sleep(500);
    const expandedOk = String(await asideCls()).includes('w-64');
    const sideOk = c1 === 'OK' && collapsedOk && c2 === 'OK' && expandedOk;
    say(`  侧栏手动收缩/展开：${c1}/收起${collapsedOk ? '成功' : '失败'} · ${c2}/展开${expandedOk ? '成功' : '失败'} ${sideOk ? '✅' : '❌'}`);

    // ---- 调用记录弹窗一致性回归（v4.9.1：企业端「查看结果」不得误报「旧版凭证格式」）----
    // 修复前：弹窗入口漏传 dataRef → 本地重算必为空 → 恒报「与链上凭证不一致（旧版凭证格式）」
    let modalOk = null;
    if (roleKey === 'enterprise') {
      const clicked = await evalJs(`(() => {
        const b = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '查看结果');
        if (!b) return 'NO_BTN'; b.click(); return 'OK';
      })()`);
      await sleep(900);
      const txt = String(await evalJs(`document.body.innerText`));
      await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === '知道了'); if (b) b.click(); return 'OK'; })()`);
      await sleep(400);
      if (clicked === 'OK') {
        // 允许三态：一致 / 无法本地重算（文件缺失）/ 真不一致 —— 唯独不允许结构性误报「旧版凭证格式」
        modalOk = !txt.includes('旧版凭证格式')
          && (txt.includes('摘要校验一致') || txt.includes('无法本地重算') || txt.includes('与链上凭证不一致'));
        say(`  调用结果弹窗校验：${modalOk ? '✅ 无「旧版凭证格式」误报' : '❌ 仍出现旧版凭证格式误报'}`);
      } else {
        say('  调用结果弹窗校验：跳过（当前无调用记录）');
      }
    }

    // ---- 判定 ----
    const blank = marks.filter((m) => m.len >= 0 && m.len < 400);
    const missing = marks.filter((m) => m.label.includes('未找到'));
    const overflowed = marks.filter((m) => m.over > 1);
    say(`  异常 ${exceptions.length} 个，console.error ${consoleErrors.length} 条，疑似白屏 ${blank.length} 步，导航未找到 ${missing.length} 步，横向溢出 ${overflowed.length} 页`);
    [...new Set(exceptions)].slice(0, 6).forEach((e) => say('    ❌ ' + e));
    [...new Set(consoleErrors)].slice(0, 4).forEach((e) => say('    ⚠️ ' + e));
    if (blank.length) say('    ❌ 白屏步骤：' + blank.map((b) => b.label).join(', '));
    if (overflowed.length) say('    ❌ 横向溢出页：' + overflowed.map((b) => b.label).join(', '));

    const ok = exceptions.length === 0 && blank.length === 0 && missing.length === 0 && sideOk && overflowed.length === 0 && modalOk !== false;
    say(ok ? `  ✅ ${roleKey} 通过` : `  ❌ ${roleKey} 未通过`);
    return { ok, log };
  } finally {
    cleanup();
  }
}

// ------------------------------------------------------------
const keys = ONLY ? [ONLY] : Object.keys(ROLES);
const results = [];
for (const k of keys) {
  if (!ROLES[k]) { console.error(`[e2e-check] 未知角色 ${k}（可选：${Object.keys(ROLES).join('/')}）`); process.exit(2); }
  results.push({ k, ...(await runRole(k)) });
}

const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(OUT_DIR, 'summary.txt'),
  results.map((r) => `${r.ok ? '✅' : '❌'} ${r.k}`).join('\n'), 'utf8');

console.log('');
console.log(failed.length === 0
  ? `[e2e-check] ✅ 通过：${keys.length} 个角色、全部导航页均正常渲染，无异常`
  : `[e2e-check] ❌ 未通过：${failed.map((f) => f.k).join(', ')}`);
console.log(`[e2e-check] 报告目录：${OUT_DIR}`);
process.exit(failed.length === 0 ? 0 : 1);
