// ============================================================
// AuditCharts.jsx —— 审计日志的图表化概览
// ------------------------------------------------------------
// 监管端「审计日志」原先只有一张纯表格。本组件在表格上方补一层图表概览：
//   · KPI 条        —— 记录总数 / 累计分账 / 涉及字段 / 涉及企业
//   · 事件类型分布   —— 环形图（各类型笔数占比）
//   · 企业分账金额   —— 横向条形（按企业聚合的 ETH 分账额）
//
// 传入的就是**已经过类型 / 时间筛选**的日志数组，因此图表与筛选联动；
// 本组件只做展示层聚合，不参与任何链上判断，也不改动数据源。
// ============================================================
import { useMemo } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { FileText, Coins, Database as DatabaseIcon, Building2 } from 'lucide-react';
import { fmtEth, shortAddr } from '../config.js';

// 事件类型固定配色（与 TypeBadge 的语义保持一致）
const TYPE_COLORS = {
  '字段上链': '#8B5CF6',
  '授权': '#06B6D4',
  '押金充值': '#F59E0B',
  '调用分账': '#10B981',
  '非法拦截': '#F43F5E',
};
const FALLBACK_COLORS = ['#06B6D4', '#10B981', '#8B5CF6', '#F59E0B', '#F43F5E', '#0EA5E9'];

// ------------------------------------------------------------
function Kpi({ label, value, unit, icon: Icon, accent, bg }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl bg-white border border-slate-100">
      <span className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center shrink-0`}>
        <Icon className={`w-4 h-4 ${accent}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-medium text-slate-400 truncate">{label}</span>
        <span className="block text-[15px] font-bold text-slate-800 tabular-nums leading-tight truncate">
          {value}<span className="text-[11px] font-medium text-slate-400 ml-1">{unit}</span>
        </span>
      </span>
    </div>
  );
}

// ------------------------------------------------------------
export default function AuditCharts({ logs = [] }) {
  const agg = useMemo(() => {
    const byType = new Map();
    const byEnt = new Map();
    const fields = new Set();
    let totalWei = 0n;
    let amountRecords = 0;

    for (const l of logs) {
      byType.set(l.type, (byType.get(l.type) || 0) + 1);
      if (l.fieldId !== null && l.fieldId !== undefined) fields.add(l.fieldId);

      let w = 0n;
      if (l.amount) { try { w = BigInt(l.amount); } catch { w = 0n; } }
      if (w > 0n) {
        totalWei += w;
        amountRecords += 1;
        if (l.enterprise) byEnt.set(l.enterprise, (byEnt.get(l.enterprise) || 0n) + w);
      }
    }

    const typeRows = [...byType.entries()]
      .map(([name, value], i) => ({ name, value, color: TYPE_COLORS[name] || FALLBACK_COLORS[i % FALLBACK_COLORS.length] }))
      .sort((a, b) => b.value - a.value);

    const entRows = [...byEnt.entries()]
      .map(([addr, wei]) => ({ addr, wei }))
      .sort((a, b) => (b.wei > a.wei ? 1 : b.wei < a.wei ? -1 : 0));

    const maxWei = entRows.length ? entRows[0].wei : 0n;

    return {
      total: logs.length, totalWei, amountRecords,
      fieldCount: fields.size, entCount: byEnt.size,
      typeRows, entRows, maxWei,
    };
  }, [logs]);

  if (!logs.length) return null;

  const pct = (v) => (agg.total ? Math.round((v / agg.total) * 100) : 0);

  return (
    <div className="mb-8 space-y-6">
      {/* ① KPI 条 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Kpi label="审计记录总数" value={agg.total} unit="条" icon={FileText}
          accent="text-cyan-600" bg="bg-cyan-50" />
        <Kpi label="累计分账金额" value={fmtEth(agg.totalWei.toString())} unit="ETH" icon={Coins}
          accent="text-emerald-600" bg="bg-emerald-50" />
        <Kpi label="涉及链上字段" value={agg.fieldCount} unit="个" icon={DatabaseIcon}
          accent="text-violet-600" bg="bg-violet-50" />
        <Kpi label="涉及企业节点" value={agg.entCount} unit="个" icon={Building2}
          accent="text-amber-600" bg="bg-amber-50" />
      </div>

      {/* ② 类型分布（环形）+ 企业分账（横条） */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 环形图 */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5">
          <div className="text-xs font-bold text-slate-700 mb-1">事件类型分布</div>
          <div className="text-[11px] text-slate-400 mb-3">按链上事件笔数统计</div>
          <div className="flex items-center gap-4">
            <div className="w-[150px] h-[150px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={agg.typeRows} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" innerRadius={42} outerRadius={68} paddingAngle={2} stroke="none">
                    {agg.typeRows.map((t) => <Cell key={t.name} fill={t.color} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [`${v} 笔`, n]}
                    contentStyle={{ borderRadius: 14, border: 'none', boxShadow: '0 8px 30px rgb(0,0,0,0.08)', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="flex-1 min-w-0 space-y-2">
              {agg.typeRows.map((t) => (
                <li key={t.name} className="flex items-center gap-2 text-[11.5px]">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.color }} />
                  <span className="text-slate-600 truncate flex-1">{t.name}</span>
                  <span className="font-bold text-slate-800 tabular-nums">{t.value}</span>
                  <span className="text-slate-400 tabular-nums w-9 text-right">{pct(t.value)}%</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* 企业分账横条 */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5">
          <div className="text-xs font-bold text-slate-700 mb-1">企业分账金额</div>
          <div className="text-[11px] text-slate-400 mb-3">按调用分账事件聚合</div>
          {agg.entRows.length === 0 ? (
            <div className="h-[150px] flex items-center justify-center text-[11px] text-slate-300">
              暂无带金额的审计记录
            </div>
          ) : (
            <ul className="space-y-3.5 pt-1">
              {agg.entRows.slice(0, 6).map((e) => {
                const ratio = agg.maxWei > 0n ? Number((e.wei * 1000n) / agg.maxWei) / 1000 : 0;
                return (
                  <li key={e.addr}>
                    <div className="flex items-center justify-between text-[11.5px] mb-1.5">
                      <span className="font-mono text-slate-500">{shortAddr(e.addr)}</span>
                      <span className="font-bold text-slate-800 tabular-nums">{fmtEth(e.wei.toString())} ETH</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-[width] duration-500"
                        style={{ width: `${Math.max(ratio * 100, 2)}%` }} />
                    </div>
                  </li>
                );
              })}
              {agg.entRows.length > 6 && (
                <li className="text-[10.5px] text-slate-400 pt-0.5">另有 {agg.entRows.length - 6} 个企业节点…</li>
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
