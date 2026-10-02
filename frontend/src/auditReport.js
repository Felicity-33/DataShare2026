// ============================================================
// auditReport.js —— 监管审计报告生成
// ------------------------------------------------------------
// 把链上数据整理成一份可下载的 Markdown 审计报告，包含：
//   链环境与合约信息 / 链上统计 / 托管结算明细 / 争议记录 /
//   异常拦截记录 / 全量事件明细 / 合规声明
// 报告全部来自链上只读查询，不含任何原始个人数据。
// ============================================================
import {
  GANACHE_CHAIN_ID, GANACHE_RPC_URL, CONTRACT_ADDRESS,
  EXPECTED_CONTRACT_VERSION, shortAddr, fmtEth, fmtTime
} from './config.js';
// ★ 裁决说明书并档导出（v4.5）：依据库映射 + 模拟引用统一声明
import { LEGAL_NOTICE, REGULATION_MAP } from './regulations.js';

// ============================================================
// 裁决说明书 → Markdown 片段（随「四、争议与裁决记录」并档导出）
// 四要素与监管工作台界面口径一致：事实认定 / 证据分析 / 适用规则 / 裁量过程
// ============================================================
function rulingDocMarkdown(doc) {
  const L = [];
  L.push('', `### 托管单 #${doc.escrowId} · 裁决说明书`);
  L.push('', `> ⚠️ ${doc.legalNotice || LEGAL_NOTICE}`);
  L.push('');
  L.push('| 项目 | 内容 |');
  L.push('| --- | --- |');
  L.push(`| 字段 / 金额 | ${doc.fieldName} · ${fmtEth(doc.amount)} ETH |`);
  L.push(`| 当事双方 | 数据所有者 ${shortAddr(doc.user)} / 申诉企业 ${shortAddr(doc.enterprise)} |`);
  L.push(`| 申诉理由 | ${doc.disputeReason || '—'} |`);
  L.push(`| 裁决结果 | ${doc.outcome === 'refund' ? '退款给企业（申诉成立）' : '放款给数据所有者（申诉驳回）'} |`);
  L.push(`| 裁决监管 | ${doc.regulator ? shortAddr(doc.regulator) : '—'} |`);
  L.push('', '**① 事实认定**', '');
  (doc.facts || []).forEach((f) => L.push(`- [${f.time}] ${f.text}`));
  L.push('', '**② 证据分析**', '');
  (doc.evidence || []).forEach((e) => L.push(`- **${e.label}**：${e.value} —— ${e.note}`));
  L.push('', '**③ 适用规则（模拟引用）**', '');
  (doc.baseRules || []).forEach((id) => {
    const r = REGULATION_MAP[id];
    if (r) L.push(`- ${r.id} ${r.name} ${r.article}：「${r.gist}」`);
  });
  L.push('', '**④ 裁量过程**', '');
  ['refund', 'payout'].forEach((k) => {
    const p = doc.paths?.[k];
    if (!p) return;
    L.push(`- ${p.title}`);
    (p.steps || []).forEach((s) => L.push(`  - ${s}`));
    L.push(`  - 引用依据：${(p.ruleIds || []).join('、')}`);
  });
  L.push('', `> ★ 实际裁决路径：**${doc.outcome === 'refund' ? '退款给企业' : '放款给用户'}**`);
  return L.join('\n');
}

// 生成 Markdown 报告正文
export function buildAuditReportMarkdown(data) {
  const {
    chainInfo = {}, stats = {}, settlement = {}, escrows = [],
    disputes = [], alerts = [], auditLogs = [], reputation = [],
    rulingDocs = {}, // ★ 已存档裁决说明书（v4.5）
  } = data;

  const now = new Date();
  const lines = [];
  const H = (t) => lines.push('', `## ${t}`, '');
  const table = (headers, rows) => {
    lines.push(`| ${headers.join(' | ')} |`);
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
    rows.forEach((r) => lines.push(`| ${r.join(' | ')} |`));
  };

  lines.push('# 链承共予 · DataShare 数据授权与托管结算 · 链上审计报告');
  lines.push('');
  lines.push(`> 报告生成时间：${now.toLocaleString('zh-CN', { hour12: false })}`);
  lines.push('> 本报告由监管端只读查询链上数据自动生成，不含任何原始个人数据。');

  // 一、链环境与合约信息
  H('一、链环境与合约信息');
  table(['项目', '值'], [
    ['网络', `Ganache 本地测试网（ChainID ${GANACHE_CHAIN_ID}）`],
    ['RPC 地址', GANACHE_RPC_URL],
    ['合约地址', CONTRACT_ADDRESS],
    ['合约版本', `${chainInfo.contractVersion || '未知'}（前端期望 ${EXPECTED_CONTRACT_VERSION}）`],
    ['版本校验', chainInfo.versionOk ? '通过' : '**不通过（需重新部署）**'],
    ['当前区块高度', chainInfo.blockNumber ?? '—'],
    ['托管争议窗口', chainInfo.challenge === null || chainInfo.challenge === undefined ? '—' : `${chainInfo.challenge} 秒（演示值）`],
    ['链上标准价', chainInfo.stdCall ? `按次 ${chainInfo.stdCall} ETH / 按天 ${chainInfo.stdDay} ETH` : '—'],
    ['托管资金池', `${settlement.pending ?? '0'} ETH（未结算）`],
  ]);

  // 二、链上统计
  H('二、链上统计');
  table(['指标', '数值'], [
    ['已确权数据字段', `${stats.fieldCount ?? 0} 个`],
    ['授权记录累计', `${stats.authTotal ?? 0} 次`],
    ['托管结算单累计', `${settlement.escrowCount ?? 0} 笔`],
    ['已确定分账总额', `${stats.distributeTotal ?? 0} ETH`],
    ['已实际提现', `${settlement.withdrawn ?? 0} ETH`],
    ['争议退款总额', `${settlement.refunded ?? 0} ETH`],
    ['待裁决争议', `${settlement.disputePending ?? 0} 笔`],
    ['异常拦截累计', `${alerts.length} 条`],
  ]);

  // 三、托管结算明细
  H('三、托管结算明细');
  if (!escrows.length) {
    lines.push('暂无托管结算单。');
  } else {
    table(
      ['托管单', '字段', '数据所有者', '调用企业', '金额(ETH)', '交付凭证', '结算状态', '创建时间'],
      escrows.map((e) => [
        `#${e.escrowId}`,
        e.fieldName,
        shortAddr(e.user),
        shortAddr(e.enterprise),
        fmtEth(e.amount),
        `\`${e.deliveryHash}\``,
        e.refunded ? '已退款' : e.settled ? '已放款' : e.disputed ? '争议中' : e.confirmedAt > 0 ? '已提前结算' : '托管中',
        fmtTime(e.ts),
      ])
    );
  }

  // 四、争议记录
  H('四、争议与裁决记录');
  if (!disputes.length) {
    lines.push('报告期内无争议记录。');
  } else {
    table(
      ['托管单', '字段', '申诉企业', '争议金额(ETH)', '申诉理由', '裁决结果'],
      disputes.map((d) => [
        `#${d.escrowId}`, d.fieldName, shortAddr(d.enterprise), fmtEth(d.amount),
        d.disputeReason || '—',
        d.settled ? (d.refunded ? '裁定退款给企业' : '裁定放款给数据所有者') : '待裁决',
      ])
    );
    // ★ 已存档的裁决说明书并档导出（v4.5）：与监管工作台界面四要素口径一致
    const archived = disputes.filter((d) => rulingDocs[d.escrowId]);
    if (archived.length) {
      lines.push('', '**附：已存档裁决说明书（模拟依据，不具真实法律效力）**');
      archived.forEach((d) => lines.push(rulingDocMarkdown(rulingDocs[d.escrowId])));
    }
  }

  // 五、企业信誉
  H('五、企业信誉分');
  if (!reputation.length) {
    lines.push('暂无企业调用记录。');
  } else {
    table(['企业地址', '信誉分', '成功调用', '被拦截', '申诉败诉', '失信标记'], reputation.map((r) => [
      r.address, r.score, r.success, r.blocked, r.lost, r.isFlagged ? `是（${r.flagReason || '—'}）` : '否',
    ]));
  }

  // 六、异常拦截记录
  H('六、异常拦截记录（由合约在业务校验中自动写入）');
  if (!alerts.length) {
    lines.push('报告期内无异常拦截记录。');
  } else {
    table(['时间', '调用企业', '目标字段', '拦截原因'], alerts.map((a) => [
      fmtTime(a.ts), shortAddr(a.enterprise), `#${a.fieldId}`, a.reason || '—',
    ]));
  }

  // 七、全量链上事件明细
  H('七、全量链上事件明细');
  if (!auditLogs.length) {
    lines.push('暂无链上事件。');
  } else {
    table(['时间', '区块', '类型', '字段', '用户', '企业', '金额(ETH)', '交易哈希'],
      auditLogs.map((l) => [
        fmtTime(l.ts), l.blockNumber, l.type,
        l.fieldId === null || l.fieldId === undefined ? '-' : `#${l.fieldId}`,
        l.user ? shortAddr(l.user) : '-',
        l.enterprise ? shortAddr(l.enterprise) : '-',
        l.amount ? fmtEth(l.amount) : '-',
        `\`${l.txHash}\``,
      ]));
  }

  // 七、合规声明
  H('八、合规声明');
  lines.push('- 链上仅存数据摘要哈希与授权凭证，**不包含任何原始个人数据**；');
  lines.push('- 所有数据访问均基于数据所有者的显式授权，可随时撤销，撤权后调用会被合约自动拦截；');
  lines.push('- 演示数据均为模拟数据，不涉及任何真实个人信息；');
  lines.push('- 本报告用于技术验证与合规审计，不构成对真实数据交易的法律意见。');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`*报告由链承共予 · DataShare 监管工作台自动生成 · 合约 ${CONTRACT_ADDRESS}*`);

  return lines.join('\n');
}

// 触发浏览器下载（纯前端，无需后端）
export function downloadTextFile(filename, text, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 生成带时间戳的报告文件名
export function reportFileName(prefix = '链承共予DataShare-审计报告') {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `${prefix}-${stamp}.md`;
}

// ============================================================
// 二、图表化 HTML 审计报告
// ------------------------------------------------------------
// 为什么要 HTML 而不是 Markdown：Markdown 里的表格是纯文本，
// 没有任何图形，导出后「不好看也不整齐」。HTML 报告可以内嵌
// SVG 图表、做对齐的表格与打印版式，双击即可用浏览器打开，
// 也能直接「打印 → 另存为 PDF」当正式材料提交。
//
// ★ 零外部依赖：不引 CDN、不引图表库，所有图形都是内联 SVG ——
//   本地离线、断网演示都能正常渲染（赛场网络不可靠，这点很重要）。
// ============================================================

// 图表配色（与工作台主色一致：青 / 翠绿 / 紫 / 琥珀 / 玫红）
const CHART_COLORS = ['#06b6d4', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e', '#64748b'];

/// HTML 转义（争议理由、失信原因等是用户输入，必须转义）
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/// 环形图（结算状态分布）
function donutSvg(segments, size = 190, stroke = 24) {
  const items = segments.filter((s) => s.value > 0);
  const total = items.reduce((a, s) => a + s.value, 0);
  if (!total) return '<p class="empty">暂无数据</p>';
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const arcs = items.map((s) => {
    const len = (s.value / total) * circ;
    const seg = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}"
      stroke-width="${stroke}" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${c} ${c})" />`;
    offset += len;
    return seg;
  }).join('');
  const legend = items.map((s) => `<li><i style="background:${s.color}"></i>
    <span class="lg-label">${esc(s.label)}</span>
    <b>${s.value}</b>
    <span class="lg-pct">${((s.value / total) * 100).toFixed(1)}%</span></li>`).join('');
  return `<div class="donut-wrap">
    <div class="donut">
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="${stroke}" />
        ${arcs}
      </svg>
      <div class="donut-center"><b>${total}</b><span>笔托管单</span></div>
    </div>
    <ul class="legend">${legend}</ul>
  </div>`;
}

/// 横向条形图（事件类型分布 / 企业信誉分）
function barsSvg(items, { max, unit = '', color = '#06b6d4', threshold = null } = {}) {
  if (!items.length) return '<p class="empty">暂无数据</p>';
  const top = max || Math.max(...items.map((i) => i.value), 1);
  const rows = items.map((it) => {
    const pct = Math.max(2, (it.value / top) * 100);
    const col = it.color || color;
    return `<li>
      <span class="bar-label" title="${esc(it.label)}">${esc(it.label)}</span>
      <span class="bar-track">
        <span class="bar-fill" style="width:${pct}%;background:${col}"></span>
        ${threshold !== null ? `<span class="bar-thresh" style="left:${(threshold / top) * 100}%"></span>` : ''}
      </span>
      <b class="bar-val">${it.value}${unit}</b>
    </li>`;
  }).join('');
  return `<ul class="bars">${rows}</ul>`;
}

/// 面积折线图（事件时间分布）
function areaSvg(points, { height = 170, color = '#06b6d4' } = {}) {
  if (!points.length) return '<p class="empty">暂无数据</p>';
  const W = 640;
  const H = height;
  const padL = 40, padR = 14, padT = 14, padB = 30;
  const maxV = Math.max(...points.map((p) => p.value), 1);
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  // ★ 顶部留 14% 余量：若各时段计数相同（很常见），折线会贴在顶边，
  //   面积填满整块变成一个「实心方块」，看不出是趋势图。留出余量后才像折线。
  const HEAD = 0.86;
  const x = (i) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => padT + innerH - (v / maxV) * innerH * HEAD;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="2.6" fill="${color}" />`).join('');

  // 横向网格线（4 档）；标签用同一个 y() 换算，保证与数据对齐
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const gy = padT + innerH - f * innerH * HEAD;
    return `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${W - padR}" y2="${gy.toFixed(1)}" stroke="#f1f5f9" stroke-width="1" />
      <text x="${padL - 7}" y="${(gy + 3.5).toFixed(1)}" text-anchor="end" class="axis">${Math.round(f * maxV)}</text>`;
  }).join('');

  // 横轴标签（最多 6 个，避免挤在一起）
  const step = Math.max(1, Math.ceil(points.length / 6));
  const xLabels = points.map((p, i) => (i % step === 0
    ? `<text x="${x(i).toFixed(1)}" y="${H - 9}" text-anchor="middle" class="axis">${esc(p.label)}</text>`
    : '')).join('');

  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.28" />
      <stop offset="100%" stop-color="${color}" stop-opacity="0.02" />
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#areaFill)" />
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" />
    ${dots}${xLabels}
  </svg>`;
}

/// 通用表格。默认所有单元格不折行（短字段折行会碎成「消费偏 好」），
/// 仅 `wrap` 里列出的列（长哈希 / 理由 / 说明）允许换行。
function htmlTable(headers, rows, { wrap = [] } = {}) {
  if (!rows.length) return '<p class="empty">暂无记录</p>';
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const tr = rows.map((r) => `<tr>${r.map((cell, i) => (
    `<td class="${wrap.includes(i) ? 'wrap' : ''}">${cell}</td>`
  )).join('')}</tr>`).join('');
  return `<div class="tbl-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

/// 生成自包含的 HTML 审计报告（可直接打开 / 打印为 PDF）
export function buildAuditReportHTML(data) {
  const {
    chainInfo = {}, stats = {}, settlement = {}, escrows = [],
    disputes = [], alerts = [], auditLogs = [], reputation = [],
    rulingDocs = {}, // ★ 已存档裁决说明书（v4.5）
  } = data;

  const now = new Date();
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  // ---------- KPI ----------
  const kpis = [
    { label: '已确权数据字段', value: num(stats.fieldCount), unit: '个', color: CHART_COLORS[0] },
    { label: '授权记录累计', value: num(stats.authTotal), unit: '次', color: CHART_COLORS[1] },
    { label: '托管结算单', value: num(settlement.escrowCount), unit: '笔', color: CHART_COLORS[2] },
    { label: '已确定分账', value: stats.distributeTotal ?? '0', unit: 'ETH', color: CHART_COLORS[3] },
    { label: '已实际提现', value: settlement.withdrawn ?? '0', unit: 'ETH', color: CHART_COLORS[0] },
    { label: '争议退款', value: settlement.refunded ?? '0', unit: 'ETH', color: CHART_COLORS[4] },
    { label: '待裁决争议', value: num(settlement.disputePending), unit: '笔', color: CHART_COLORS[4] },
    { label: '异常拦截', value: alerts.length, unit: '条', color: CHART_COLORS[5] },
  ];

  // ---------- 图 1：托管单结算状态分布 ----------
  const statusOf = (e) => (e.refunded ? '已退款'
    : e.settled ? '已放款'
      : e.disputed ? '争议中'
        : num(e.confirmedAt) > 0 ? '已提前结算' : '托管中');
  const statusOrder = ['托管中', '已提前结算', '已放款', '争议中', '已退款'];
  const statusCount = {};
  escrows.forEach((e) => { const s = statusOf(e); statusCount[s] = (statusCount[s] || 0) + 1; });
  const donutSegments = statusOrder
    .filter((s) => statusCount[s])
    .map((s, i) => ({ label: s, value: statusCount[s], color: CHART_COLORS[i % CHART_COLORS.length] }));

  // ---------- 图 2：链上事件类型分布 ----------
  const typeCount = {};
  auditLogs.forEach((l) => { const t = l.type || '未知'; typeCount[t] = (typeCount[t] || 0) + 1; });
  const typeItems = Object.entries(typeCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([label, value], i) => ({ label, value, color: CHART_COLORS[i % CHART_COLORS.length] }));

  // ---------- 图 3：事件时间分布（按小时聚合，取最近 24 个小时段） ----------
  const hourBuckets = {};
  auditLogs.forEach((l) => {
    const t = num(l.ts) * 1000;
    if (!t) return;
    const d = new Date(t);
    const key = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
    hourBuckets[key] = (hourBuckets[key] || 0) + 1;
  });
  const areaPoints = Object.entries(hourBuckets)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-24)
    .map(([label, value]) => ({ label, value }));

  // ---------- 图 4：企业信誉分（阈值线 = 合约的 300 分暂停线） ----------
  const repItems = [...reputation]
    .sort((a, b) => num(b.score) - num(a.score))
    .slice(0, 8)
    .map((r) => ({
      label: shortAddr(r.address),
      value: num(r.score),
      color: num(r.score) < 300 ? CHART_COLORS[4] : num(r.isFlagged ? 1 : 0) ? CHART_COLORS[3] : CHART_COLORS[1],
    }));

  // ---------- 各表格 ----------
  const escrowTable = htmlTable(
    ['托管单', '字段', '数据所有者', '调用企业', '金额(ETH)', '交付凭证', '结算状态', '创建时间'],
    escrows.map((e) => {
      const s = statusOf(e);
      const cls = s === '已放款' ? 'ok' : s === '已退款' ? 'bad' : s === '争议中' ? 'warn' : 'plain';
      return [
        `#${esc(e.escrowId)}`, esc(e.fieldName),
        `<span class="mono">${esc(shortAddr(e.user))}</span>`,
        `<span class="mono">${esc(shortAddr(e.enterprise))}</span>`,
        esc(fmtEth(e.amount)),
        `<span class="mono hash">${esc(e.deliveryHash)}</span>`,
        `<span class="tag ${cls}">${esc(s)}</span>`,
        esc(fmtTime(e.ts)),
      ];
    }),
    { wrap: [5] },   // 第 6 列「交付凭证」是 64 字符哈希，必须允许换行
  );

  const disputeTable = htmlTable(
    ['托管单', '字段', '申诉企业', '争议金额(ETH)', '申诉理由', '裁决结果'],
    disputes.map((d) => [
      `#${esc(d.escrowId)}`, esc(d.fieldName),
      `<span class="mono">${esc(shortAddr(d.enterprise))}</span>`,
      esc(fmtEth(d.amount)), esc(d.disputeReason || '—'),
      d.settled
        ? (d.refunded ? '<span class="tag bad">裁定退款给企业</span>' : '<span class="tag ok">裁定放款给数据所有者</span>')
        : '<span class="tag warn">待裁决</span>',
    ]),
    { wrap: [4] },   // 第 5 列「申诉理由」为自由文本
  );

  // ---------- ★ 已存档裁决说明书卡片（v4.5）：四要素随争议记录并档导出 ----------
  const rulingDocCards = disputes.filter((d) => rulingDocs[d.escrowId]).map((d) => {
    const doc = rulingDocs[d.escrowId];
    const li = (t) => `<li>${t}</li>`;
    const facts = (doc.facts || []).map((f) => li(esc(`[${f.time}] ${f.text}`))).join('');
    const evidence = (doc.evidence || []).map((e) => li(`<b>${esc(e.label)}</b>：${esc(e.value)} —— ${esc(e.note)}`)).join('');
    const rules = (doc.baseRules || []).map((id) => {
      const r = REGULATION_MAP[id];
      return r ? li(`${esc(`${r.id} ${r.name} ${r.article}`)}：「${esc(r.gist)}」`) : '';
    }).join('');
    const path = (k) => {
      const p = doc.paths?.[k];
      if (!p) return '';
      const steps = (p.steps || []).map((s) => li(esc(s))).join('');
      return `<p style="margin:6px 0 2px"><b>${esc(p.title)}</b>（引用依据：${esc((p.ruleIds || []).join('、'))}）</p>
        <ul class="comp" style="margin:0 0 6px">${steps}</ul>`;
    };
    const outcomeTag = doc.outcome === 'refund'
      ? '<span class="tag bad">退款给企业（申诉成立）</span>'
      : '<span class="tag ok">放款给数据所有者（申诉驳回）</span>';
    return `<div class="card" style="margin-bottom:14px">
      <h3 style="display:flex;align-items:center;gap:8px">托管单 #${esc(doc.escrowId)} · 裁决说明书 ${outcomeTag}</h3>
      <p class="empty" style="color:#b45309;margin-bottom:10px">⚠️ ${esc(doc.legalNotice || LEGAL_NOTICE)}</p>
      <table class="kv" style="margin-bottom:10px"><tbody>
        <tr><td>字段 / 金额</td><td>${esc(doc.fieldName)} · ${esc(fmtEth(doc.amount))} ETH</td></tr>
        <tr><td>当事双方</td><td>数据所有者 <span class="mono">${esc(shortAddr(doc.user))}</span> / 申诉企业 <span class="mono">${esc(shortAddr(doc.enterprise))}</span></td></tr>
        <tr><td>申诉理由</td><td>${esc(doc.disputeReason || '—')}</td></tr>
        <tr><td>裁决监管</td><td><span class="mono">${esc(doc.regulator ? shortAddr(doc.regulator) : '—')}</span></td></tr>
      </tbody></table>
      <p style="margin:6px 0 2px"><b>① 事实认定</b></p>
      <ul class="comp">${facts}</ul>
      <p style="margin:6px 0 2px"><b>② 证据分析</b></p>
      <ul class="comp">${evidence}</ul>
      <p style="margin:6px 0 2px"><b>③ 适用规则（模拟引用）</b></p>
      <ul class="comp">${rules}</ul>
      <p style="margin:6px 0 2px"><b>④ 裁量过程</b></p>
      ${path('refund')}${path('payout')}
    </div>`;
  }).join('');

  const repTable = htmlTable(
    ['企业地址', '信誉分', '成功调用', '被拦截', '申诉败诉', '失信标记'],
    reputation.map((r) => [
      `<span class="mono">${esc(r.address)}</span>`,
      `<b class="${num(r.score) < 300 ? 'txt-bad' : 'txt-ok'}">${esc(r.score)}</b>`,
      esc(r.success), esc(r.blocked), esc(r.lost),
      r.isFlagged ? `<span class="tag bad">是</span> ${esc(r.flagReason || '—')}` : '<span class="tag ok">否</span>',
    ]),
    { wrap: [0, 5] },   // 企业地址（42 字符）与失信原因需换行
  );

  const alertTable = htmlTable(
    ['时间', '调用企业', '目标字段', '拦截原因'],
    alerts.map((a) => [
      esc(fmtTime(a.ts)),
      `<span class="mono">${esc(shortAddr(a.enterprise))}</span>`,
      `#${esc(a.fieldId)}`, esc(a.reason || '—'),
    ]),
    { wrap: [3] },   // 拦截原因为自由文本
  );

  const logTable = htmlTable(
    ['时间', '区块', '类型', '字段', '用户', '企业', '金额(ETH)', '交易哈希'],
    auditLogs.map((l) => [
      esc(fmtTime(l.ts)), esc(l.blockNumber), esc(l.type),
      l.fieldId === null || l.fieldId === undefined ? '-' : `#${esc(l.fieldId)}`,
      l.user ? `<span class="mono">${esc(shortAddr(l.user))}</span>` : '-',
      l.enterprise ? `<span class="mono">${esc(shortAddr(l.enterprise))}</span>` : '-',
      l.amount ? esc(fmtEth(l.amount)) : '-',
      `<span class="mono hash">${esc(l.txHash)}</span>`,
    ]),
    { wrap: [7] },   // 交易哈希需换行
  );

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>链承共予 · DataShare · 链上审计报告</title>
<style>
  :root{--ink:#1e293b;--sub:#64748b;--line:#e8edf3;--bg:#f6f8fb;--brand:#0891b2}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;
    font-size:13px;line-height:1.65}
  .page{max-width:1000px;margin:0 auto;padding:32px 20px 60px}
  /* 报头 */
  .cover{background:#0f172a;color:#fff;border-radius:20px;padding:30px 34px;margin-bottom:22px}
  .cover h1{margin:0;font-size:22px;letter-spacing:.4px}
  .cover .sub{margin-top:8px;color:#94a3b8;font-size:12.5px}
  .cover .meta{margin-top:18px;display:flex;flex-wrap:wrap;gap:10px}
  .cover .meta span{background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.14);
    border-radius:999px;padding:4px 12px;font-size:11.5px;color:#cbd5e1}
  .cover .meta b{color:#67e8f9;font-weight:700}
  /* 区块 */
  section{background:#fff;border:1px solid var(--line);border-radius:18px;
    padding:22px 24px;margin-bottom:18px}
  h2{margin:0 0 16px;font-size:15px;display:flex;align-items:center;gap:9px}
  h2::before{content:"";width:4px;height:15px;border-radius:2px;background:var(--brand)}
  h3{margin:0 0 12px;font-size:12.5px;color:var(--sub);font-weight:600}
  .empty{color:#94a3b8;font-size:12px;margin:6px 0}
  /* KPI */
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
  .kpi{border:1px solid var(--line);border-radius:14px;padding:14px 16px;background:#fcfdff}
  .kpi .k{font-size:11px;color:var(--sub);margin-bottom:6px}
  .kpi .v{font-size:20px;font-weight:800;letter-spacing:-.4px;font-variant-numeric:tabular-nums}
  .kpi .u{font-size:11px;color:var(--sub);margin-left:3px;font-weight:600}
  .kpi .accent{height:3px;border-radius:2px;margin-top:10px}
  /* 图表 */
  .charts{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  .card{border:1px solid var(--line);border-radius:14px;padding:16px 18px}
  .donut-wrap{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
  .donut{position:relative;flex:0 0 auto}
  .donut-center{position:absolute;inset:0;display:flex;flex-direction:column;
    align-items:center;justify-content:center;pointer-events:none}
  .donut-center b{font-size:24px;letter-spacing:-.5px}
  .donut-center span{font-size:10.5px;color:var(--sub)}
  .legend{list-style:none;margin:0;padding:0;flex:1;min-width:150px}
  .legend li{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px}
  .legend i{width:9px;height:9px;border-radius:3px;flex:0 0 auto}
  .legend .lg-label{flex:1;color:var(--sub)}
  .legend b{font-variant-numeric:tabular-nums}
  .legend .lg-pct{color:#94a3b8;font-size:11px;width:46px;text-align:right;
    font-variant-numeric:tabular-nums}
  .bars{list-style:none;margin:0;padding:0}
  .bars li{display:flex;align-items:center;gap:10px;padding:5px 0;font-size:12px}
  .bar-label{width:104px;flex:0 0 auto;color:var(--sub);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
  .bar-track{position:relative;flex:1;height:9px;background:#f1f5f9;border-radius:5px;overflow:hidden}
  .bar-fill{display:block;height:100%;border-radius:5px}
  .bar-thresh{position:absolute;top:-2px;width:1.5px;height:13px;background:#f43f5e;opacity:.65}
  .bar-val{width:52px;text-align:right;flex:0 0 auto;font-variant-numeric:tabular-nums}
  .axis{font-size:9.5px;fill:#94a3b8}
  /* 表格 */
  .tbl-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px}
  table{width:100%;border-collapse:collapse;font-size:11.5px}
  th{background:#f8fafc;color:var(--sub);font-weight:600;text-align:left;
    padding:9px 12px;white-space:nowrap;border-bottom:1px solid var(--line)}
  /* 默认不折行：短字段（字段名 / 状态 / 金额 / 时间）折行会碎成「消费偏 好」很难看。
     只有明确标了 .wrap 的长内容列（哈希 / 理由 / 说明）才允许换行。 */
  td{padding:9px 12px;border-bottom:1px solid #f4f7fa;vertical-align:top;white-space:nowrap}
  td.wrap{white-space:normal;word-break:break-word}
  tbody tr:last-child td{border-bottom:0}
  tbody tr:hover{background:#fcfdff}
  .mono{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace;font-size:11px}
  .hash{word-break:break-all;color:#475569}
  .tag{display:inline-block;padding:1.5px 8px;border-radius:999px;font-size:10.5px;
    font-weight:700;white-space:nowrap}
  .tag.ok{background:#ecfdf5;color:#047857}
  .tag.bad{background:#fef2f2;color:#b91c1c}
  .tag.warn{background:#fffbeb;color:#b45309}
  .tag.plain{background:#f1f5f9;color:#475569}
  .txt-ok{color:#047857}.txt-bad{color:#b91c1c}
  /* 键值表（链环境信息）本来就该自然折行 */
  .kv td{white-space:normal}
  .kv td:first-child{width:170px;color:var(--sub)}
  /* 合规声明 */
  ul.comp{margin:0;padding-left:18px;color:#334155}
  ul.comp li{margin:5px 0}
  footer{text-align:center;color:#94a3b8;font-size:11.5px;padding:14px 0 0}
  .toolbar{position:sticky;top:0;z-index:9;display:flex;justify-content:flex-end;
    gap:8px;padding:0 0 14px}
  .btn{background:#0f172a;color:#fff;border:0;border-radius:10px;padding:8px 16px;
    font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
  .btn:hover{background:#1e293b}
  @media print{
    body{background:#fff;font-size:11.5px}
    .page{padding:0;max-width:none}
    .toolbar{display:none}
    section{border:0;border-radius:0;padding:0 0 14px;margin:0 0 8px;
      break-inside:avoid;page-break-inside:avoid}
    .cover{border-radius:0;background:#0f172a !important;-webkit-print-color-adjust:exact;
      print-color-adjust:exact}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .charts{grid-template-columns:1fr 1fr}
  }
  @media (max-width:760px){
    .kpis{grid-template-columns:repeat(2,1fr)}
    .charts{grid-template-columns:1fr}
  }
</style>
</head>
<body>
<div class="page">

  <div class="toolbar">
    <button class="btn" onclick="window.print()">打印 / 另存为 PDF</button>
  </div>

  <div class="cover">
    <h1>链承共予 · DataShare · 链上审计报告</h1>
    <div class="sub">数据授权与托管结算 · 监管端只读审计 · 不含任何原始个人数据</div>
    <div class="meta">
      <span>生成时间 <b>${esc(now.toLocaleString('zh-CN', { hour12: false }))}</b></span>
      <span>合约版本 <b>${esc(chainInfo.contractVersion || '未知')}</b></span>
      <span>区块高度 <b>${esc(chainInfo.blockNumber ?? '—')}</b></span>
      <span>合约 <b>${esc(CONTRACT_ADDRESS)}</b></span>
    </div>
  </div>

  <section>
    <h2>关键指标</h2>
    <div class="kpis">
      ${kpis.map((k) => `<div class="kpi">
        <div class="k">${esc(k.label)}</div>
        <div class="v">${esc(k.value)}<span class="u">${esc(k.unit)}</span></div>
        <div class="accent" style="background:${k.color}"></div>
      </div>`).join('')}
    </div>
  </section>

  <section>
    <h2>审计图表</h2>
    <div class="charts">
      <div class="card">
        <h3>托管单结算状态分布</h3>
        ${donutSvg(donutSegments)}
      </div>
      <div class="card">
        <h3>链上事件类型分布（Top 8）</h3>
        ${barsSvg(typeItems, { unit: ' 次' })}
      </div>
      <div class="card" style="grid-column:1 / -1">
        <h3>链上事件时间分布（最近 24 个小时段）</h3>
        ${areaSvg(areaPoints)}
      </div>
      <div class="card" style="grid-column:1 / -1">
        <h3>企业信誉分（红线 = 合约 300 分自动暂停阈值）</h3>
        ${barsSvg(repItems, { unit: ' 分', max: Math.max(1000, ...repItems.map((r) => r.value)), threshold: 300 })}
      </div>
    </div>
  </section>

  <section>
    <h2>一、链环境与合约信息</h2>
    <div class="tbl-wrap"><table class="kv"><tbody>
      ${[
        ['网络', `Ganache 本地测试网（ChainID ${esc(GANACHE_CHAIN_ID)}）`],
        ['RPC 地址', `<span class="mono">${esc(GANACHE_RPC_URL)}</span>`],
        ['合约地址', `<span class="mono">${esc(CONTRACT_ADDRESS)}</span>`],
        ['合约版本', `${esc(chainInfo.contractVersion || '未知')}（前端期望 ${esc(EXPECTED_CONTRACT_VERSION)}）`],
        ['版本校验', chainInfo.versionOk ? '<span class="tag ok">通过</span>'
          : '<span class="tag bad">不通过（需重新部署）</span>'],
        ['当前区块高度', esc(chainInfo.blockNumber ?? '—')],
        ['托管争议窗口', chainInfo.challenge === null || chainInfo.challenge === undefined
          ? '—' : `${esc(chainInfo.challenge)} 秒（演示值）`],
        ['链上标准价', chainInfo.stdCall
          ? `按次 ${esc(chainInfo.stdCall)} ETH / 按天 ${esc(chainInfo.stdDay)} ETH` : '—'],
        ['托管资金池', `${esc(settlement.pending ?? '0')} ETH（未结算）`],
      ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}
    </tbody></table></div>
  </section>

  <section>
    <h2>二、托管结算明细</h2>
    ${escrowTable}
  </section>

  <section>
    <h2>三、争议与裁决记录</h2>
    ${disputeTable}
    ${rulingDocCards}
  </section>

  <section>
    <h2>四、企业信誉分</h2>
    ${repTable}
  </section>

  <section>
    <h2>五、异常拦截记录</h2>
    <p class="empty" style="margin-bottom:10px">由合约在业务校验中自动写入，失败调用不 revert，留痕可查。</p>
    ${alertTable}
  </section>

  <section>
    <h2>六、全量链上事件明细</h2>
    ${logTable}
  </section>

  <section>
    <h2>七、合规声明</h2>
    <ul class="comp">
      <li>链上仅存数据摘要哈希与授权凭证，<b>不包含任何原始个人数据</b>；</li>
      <li>所有数据访问均基于数据所有者的显式授权，可随时撤销，撤权后调用会被合约自动拦截；</li>
      <li>演示数据均为模拟数据，不涉及任何真实个人信息；</li>
      <li>本报告用于技术验证与合规审计，不构成对真实数据交易的法律意见。</li>
    </ul>
  </section>

  <footer>
    报告由链承共予 · DataShare 监管工作台自动生成 · 合约 <span class="mono">${esc(CONTRACT_ADDRESS)}</span>
  </footer>
</div>
</body>
</html>`;
}

/// 生成带时间戳的 HTML 报告文件名
export function reportFileNameHtml(prefix = '链承共予DataShare-审计报告') {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `${prefix}-${stamp}.html`;
}
