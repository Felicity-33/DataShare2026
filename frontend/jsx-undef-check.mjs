// ============================================================
// jsx-undef-check.mjs —— 静态检查「JSX 用了但没声明/没导入」
// ------------------------------------------------------------
// 为什么需要它：JSX 引用了未声明 / 未导入的组件时，渲染该页会抛
// ReferenceError，React 卸载整棵树 → 页面无法显示。
//
// 为什么三道旧检查都拦不住：
//   · `npm run build`      —— 语法合法，构建通过
//   · ssr-check.mjs        —— 只渲染各工作台的**默认页**（tab='overview'），
//                             `tab === 'audit'` 那段代码从未被执行
//   · browser-check.mjs    —— 只做 import()，而 ReferenceError 是**渲染期**才抛
//
// 本检查在**静态阶段**就把这类问题挖出来：不执行代码，只解析标识符。
// 用法：cd frontend && node jsx-undef-check.mjs
// 退出码 0 = 干净；非 0 = 有未声明标识符 / 模块路径不存在。
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = new URL('./src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
// 报告写到系统临时目录，避免在仓库里留生成物
const OUT_DIR = path.join(os.tmpdir(), 'datashare-checks');
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT = path.join(OUT_DIR, 'jsx-undef.txt');

// React 注入 / 宿主环境全局，不算未声明
const GLOBALS = new Set([
  'React', 'Fragment', 'console', 'window', 'document', 'process', 'globalThis',
  'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Set',
  'Map', 'WeakMap', 'Promise', 'BigInt', 'Symbol', 'RegExp', 'Error', 'Infinity', 'NaN',
  'undefined', 'null', 'true', 'false', 'localStorage', 'sessionStorage',
  'fetch', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder', 'AbortController',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'cancelAnimationFrame', 'alert', 'confirm', 'crypto', 'Buffer', 'Intl',
  'Uint8Array', 'Uint32Array', 'BigUint64Array', 'DataView',
]);

// ------------------------------------------------------------
// 收集一个源文件里「声明过的标识符」
// 宁可多收（漏报）不可少收（误报）—— 误报会让人不再信任这个检查。
// ------------------------------------------------------------
function declaredNames(src) {
  const s = new Set();
  const add = (n) => { if (n) s.add(n); };

  // ① import 子句：default / named / alias / namespace
  // ⚠️ 先摘掉「纯副作用导入」（import './index.css'）—— 它没有 from 子句，
  //    若留在原文里，下面那条 lazy 的 `import ... from '...'` 会**跨过它**
  //    把紧随其后的 default import 一起吞掉，导致那个名字从未登记 → 误报。
  //    （main.jsx 恰好把副作用导入放在最后，所以这个坑潜伏了很久才发现。）
  const body = src.replace(/\bimport\s+['"][^'"]+['"]/g, '');
  for (const m of body.matchAll(/import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g)) {
    const clause = m[1];
    const def = clause.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/);
    if (def) add(def[1]);
    for (const n of clause.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*(?:as\s+([A-Za-z_$][\w$]*))?/g)) {
      add(n[2] || n[1]);
    }
    const ns = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
    if (ns) add(ns[1]);
  }

  // ② 具名/类 声明
  for (const m of src.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  // ③ 变量声明
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  // ④ 对象解构 const { a, b: c } =
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const n of m[1].split(',')) {
      const mm = n.match(/([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?/);
      if (mm) add(mm[2] || mm[1]);
    }
  }
  // ⑤ 数组解构 const [a, b] =
  for (const m of src.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]\s*=/g)) {
    for (const n of m[1].split(',')) {
      const mm = n.match(/([A-Za-z_$][\w$]*)/);
      if (mm) add(mm[1]);
    }
  }

  // ⑥ 函数形参（含 `icon: Icon` 别名与解构）
  const addParams = (raw) => {
    const flat = raw.replace(/[{}[\]]/g, ' ');
    for (const n of flat.split(/[,\n]/)) {
      const alias = n.match(/[A-Za-z_$][\w$]*\s*:\s*([A-Za-z_$][\w$]*)/);
      if (alias) { add(alias[1]); continue; }
      const plain = n.match(/([A-Za-z_$][\w$]*)/);
      if (plain) add(plain[1]);
    }
  };
  for (const m of src.matchAll(/\bfunction\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) addParams(m[1]);
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) addParams(m[1]);
  for (const m of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) add(m[1]);
  for (const m of src.matchAll(/\bcatch\s*\(([A-Za-z_$][\w$]*)/g)) add(m[1]);

  return s;
}

// ------------------------------------------------------------
// 剥离注释（保留行号与字符位置）
// ⚠️ 不能用正则直接 `//` 切行 —— 那会把字符串里的 `http://` 也削掉
//    （config.js 里就有 RPC 地址），进而漏判或误判。用状态机跟踪引号。
// ------------------------------------------------------------
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null; // 当前所在字符串的引号类型
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && n === '*') {
      out += '  '; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += '  '; i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ------------------------------------------------------------
// 扫描：JSX 开标签
// ------------------------------------------------------------
function scanJsxUndef(rawSrc) {
  const src = stripComments(rawSrc);
  const decl = declaredNames(src);
  const hits = [];
  src.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/<([A-Z][A-Za-z0-9_$]*)(?=[\s/>])/g)) {
      const name = m[1];
      if (!decl.has(name) && !GLOBALS.has(name)) hits.push({ line: i + 1, name, kind: 'JSX 标签' });
    }
    for (const m of line.matchAll(/<([A-Za-z_$][\w$]*)\.([A-Za-z0-9_$]+)(?=[\s/>])/g)) {
      const name = m[1];
      if (!decl.has(name) && !GLOBALS.has(name)) hits.push({ line: i + 1, name: `${name}.${m[2]}`, kind: 'JSX 成员标签' });
    }
  });
  return hits;
}

// ------------------------------------------------------------
// 扫描：import 的文件路径是否真实存在（改名/移动也会导致白屏）
// ------------------------------------------------------------
function scanImportPaths(file, rawSrc) {
  const src = stripComments(rawSrc);
  const hits = [];
  const dir = path.dirname(file);
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
    const spec = m[1];
    const base = path.resolve(dir, spec);
    const ok = ['', '.js', '.jsx', '.mjs', '.json', '/index.js', '/index.jsx']
      .some((ext) => fs.existsSync(base + ext));
    if (!ok) hits.push({ line: src.slice(0, m.index).split('\n').length, name: spec, kind: '模块路径不存在' });
  }
  return hits;
}

// ------------------------------------------------------------
// 收集待检文件
// ------------------------------------------------------------
function collect(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collect(p));
    else if (/\.(jsx|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = collect(ROOT);
const lines = [`扫描文件数：${files.length}`, ''];
let problems = 0;

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const hits = [...scanJsxUndef(src), ...scanImportPaths(f, src)];
  if (hits.length) {
    problems += hits.length;
    lines.push(`❌ ${rel}`);
    for (const h of hits) lines.push(`     L${h.line}  ${h.name}  (${h.kind})`);
  } else {
    lines.push(`✅ ${rel}`);
  }
}

// ------------------------------------------------------------
// 自检：把 RegulatorDashboard 的 AuditCharts import 剥掉，
//       扫描器必须报出来 —— 否则这个检查形同虚设。
// ------------------------------------------------------------
const SAMPLES = [
  {
    tag: 'JSX 用了没导入',
    src: "import React from 'react';\nimport X from './components/Hint.jsx';\nconst A = () => <div><X /><AuditCharts /></div>;\n",
    expect: 'AuditCharts',
  },
  {
    tag: '合法别名参数不误报',
    src: "import { Zap } from 'lucide';\nfunction K({ icon: Icon }) { return <Icon />; }\n",
    expect: null,
  },
  {
    tag: '子组件已声明不误报',
    src: "function Inner() { return <i />; }\nconst A = () => <div><Inner /></div>;\n",
    expect: null,
  },
  {
    tag: '模块路径不存在',
    src: "import A from './nope-not-here.jsx';\n",
    expect: 'nope-not-here',
  },
  {
    tag: '注释里的 import 不误报 / 字符串中的 // 不干扰',
    src: "// 不要写成 import d from './nonexistent.json' 这样\nconst RPC = 'http://127.0.0.1:7545';\n/* import B from './also-missing.jsx' */\n",
    expect: null,
  },
  {
    // 纯副作用导入没有 from 子句，曾把紧随其后的 default import 一起吞掉
    tag: '副作用导入不吃掉后面的 default 导入',
    src: "import React from 'react';\nimport './index.css';\nimport X from './components/Hint.jsx';\nconst A = () => <div><X /></div>;\n",
    expect: null,
  },
];

lines.push('', '—— 自检 ——');
let selfBad = 0;
for (const s of SAMPLES) {
  const hits = [...scanJsxUndef(s.src), ...scanImportPaths(ROOT + 'samples.js', s.src)];
  const names = hits.map((h) => h.name).join(',');
  const pass = s.expect === null ? hits.length === 0 : names.includes(s.expect);
  if (!pass) selfBad++;
  lines.push(`${pass ? '✅' : '❌'} ${s.tag}  ${s.expect === null ? '(期望无问题)' : `(期望命中 ${s.expect})`} → ${hits.length ? names : '无'}`);
}

const ok = problems === 0 && selfBad === 0;
const tail = [
  '',
  `静态问题：${problems}`,
  `自检失败：${selfBad}`,
  ok ? '✅ 通过：无未声明 JSX / 无失效模块路径' : '❌ 未通过',
].join('\n');

const out = `${lines.join('\n')}\n${tail}`;
fs.writeFileSync(OUT, out, 'utf8');
console.log(out);
process.exit(ok ? 0 : 1);
