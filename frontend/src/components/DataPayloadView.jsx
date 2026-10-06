// ============================================================
// DataPayloadView.jsx —— 链下数据文件的图表化展示
// ------------------------------------------------------------
// 输入是**链下数据文件解析出来的对象**（见 public/data/*.json）。
//
// 数据文件里的字段含义差异很大（百分比 / 比值 / 多值枚举 / 时段 / 计数 / 文本），
// 全部平铺成「字段 | 内容」两列表会很难读。这里改为**按值语义选图形**：
//   卡片顶栏    —— 分类名 + 文件名 + 视图切换（图表 / 原文）+ 全屏
//   核心指标条  —— 分类 / 年龄段 / 月均消费区间 / 记录条数（四宫格）
//   兴趣标签    —— 圆角胶囊
//   分组卡片    —— 每条分组一个卡片，内部字段按语义渲染：
//                 · 百分比      → 进度条 + 百分比（+ 括号前的补充说明）
//                 · 比值（a/b） → 双色堆叠条 + 图例
//                 · 时段        → 24 小时时间轴高亮
//                 · 多值枚举    → 胶囊标签组
//                 · 计数        → 大字 + 样本数说明
//                 · 其余文本    → 字段名 + 值
//   字段字典    —— 独立的三列表（字段 / 类型 / 说明），折叠在底部
//   合规声明    —— 绿色底的合规区块
//   「原文」视图 —— 原始数据只存链下，不提供下载，
//                 仅给出**指向链下原文件的直链**，新标签页在线查看。
//
// ★ 展示边界（有意为之）：
//   ① 前端只保留上面这套简洁图表，不内嵌 JSON 原件（需要逐字核对时走直链）；
//   ② 原文件内置的「图表」节（文本图表，供在线查看快速浏览）在本视图**不展示**
//     —— 分组渲染时按键名剔除，文件里加不加该节都不影响前端形态。
//
// 企业端「调用成功」弹窗与存证抽屉共用本组件，保证同一份数据两处长得一样。
// ⚠️ 本组件只做「展示形态」的转换，**不修改任何数据源**（public/data/*.json）；
//    摘要口径见 config.js 的 hashPayload（「图表」节不参与摘要计算）。
// ============================================================
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Tag as TagIcon, Hash, ShieldCheck, BarChart3, Braces, Maximize2, X, ExternalLink } from 'lucide-react';
// ★ 值语义判定统一从 payloadSemantics.js 取（唯一来源）
import { classifyValue, isPlainObject, fmtVal } from '../payloadSemantics.js';

// 顶层核心指标（其余键按分组渲染）
const CORE_KEYS = ['分类', '年龄段', '月均消费区间', '记录条数'];
const TAG_KEY = '兴趣标签';
// 原文件内置的文本图表节：仅供在线查看，前端图表视图不展示
const CHART_KEY = '图表';

/// 把数据文件地址还原成可读路径（如 /data/%E9%87%91... → data/金融理财.json）
const fileNameOf = (fileUrl) => {
  const raw = String(fileUrl || '');
  if (!raw) return '';
  try { return decodeURIComponent(raw).replace(/^\//, ''); } catch { return raw; }
};

// ------------------------------------------------------------
// 视觉原子
// ------------------------------------------------------------
const PALETTE = {
  cyan:    ['bg-cyan-400',    'bg-cyan-50',    'text-cyan-600'],
  emerald: ['bg-emerald-400', 'bg-emerald-50', 'text-emerald-600'],
  violet:  ['bg-violet-400',  'bg-violet-50',  'text-violet-600'],
  amber:   ['bg-amber-400',   'bg-amber-50',   'text-amber-600'],
  rose:    ['bg-rose-400',    'bg-rose-50',    'text-rose-600'],
  slate:   ['bg-slate-400',   'bg-slate-50',   'text-slate-600'],
};

function Label({ children }) {
  return <div className="text-[10px] font-medium text-slate-400 mb-1.5 whitespace-nowrap">{children}</div>;
}

const RATIO_COLORS = [
  { chip: 'bg-cyan-400', bar: 'bg-cyan-400' },
  { chip: 'bg-violet-400', bar: 'bg-violet-400' },
  { chip: 'bg-amber-400', bar: 'bg-amber-400' },
];

/// 双值比值：堆叠条 + 图例（+ 括号前的补充说明）
function RatioBar({ parts, note, unit = '%' }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
        {parts.map((p, i) => (
          <div key={i} className={`${RATIO_COLORS[i % 3].bar} transition-all duration-500`}
            style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {parts.map((p, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-[10px] text-slate-500">
            <span className={`w-1.5 h-1.5 rounded-full ${RATIO_COLORS[i % 3].chip}`} />
            {p.label}
            {/* 数值标签内已含数值，无需重复展示 */}
            {!p.numeric && (
              <span className="font-bold tabular-nums text-slate-600">{p.value}{unit}</span>
            )}
          </span>
        ))}
      </div>
      {note && <div className="text-[10px] text-slate-400">{note}</div>}
    </div>
  );
}

/// 24 小时时间轴
function TimeAxis({ ranges }) {
  const ticks = [0, 6, 12, 18, 24];
  return (
    <div>
      <div className="relative h-2 rounded-full bg-slate-100 overflow-hidden">
        {ranges.map(([s, e], i) => {
          // 跨零点区间拆成两段画，避免条子被裁掉
          const segs = e > 24 ? [[s, 24], [0, e - 24]] : [[s, e]];
          return segs.map(([a, b], j) => (
            <div key={`${i}-${j}`} className="absolute top-0 h-full bg-cyan-400/80 rounded-full"
              style={{ left: `${(a / 24) * 100}%`, width: `${((b - a) / 24) * 100}%` }} />
          ));
        })}
      </div>
      <div className="relative mt-1 h-3">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 text-[9px] text-slate-300 tabular-nums"
            style={{ left: `${(t / 24) * 100}%` }}>
            {String(t).padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  );
}

/// 多值枚举胶囊
function Chips({ items, color = 'cyan' }) {
  const [, soft, text] = PALETTE[color] || PALETTE.cyan;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <span key={t} className={`px-2 py-0.5 rounded-lg text-[10.5px] font-medium ${soft} ${text}`}>{t}</span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// 单字段渲染：按值语义挑图形
// ------------------------------------------------------------
function Field({ label, value }) {
  const d = classifyValue(value);

  switch (d.kind) {
    // ① 数组 → 胶囊
    case 'array':
      if (!d.items.length) return <div><Label>{label}</Label><Text>—</Text></div>;
      return <div><Label>{label}</Label><Chips items={d.items} /></div>;

    // ② 纯数字 → 大字计数
    case 'number':
      return (
        <div>
          <Label>{label}</Label>
          <div className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold text-slate-800 tabular-nums leading-none">{d.value.toLocaleString()}</span>
            <span className="text-[10px] text-slate-400">条样本</span>
          </div>
        </div>
      );

    // ③ 时段 → 24 小时轴（判定顺序上必须排在「:」比值之前，见 payloadSemantics）
    case 'time':
      return (
        <div>
          <Label>{label}</Label>
          <div className="text-[11px] font-bold text-slate-700 tabular-nums mb-1.5">{d.str}</div>
          <TimeAxis ranges={d.ranges} />
        </div>
      );

    // ④ 双值比值 → 堆叠条 + 图例
    case 'ratio':
    case 'ratioAlt':
      return (
        <div>
          <Label>{label}</Label>
          <RatioBar parts={d.parts} note={d.note} unit={d.unit} />
        </div>
      );

    // ⑤ 单百分比 → 进度条 + 补充说明
    case 'pct':
      return (
        <div>
          <Label>{label}</Label>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.min(100, d.value)}%` }} />
            </div>
            <span className="text-[11px] font-bold text-cyan-600 tabular-nums shrink-0">{d.value}%</span>
          </div>
          {d.prefix && <div className="text-[10px] text-slate-400 mt-1">{d.prefix}</div>}
        </div>
      );

    // ⑥ 区间（如 3000-5000）
    case 'range':
      return <div><Label>{label}</Label><div className="text-[13px] font-bold text-slate-800 tabular-nums">{d.str}</div></div>;

    // ⑦ 其余文本
    default:
      return <div><Label>{label}</Label><Text>{d.str}</Text></div>;
  }
}

/// 普通文本值
function Text({ children }) {
  return <div className="text-[12.5px] font-semibold text-slate-800 leading-snug break-words">{children}</div>;
}
// ------------------------------------------------------------
// 字段字典（独立三列表）
// ------------------------------------------------------------
function FieldDict({ rows }) {
  const [open, setOpen] = useState(false);
  const cols = Object.keys(rows[0] || {});
  return (
    <div className="rounded-2xl border border-slate-100 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50/70 hover:bg-slate-100/70 transition-colors">
        <span className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
          <Hash className="w-3.5 h-3.5 text-slate-400" />
          字段字典
          <span className="text-[10px] font-medium text-slate-400">{rows.length} 项</span>
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <table className="w-full border-collapse text-[10.5px]">
          <thead>
            <tr className="bg-white">
              {cols.map((c) => (
                <th key={c} className="px-4 py-2 text-left font-medium text-slate-400 whitespace-nowrap border-b border-slate-100">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-slate-50/60 transition-colors">
                {cols.map((c, j) => (
                  <td key={c} className={`px-4 py-2 align-top border-b border-slate-50 last:border-0 ${
                    j === 0 ? 'font-mono font-semibold text-slate-700 whitespace-nowrap'
                      : j === 1 ? 'text-slate-500 whitespace-nowrap'
                        : 'text-slate-500 leading-relaxed'
                  }`}>
                    {fmtVal(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// 分组卡片
// ------------------------------------------------------------
function GroupCard({ name, data, accent }) {
  const entries = Object.entries(data);
  const [bar] = PALETTE[accent] || PALETTE.cyan;
  return (
    <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <span className={`w-1 h-3.5 rounded-full ${bar}`} />
        <span className="text-[11px] font-bold text-slate-700 tracking-wide">{name}</span>
      </div>
      <div className="px-4 pb-4 pt-2 grid grid-cols-2 gap-x-5 gap-y-4">
        {entries.map(([k, v]) => <Field key={k} label={k} value={v} />)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// 视图切换：图表视图 / 原文（在线查看直链）
// ------------------------------------------------------------
function ViewTabs({ view, setView, onFull }) {
  const tab = (id, icon, text) => (
    <button key={id} onClick={() => setView(id)}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
        view === id ? 'bg-white text-cyan-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'
      }`}>
      {icon}{text}
    </button>
  );
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span className="inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-slate-100/80">
        {tab('chart', <BarChart3 className="w-3 h-3" />, '图表')}
        {tab('source', <Braces className="w-3 h-3" />, '原文')}
      </span>
      {onFull && (
        <button type="button" onClick={onFull} title="全屏查看图表"
          className="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg text-[11px] font-bold text-slate-400 hover:text-cyan-600 transition-colors">
          <Maximize2 className="w-3 h-3" />全屏
        </button>
      )}
    </span>
  );
}

// ------------------------------------------------------------
// 主组件
// ------------------------------------------------------------
export default function DataPayloadView({ payload, fileUrl }) {
  // ⚠️ useState 必须在任何 early return 之前调用，否则 hook 顺序会变
  const [view, setView] = useState('chart');   // 'chart' = 图表视图 / 'source' = 原文直链
  const [full, setFull] = useState(false);     // 全屏查看图表

  const fileName = fileNameOf(fileUrl) || 'data.json';

  if (!payload) {
    return (
      <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-700">
        链下数据文件不可用（未关联或读取失败）
      </div>
    );
  }

  const category = payload['分类'] || '链下数据';
  // ⚠️ 这里不要写 .map(([k]) => k)：CORE_KEYS 的元素已经是字符串，
  //    再解构会把「分类」拆成首字「分」，payload['分'] 恒为 undefined。
  const core = CORE_KEYS.filter((k) => payload[k] !== undefined);
  const tags = Array.isArray(payload[TAG_KEY]) ? payload[TAG_KEY] : [];

  // 分组：排除核心键、标签、字段字典、合规声明，以及原文件内置的「图表」节
  //（「图表」节只供在线查看原文件时快速浏览，前端图表视图不展示）
  const featureGroups = Object.entries(payload).filter(([k, v]) => (
    !CORE_KEYS.includes(k) && k !== TAG_KEY && k !== '字段字典' && k !== '合规声明' && k !== CHART_KEY
      && isPlainObject(v)
  ));
  const dict = Array.isArray(payload['字段字典']) ? payload['字段字典'] : null;
  const compliance = isPlainObject(payload['合规声明']) ? payload['合规声明'] : null;

  // 图表主体：卡片视图与全屏共用同一份渲染
  const chartBody = (
    <>
      {/* 核心指标：四宫格 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-slate-50 border-b border-slate-100">
        {core.map((k) => (
          <div key={k} className="px-4 py-3">
            <Label>{k}</Label>
            <div className="text-[13px] font-bold text-slate-800 tabular-nums leading-tight break-words">
              {k === '记录条数' ? Number(payload[k]).toLocaleString() : fmtVal(payload[k])}
            </div>
          </div>
        ))}
      </div>

      {/* 兴趣标签 */}
      {tags.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400 shrink-0">
            <TagIcon className="w-3 h-3" />{TAG_KEY}
          </span>
          <Chips items={tags} color="violet" />
        </div>
      )}

      {/* 分组卡片流 */}
      <div className="p-4 space-y-3">
        {featureGroups.map(([name, v], i) => (
          <GroupCard key={name} name={name} data={v}
            accent={['cyan', 'emerald', 'violet', 'amber'][i % 4]} />
        ))}
        {dict && <FieldDict rows={dict} />}
        {compliance && (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
            <div className="flex items-center gap-2 mb-2.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-[11px] font-bold text-emerald-700">合规声明</span>
            </div>
            <div className="space-y-2">
              {Object.entries(compliance).map(([k, v]) => (
                <div key={k} className="flex gap-2 text-[10.5px] leading-relaxed">
                  <span className="font-medium text-emerald-600/80 shrink-0 w-16">{k}</span>
                  <span className="text-slate-600">{fmtVal(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );

  // 全屏查看图表 —— 走 createPortal 挂到 body，避免被卡片的 overflow 裁掉
  const overlay = full ? createPortal(
    <div className="fixed inset-0 z-[90] bg-slate-900/45 backdrop-blur-sm p-4 sm:p-8 overflow-auto">
      <div className="max-w-5xl mx-auto bg-white rounded-[2rem] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-slate-100">
          <span className="flex items-center gap-2 min-w-0">
            <BarChart3 className="w-4 h-4 text-cyan-500 shrink-0" />
            <span className="text-sm font-bold text-slate-800 shrink-0">{category}</span>
            <span className="font-mono text-[11px] text-slate-400 truncate">{fileName}</span>
          </span>
          <button type="button" onClick={() => setFull(false)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors shrink-0">
            <X className="w-3.5 h-3.5" />关闭
          </button>
        </div>
        <div className="p-5">{chartBody}</div>
      </div>
    </div>, document.body,
  ) : null;

  // 原文视图：链下原文件的在线查看入口
  // ★ 原始数据只存链下（本地数据文件），不上链、不提供下载；点击链接
  //   新标签页直接打开原文件（文件内附「图表」节，打开后可先浏览概貌）。
  if (view === 'source') {
    return (
      <div className="space-y-2">
        <ViewTabs view={view} setView={setView} onFull={() => setFull(true)} />
        <div className="rounded-2xl border border-slate-100 bg-white px-5 py-6">
          <div className="flex items-center gap-2 mb-3 min-w-0">
            <Braces className="w-4 h-4 text-cyan-500 shrink-0" />
            <span className="text-[12.5px] font-bold text-slate-800 shrink-0">{category}</span>
            <span className="text-[10.5px] font-mono text-slate-400 truncate">{fileName}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            原始数据存储于链下数据文件，链上只保留索引与摘要；本系统不提供下载，仅支持在线查看。
          </p>
          <p className="text-[10px] leading-relaxed text-slate-400 mt-1 mb-4">
            原文件内附「图表」节（文本图表，由数据字段确定性生成，前端不展示），打开后可先浏览数据概貌。
          </p>
          <a href={fileUrl} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-600 text-white text-[11.5px] font-bold transition-colors">
            <ExternalLink className="w-3.5 h-3.5" />
            在线查看原文件
          </a>
        </div>
        {overlay}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
      {/* 顶栏：分类 + 文件名 + 视图切换 */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50/80 border-b border-slate-100">
        <span className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0" />
          <span className="text-[11px] font-bold text-slate-700 shrink-0">{category}</span>
          <span className="text-[10.5px] font-mono text-slate-400 truncate">{fileName}</span>
        </span>
        <ViewTabs view={view} setView={setView} onFull={() => setFull(true)} />
      </div>

      {chartBody}
      {overlay}
    </div>
  );
}
