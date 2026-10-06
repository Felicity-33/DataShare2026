// ============================================================
// RegulatorDashboard.jsx —— 监管工作台
// ------------------------------------------------------------
// 侧边栏：全局概览 / 审计日志 / 异常监控（贴边悬浮·可收缩）
// 顶部：灵动岛（右上角定位）
// 功能：
//   - 全局概览：数据授权总量 + 全局分账总额 + 已上链数据字段
//              + 全网交易量趋势（近 7 日面积图）
//   - 审计日志：类型筛选 + 时间筛选（全部 / 今天 / 近7天 / 自定义年月日时分秒）
//              + 点击行看详情
//   - 异常监控：原因筛选 + 时间筛选 + 高亮告警
//   - 争议裁决（v4.5）：结构化「裁决说明书」—— 事实认定 / 证据分析 /
//     适用规则（模拟合规依据库引用）/ 裁量过程，行内可折叠查看详情，
//     点「裁决」先阅说明书并勾选确认后才发起链上裁决交易，说明书自动存档并并入审计报告
// 权限：裁决与失信标记为唯一写操作，其余只读审计
// ============================================================
import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area
} from 'recharts';
import {
  Globe, FileText, AlertTriangle, Activity, TrendingUp, Database as DatabaseIcon,
  Scale, ShieldCheck, Download, Search, Sparkles, RefreshCw,
  ChevronDown, ChevronUp, FileCheck, Gavel
} from 'lucide-react';
import { shortAddr, shortHash, fmtEth, fmtTime, parseTxError, loadAllData, emitGlobalError, ACTIVE_NETWORK } from '../config.js';
import { auditSummary, AI_DISCLAIMER } from '../ai.js';
import { buildAllCharts, useChainEvents, useBlockNumber } from '../hooks/useWeb3.js';
// ★ 合规依据库（v4.5）：裁决说明书的「依据说明」数据源（模拟引用，不具真实法律效力）
import {
  LEGAL_NOTICE, REGULATION_MAP, REG_TAGS,
  saveRulingDoc, getRulingDoc, getRulingDocs,
} from '../regulations.js';
// ★ 通知中心（v4.6 苹果精简版）：监管端只推核心事件（新申诉待裁决 / 全网拦截汇总），
//   点击直达功能页；裁决归档由监管本人操作产生，不再推送通知
import {
  pushNotifications, nfDisputeRaised, nfBlockedDigest, markRead,
} from '../notifications.js';
import { buildAuditReportMarkdown, buildAuditReportHTML,
  downloadTextFile, reportFileName, reportFileNameHtml
} from '../auditReport.js';
// ★ 审计报告的链环境标识：模拟模式需展示「演示模拟链 / 模拟合约地址」，
//   与链上模式的 Ganache 网络区分，避免报告在两种模式下写成同一条链
import { SIM_CHAIN_ID, SIM_CONTRACT_ADDRESS } from '../sim/mockChain.js';
import Sidebar from './Sidebar';
import SettingsModal from './SettingsModal';
import HelpModal from './HelpModal';
import ProofDrawer from './ProofDrawer';
import Hint from './Hint.jsx';
import WelcomeBanner from './WelcomeBanner';
import AuditCharts from './AuditCharts.jsx';


import Header from './Header';

const NAV = [
  { key: 'overview', label: '全局概览', icon: Globe },
  { key: 'proofs', label: '凭证审计', icon: ShieldCheck },
  { key: 'audit', label: '审计日志', icon: FileText },
  { key: 'disputes', label: '争议裁决', icon: Scale },
  { key: 'alerts', label: '异常监控', icon: AlertTriangle }
];

const PROOF_STATUS_OPTIONS = ['全部', '托管中', '已提前结算', '争议中', '已放款', '已退款'];

const AUDIT_TYPE_OPTIONS = ['全部', '字段上链', '授权', '押金充值', '调用分账', '非法拦截'];
const TIME_MODE_OPTIONS = ['全部', '今天', '近 7 天', '自定义'];
const EMPTY_DATE = { y: '', mo: '', d: '', h: '', mi: '', s: '' };

function Empty({ text }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-slate-300">
      <svg className="w-12 h-12 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="5" y1="5" x2="19" y2="19" />
      </svg>
      <p className="text-sm text-slate-400">{text}</p>
    </div>
  );
}

// ============================================================
// ★ 裁决说明书共用子组件（v4.5）
// ------------------------------------------------------------
// LegalBanner      ：模拟引用免责横幅（说明书 / 折叠详情 / 报告口径一致）
// RuleCard         ：单条依据条目（编号 + 类型徽标 + 条款 + 要旨 + 适用场景）
// RulingBasisView  ：四要素结构化渲染（事实认定 / 证据分析 / 适用规则 / 裁量过程）
// RulingModal      ：裁决说明书弹窗（阅读 → 勾选确认 → 二选一裁决）
// ============================================================

// 模拟引用免责横幅：所有展示依据的地方都必须携带
function LegalBanner({ compact = false }) {
  return (
    <div className={`flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2.5'}`}>
      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} leading-relaxed font-medium`}>{LEGAL_NOTICE}</p>
    </div>
  );
}

// 单条依据条目卡片（compact = 折叠详情用的紧凑版）
function RuleCard({ id, compact = false }) {
  const r = REGULATION_MAP[id];
  if (!r) return null; // 依据库中不存在的 id 静默跳过，避免渲染报错
  const tag = REG_TAGS[r.tag];
  return (
    <div className={`rounded-xl border border-slate-100 bg-slate-50/60 ${compact ? 'px-2.5 py-1.5' : 'px-3 py-2.5'}`}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-mono font-bold text-slate-500 bg-white border border-slate-200 rounded px-1.5 py-0.5">{r.id}</span>
        <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 border ${tag?.cls || 'bg-slate-100 text-slate-500 border-slate-200'}`}>{tag?.label || '依据'}</span>
        <span className={`text-slate-700 font-bold ${compact ? 'text-[11px]' : 'text-xs'}`}>{r.name}</span>
        <span className={`text-slate-400 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{r.article}</span>
      </div>
      {!compact && <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">「{r.gist}」</p>}
      {!compact && <p className="mt-1 text-[10px] text-cyan-700 bg-cyan-50/70 rounded px-2 py-1 inline-block">适用：{r.usage}</p>}
    </div>
  );
}

// 依据编号徽标组（用于裁量路径卡片底部标注各路径引用的规则）
function RuleIdChips({ ids }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <span className="text-[10px] text-slate-400">引用依据：</span>
      {ids.map((id) => (
        <span key={id} className="text-[10px] font-mono font-bold text-cyan-700 bg-cyan-50 border border-cyan-100 rounded px-1.5 py-0.5">{id}</span>
      ))}
    </div>
  );
}

// 四要素结构化视图：compact = 表格行内折叠用的紧凑排版
function RulingBasisView({ basis, compact = false }) {
  const sectionTitle = (num, title) => (
    <div className={`flex items-center gap-2 ${compact ? 'mb-1.5' : 'mb-2.5'}`}>
      <span className={`rounded-lg bg-slate-900 text-white font-bold flex items-center justify-center ${compact ? 'w-4 h-4 text-[9px]' : 'w-5 h-5 text-[10px]'}`}>{num}</span>
      <span className={`font-bold text-slate-800 ${compact ? 'text-[11px]' : 'text-xs'}`}>{title}</span>
    </div>
  );
  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-5'}>
      {/* ① 事实认定：程序时间线 */}
      <div>
        {sectionTitle('①', '事实认定')}
        <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
          {basis.facts.map((f, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className={`shrink-0 font-mono text-slate-400 ${compact ? 'text-[9px] pt-0.5' : 'text-[10px] pt-0.5'}`}>{f.time}</span>
              <span className={`text-slate-600 leading-relaxed ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{f.text}</span>
            </div>
          ))}
        </div>
      </div>
      {/* ② 证据分析 */}
      <div>
        {sectionTitle('②', '证据分析')}
        <div className={compact ? 'space-y-1' : 'space-y-2'}>
          {basis.evidence.map((e, i) => (
            <div key={i} className={compact ? '' : 'flex items-start gap-2'}>
              <span className={`shrink-0 text-slate-500 font-bold ${compact ? 'text-[10px]' : 'text-[11px] w-32'}`}>{e.label}：</span>
              <span className={`text-slate-700 font-medium ${compact ? 'text-[10px] mr-1' : 'text-[11px]'} `}>{e.value}</span>
              {!compact && <span className="text-[10px] text-slate-400 leading-relaxed flex-1">{e.note}</span>}
            </div>
          ))}
        </div>
      </div>
      {/* ③ 适用规则（基础规则；路径专属规则在裁量过程中标注） */}
      <div>
        {sectionTitle('③', '适用规则（模拟引用）')}
        <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
          {basis.baseRules.map((id) => <RuleCard key={id} id={id} compact={compact} />)}
        </div>
      </div>
      {/* ④ 裁量过程：两条路径的执行影响与各自依据 */}
      <div>
        {sectionTitle('④', '裁量过程')}
        <div className={`grid gap-2 ${compact ? '' : 'md:grid-cols-2'}`}>
          {[basis.paths.refund, basis.paths.payout].map((p) => (
            <div key={p.title} className={`rounded-xl border border-slate-100 bg-white ${compact ? 'px-2.5 py-1.5' : 'px-3 py-3'}`}>
              <div className={`font-bold text-slate-700 ${compact ? 'text-[10px]' : 'text-[11px] mb-1.5'}`}>{p.title}</div>
              <ul className={`${compact ? 'space-y-0.5' : 'space-y-1 mb-2'}`}>
                {p.steps.map((s, i) => (
                  <li key={i} className={`text-slate-500 leading-relaxed flex items-start gap-1 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
                    <span className="text-slate-300 mt-px">·</span><span>{s}</span>
                  </li>
                ))}
              </ul>
              {!compact && <RuleIdChips ids={p.ruleIds} />}
            </div>
          ))}
        </div>
      </div>
      {/* 免责横幅（必须随依据展示） */}
      <LegalBanner compact={compact} />
    </div>
  );
}

// 裁决说明书弹窗：阅读四要素 → 勾选确认 → 二选一裁决（不确认无法发交易）
function RulingModal({ modal, confirm, onConfirmChange, onClose, onRule }) {
  if (!modal) return null;
  const { dispute: d, basis } = modal;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* 遮罩：仅透明度过渡 */}
      <div className="absolute inset-0 bg-slate-900/40 animate-fade-in" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col animate-fade-in">
        {/* 弹窗头 */}
        <div className="flex items-center gap-3 px-7 pt-6 pb-4 border-b border-slate-100 shrink-0">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white shadow-lg">
            <Gavel className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-slate-800">裁决说明书 · 托管单 #{d.escrowId}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">字段「{d.fieldName}」· 争议金额 {fmtEth(d.amount)} ETH · 监管 {shortAddr(d.regulator || '')}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-50 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors flex items-center justify-center text-lg leading-none">×</button>
        </div>
        {/* 说明书正文（四要素 + 免责横幅） */}
        <div className="flex-1 overflow-y-auto px-7 py-5">
          <RulingBasisView basis={basis} />
        </div>
        {/* 弹窗脚：确认勾选 + 二选一裁决 */}
        <div className="px-7 py-4 border-t border-slate-100 shrink-0 space-y-3">
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => onConfirmChange(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-cyan-600"
            />
            <span className="text-[11px] text-slate-600 leading-relaxed">
              我已完整阅读上述裁决说明书，确认事实认定与证据分析无误，将依据所列规则作出裁决。
            </span>
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onRule(true)}
              disabled={!confirm}
              title="申诉成立：费用退回企业押金池"
              className="flex-1 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              确认裁决：退款给企业
            </button>
            <button
              onClick={() => onRule(false)}
              disabled={!confirm}
              title="申诉驳回：费用放款给数据所有者，并记一次恶意申诉"
              className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
            >
              确认裁决：放款给用户
            </button>
          </div>
          <p className="text-[10px] text-slate-400 text-center">确认后说明书自动存档，并随监管审计报告一并导出；裁决上链后即时生效（终局）。</p>
        </div>
      </div>
    </div>
  );
}

function DateTimePicker({ value, onChange }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const now = new Date();
  const years = [];
  for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 1; y++) years.push(y);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);
  const seconds = Array.from({ length: 60 }, (_, i) => i);
  const sel = 'px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 transition-all';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="text-xs text-slate-500 whitespace-nowrap">时间点</label>
      <select value={value.y} onChange={(e) => set('y', e.target.value)} className={sel}>
        <option value="">年</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      <span className="text-xs text-slate-400">年</span>
      <select value={value.mo} onChange={(e) => set('mo', e.target.value)} className={sel}>
        <option value="">月</option>{months.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <span className="text-xs text-slate-400">月</span>
      <select value={value.d} onChange={(e) => set('d', e.target.value)} className={sel}>
        <option value="">日</option>{days.map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      <span className="text-xs text-slate-400">日</span>
      <select value={value.h} onChange={(e) => set('h', e.target.value)} className={sel}>
        <option value="">时</option>{hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
      </select>
      <span className="text-xs text-slate-400">时</span>
      <select value={value.mi} onChange={(e) => set('mi', e.target.value)} className={sel}>
        <option value="">分</option>{minutes.map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
      </select>
      <span className="text-xs text-slate-400">分</span>
      <select value={value.s} onChange={(e) => set('s', e.target.value)} className={sel}>
        <option value="">秒</option>{seconds.map((s) => <option key={s} value={s}>{String(s).padStart(2, '0')}</option>)}
      </select>
      <span className="text-xs text-slate-400">秒</span>
      <span className="text-xs text-slate-400 ml-1">之后</span>
    </div>
  );
}

export default function RegulatorDashboard({ web3, onNotice, onTx, mode, onToggleMode }) {
  const { contract, account } = web3;

  const [tab, setTab] = useState('overview');
  const [collapsed, setCollapsed] = useState(false);
  const [pending, setPending] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);      // ★ 使用说明 / 疑问处   // ★ 设置弹窗
  const blockNumber = useBlockNumber(web3.provider);          // ★ 实时区块高度

  const [stats, setStats] = useState({ authTotal: 0, distributeTotal: '0', fieldCount: 0 });
  // ★ 托管结算统计 / 争议列表 / 企业信誉
  const [settlement, setSettlement] = useState({ withdrawn: '0', refunded: '0', pending: '0', escrowCount: 0, disputePending: 0 });
  const [disputes, setDisputes] = useState([]);
  const [enterpriseRep, setEnterpriseRep] = useState([]);
  // ★ 凭证审计：全部托管结算单 + 筛选 + 存证抽屉 + 链上参数
  const [allEscrows, setAllEscrows] = useState([]);
  const [proofRow, setProofRow] = useState(null);
  const [proofStatus, setProofStatus] = useState('全部');
  const [proofKeyword, setProofKeyword] = useState('');
  const [chainInfo, setChainInfo] = useState({ challenge: null, stdCall: null, stdDay: null });
  const [reporting, setReporting] = useState(false);
  const [chartData, setChartData] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [selectedLog, setSelectedLog] = useState(null);
  const [lastSync, setLastSync] = useState(null);   // ★ 最后一次链上同步时间（异常监控卡片展示）

  const [auditType, setAuditType] = useState('全部');
  const [auditTimeMode, setAuditTimeMode] = useState('全部');
  const [auditDate, setAuditDate] = useState(EMPTY_DATE);

  const [alertReason, setAlertReason] = useState('全部');
  const [alertTimeMode, setAlertTimeMode] = useState('全部');
  const [alertDate, setAlertDate] = useState(EMPTY_DATE);

  // ★ 裁决说明书（v4.5）：行内折叠详情的争议单 id / 弹窗数据 / 确认勾选 / 提交中状态
  const [expandedDispute, setExpandedDispute] = useState(null);
  const [rulingModal, setRulingModal] = useState(null); // { dispute, basis }
  const [rulingConfirm, setRulingConfirm] = useState(false);

  const load = useCallback(async () => {
    if (!contract) return;
    try {
      // ★ 先加载链下数据文件（凭证审计抽屉要展示它）
      await loadAllData();
      const authTotal = Number(await contract.totalAuthorizations());
      const distributeTotal = fmtEth(await contract.totalDistributed());
      const fieldCount = Number(await contract.getFieldsCount());
      setStats({ authTotal, distributeTotal, fieldCount });

      const [fieldReg, permGranted, permRevoked, deposits, revenue, blockedEvts] = await Promise.all([
        contract.queryFilter('FieldRegistered', 0, 'latest'),
        contract.queryFilter('PermissionGranted', 0, 'latest'),
        contract.queryFilter('PermissionRevoked', 0, 'latest'),
        contract.queryFilter('DepositMade', 0, 'latest'),
        contract.queryFilter('RevenueDistributed', 0, 'latest'),
        contract.queryFilter('AccessAttemptBlocked', 0, 'latest'),
      ]);

      const logs = [];
      const pushLog = async (ev, type) => {
        const b = await ev.getBlock();
        logs.push({
          type, blockNumber: ev.blockNumber, txHash: ev.transactionHash, ts: b.timestamp,
          fieldId: ev.args.fieldId !== undefined ? Number(ev.args.fieldId) : null,
          user: ev.args.user || ev.args.owner || null,
          enterprise: ev.args.enterprise || null,
          amount: ev.args.amount ? ev.args.amount.toString() : null,
          reason: ev.args.reason || null,
        });
      };
      for (const ev of fieldReg) await pushLog(ev, '字段上链');
      for (const ev of permGranted) await pushLog(ev, '授权');
      for (const ev of permRevoked) await pushLog(ev, '撤销授权');
      for (const ev of deposits) await pushLog(ev, '押金充值');
      for (const ev of revenue) await pushLog(ev, '调用分账');
      for (const ev of blockedEvts) await pushLog(ev, '非法拦截');

      logs.sort((a, b) => b.ts - a.ts);
      setAuditLogs(logs);
      setBlocked(logs.filter((l) => l.type === '非法拦截'));

      // ★ 托管结算单：读取全部 EscrowCreated，逐条取最新状态（争议裁决 + 资金视角）
      const fieldCountAll = Number(await contract.getFieldsCount());
      const nameMap = {};
      const refMap = {};
      for (let i = 0; i < fieldCountAll; i++) {
        const f = await contract.fields(i);
        nameMap[i] = f.name;
        refMap[i] = f.dataRef;
      }
      const escEvs = await contract.queryFilter('EscrowCreated', 0, 'latest');
      const escAll = [];
      for (const ev of escEvs) {
        const id = Number(ev.args.escrowId);
        const e = await contract.escrows(id);
        const b = await ev.getBlock();
        escAll.push({
          escrowId: id,
          fieldId: Number(e.fieldId),
          fieldName: nameMap[Number(e.fieldId)] || `字段#${Number(e.fieldId)}`,
          dataRef: refMap[Number(e.fieldId)] || '',
          user: e.user,
          enterprise: e.enterprise,
          amount: e.amount.toString(),
          deliveryHash: e.deliveryHash,
          confirmedAt: Number(e.confirmedAt),
          disputed: e.disputed,
          settled: e.settled,
          refunded: e.refunded,
          disputeReason: e.disputeReason,
          ts: b.timestamp,
        });
      }
      const sortedEsc = [...escAll].sort((a, b) => b.ts - a.ts);
      setAllEscrows(sortedEsc);

      // ★ 裁决时间线（v4.5）：申诉 / 裁决事件的精确时间戳与出证交易，
      //   供「裁决说明书」展示完整程序链（托管创建 → 挑战期申诉 → 裁决归档）
      const [drEvs, rsEvs] = await Promise.all([
        contract.queryFilter('DisputeRaised', 0, 'latest'),
        contract.queryFilter('DisputeResolved', 0, 'latest'),
      ]);
      const raisedMap = {};
      for (const ev of drEvs) {
        const b = await ev.getBlock();
        raisedMap[Number(ev.args.escrowId)] = { ts: b.timestamp, reason: ev.args.reason, txHash: ev.transactionHash };
      }
      const resolvedMap = {};
      for (const ev of rsEvs) {
        const b = await ev.getBlock();
        resolvedMap[Number(ev.args.escrowId)] = {
          ts: b.timestamp, refunded: ev.args.refundedToEnterprise,
          regulator: ev.args.regulator, amount: ev.args.amount.toString(), txHash: ev.transactionHash,
        };
      }
      // 争议列表 = 仍处于 disputed 状态的托管单（裁决后 disputed 保持 true，以 settled 区分已决）
      const disputeRows = sortedEsc.filter((e) => e.disputed).map((e) => ({
        ...e,
        disputeTs: raisedMap[e.escrowId]?.ts ?? null,
        disputeTxHash: raisedMap[e.escrowId]?.txHash ?? '',
        resolvedTs: resolvedMap[e.escrowId]?.ts ?? null,
        resolvedRefunded: resolvedMap[e.escrowId]?.refunded ?? null,
        regulator: resolvedMap[e.escrowId]?.regulator ?? null,
      }));
      setDisputes(disputeRows);

      const settledAmount = escAll.filter((e) => e.settled);
      setSettlement({
        withdrawn: fmtEth(await contract.totalWithdrawn()),
        refunded: fmtEth(await contract.totalRefunded()),
        pending: fmtEth(escAll.filter((e) => !e.settled).reduce((s, e) => s + BigInt(e.amount), 0n)),
        escrowCount: escAll.length,
        disputePending: escAll.filter((e) => e.disputed && !e.settled).length,
        settledCount: settledAmount.length,
      });

      // ★ 企业信誉分：按参与过调用的企业逐个查询（含被拦截 / 恶意申诉败诉统计）
      const ents = Array.from(new Set(escAll.map((e) => e.enterprise)));
      const repList = [];
      for (const addr of ents) {
        const r = await contract.reputationOf(addr);
        repList.push({
          address: addr,
          score: Number(r[0]), success: Number(r[1]),
          blocked: Number(r[2]), lost: Number(r[3]), isFlagged: r[4],
          flagReason: await contract.flagReason(addr),
        });
      }
      setEnterpriseRep(repList.sort((a, b) => a.score - b.score));

      // ★ 链上参数（供审计报告使用）
      const safeRead = async (fn) => { try { return await fn(); } catch { return null; } };
      const [challenge, stdCall, stdDay] = await Promise.all([
        safeRead(() => contract.CHALLENGE_PERIOD()),
        safeRead(() => contract.STANDARD_PRICE_PER_CALL()),
        safeRead(() => contract.STANDARD_PRICE_PER_DAY()),
      ]);
      setChainInfo({
        challenge: challenge === null ? null : Number(challenge),
        stdCall: stdCall === null ? null : Number(stdCall) / 1e18,
        stdDay: stdDay === null ? null : Number(stdDay) / 1e18,
      });

      // ============================================================
      // ★ 通知中心同步（v4.6 苹果精简版）：监管端只推两类核心通知
      //   新申诉待裁决（核心待办）/ 全网拦截汇总（聚合单条）；
      //   裁决归档由监管本人操作产生，不再推送（裁决动作时直接闭合
      //   「待裁决」红点，见 handleResolve）。
      //   （重复推送按 id 去重；账户首次同步自动建立「已读基线」）
      // ============================================================
      try {
        const candidates = [];
        // 1) 核心待办：待裁决申诉保持未读红点，点击直达「争议裁决」页
        disputeRows.forEach((d) => {
          if (!d.settled) {
            candidates.push(nfDisputeRaised({
              escrowId: d.escrowId, fieldName: d.fieldName,
              amount: fmtEth(d.amount), reason: d.disputeReason,
              ts: (d.disputeTs || d.ts) * 1000,
            }, 'disputes', 'regulator'));
          }
        });
        // 2) 异常拦截：全网拦截聚合为一条通报（新拦截发生时自动更新并点亮）
        const blockedLogs = logs.filter((l) => l.type === '非法拦截');
        if (blockedLogs.length > 0) {
          candidates.push(nfBlockedDigest({
            count: blockedLogs.length,
            latestReason: blockedLogs[0]?.reason, // logs 已按时间倒序，[0] 即最近一次
            ts: blockedLogs[0]?.ts * 1000,
          }, 'alerts'));
        }
        // drop：清洗历史版本已淘汰的通知（裁决归档 / 逐条拦截）
        pushNotifications(account, candidates, (n) => (
          /^ruling:\d+:done$/.test(n.id) || /^blocked:fld/.test(n.id)
        ));
      } catch (e) {
        console.error('通知同步失败', e); // 通知失败不影响主数据加载
      }

      setLastSync(Date.now()); // ★ 全量同步完成，异常监控卡片显示「最后同步」时刻
    } catch (e) {
      console.error('加载监管数据失败', e);
      // ★ 同步失败不能静默——进入全局异常通道；文案按运行模式分支（模拟模式不提 Ganache）
      emitGlobalError(web3.isSim
        ? '演示数据同步失败：请刷新页面恢复；若仍异常，请在右上角设置中重置演示数据'
        : `监管数据同步失败：请确认钱包已连接 ${ACTIVE_NETWORK.label}（本地演示需 Ganache 在 7545 端口运行）后刷新页面`);
    }
  }, [contract]);

  useEffect(() => { load(); }, [load, web3.eventsVersion]);

  // ============================================================
  // ★ 异常监控同步兜底（出块即刷新）：
  //   事件自动刷新依赖 MetaMask 的日志过滤器（eth_getFilterChanges），
  //   长时间演示中过滤器可能被钱包 / 浏览器静默丢弃，导致拦截记录不再上榜、
  //   只能手动刷新页面。这里改用已有的区块高度轮询（3 秒）做第二通道：
  //   Ganache 空闲不出块、出块即代表发生了交易 → 强制全量刷新，
  //   不依赖事件订阅的存活，任何拦截都会在数秒内出现在异常监控。
  // ============================================================
  const seenBlockRef = useRef(null);
  useEffect(() => {
    if (blockNumber === null || blockNumber === seenBlockRef.current) return;
    const firstRead = seenBlockRef.current === null;
    seenBlockRef.current = blockNumber;
    if (!firstRead) load(); // 首次读到高度时挂载流程已触发 load()，跳过避免重复
  }, [blockNumber, load]);

  // ★ 生成并下载审计报告（纯前端，无后端依赖）
  //   format = 'html' → 图表化 HTML（可打印 / 另存为 PDF）  'md' → Markdown 纯文本
  const handleExportReport = async (format = 'html') => {
    setReporting(true);
    try {
      const payload = {
        chainInfo: {
          contractVersion: web3.contractVersion,
          versionOk: web3.versionOk,
          blockNumber,
          challenge: chainInfo.challenge,
          stdCall: chainInfo.stdCall,
          stdDay: chainInfo.stdDay,
        },
        // ★ 链环境：模拟模式显示演示模拟链与模拟合约地址，链上模式交给报告默认值（ACTIVE_NETWORK）
        network: web3.isSim
          ? {
            label: '演示模拟链', chainId: SIM_CHAIN_ID,
            rpcUrl: '浏览器内模拟链（无真实 RPC 节点）',
            contractAddress: SIM_CONTRACT_ADDRESS,
          }
          : undefined,
        stats,
        settlement,
        escrows: allEscrows,
        disputes,
        alerts: blocked,
        auditLogs,
        reputation: enterpriseRep,
        rulingDocs: getRulingDocs(), // ★ 已存档的裁决说明书（v4.5，随报告并档导出）
      };
      if (format === 'md') {
        downloadTextFile(reportFileName(), buildAuditReportMarkdown(payload));
        onNotice?.('success', 'Markdown 审计报告已生成并开始下载');
      } else {
        downloadTextFile(reportFileNameHtml(), buildAuditReportHTML(payload), 'text/html;charset=utf-8');
        onNotice?.('success', '图表版审计报告已生成并开始下载（浏览器打开可打印为 PDF）');
      }
    } catch (e) {
      onNotice?.('error', '报告生成失败：' + (e?.message || '未知错误'));
    } finally {
      setReporting(false);
    }
  };

  // 监管端统一交易执行器（提示 + 自动刷新）

  // ★ 统一交易确认：等待回执并触发「已上链」确认条
  const confirmTx = async (txPromise) => {
    const tx = await txPromise;
    const rc = await tx.wait();
    onTx?.({ hash: rc.hash, blockNumber: rc.blockNumber });
    return rc;
  };

  const runTx = async (label, fn, okMsg) => {
    setPending(label);
    try {
      await fn();
      onNotice?.('success', okMsg);
      await load();
    } catch (e) {
      onNotice?.('error', parseTxError(e));
    } finally {
      setPending('');
    }
  };

  // ★ 争议裁决：只能二选一 —— 退款给企业 或 放款给数据所有者，监管无法动用资金
  const handleResolve = (escrowId, refund) => runTx(refund ? 'refund' : 'payout', async () => {
    await confirmTx(contract.resolveDispute(escrowId, refund));
    // ★ v4.6：裁决归档由本人操作产生，不再推送归档通知 —— 这里直接闭合对应「待裁决」红点
    markRead(account, `ruling:${escrowId}:open`);
  }, refund ? '已裁定：费用退回企业押金池' : '已裁定：费用放款给数据所有者');

  // ============================================================
  // ★ 裁决说明书生成器（v4.5）：为单笔争议结构化生成四要素
  //   ① 事实认定（程序时间线） ② 证据分析（凭证 / 程序 / 信誉）
  //   ③ 适用规则（基础规则，路径规则在裁量过程中展示）
  //   ④ 裁量过程（两条路径各自的执行影响与依据）
  //   —— 全部依据均为模拟引用（见 LEGAL_NOTICE），仅演示合规展示机制
  // ============================================================
  const buildRulingBasis = (d) => {
    const rep = enterpriseRep.find((r) => (r.address || '').toLowerCase() === (d.enterprise || '').toLowerCase());
    const challenge = chainInfo.challenge ?? 600;
    // ① 事实认定：托管创建 → 交付存证 → 挑战期内申诉 → 当前裁决状态
    const facts = [
      { time: fmtTime(d.ts), text: `托管单 #${d.escrowId} 创建：数据所有者 ${shortAddr(d.user)} 将字段「${d.fieldName}」托管上链，托管金额 ${fmtEth(d.amount)} ETH 由合约锁定。` },
      { time: fmtTime(d.ts), text: `交付凭证生成并存证：deliveryHash = ${shortHash(d.deliveryHash)}（原始文件不上链、不可下载，仅存 keccak256 摘要）。` },
      d.disputeTs
        ? { time: fmtTime(d.disputeTs), text: `企业在挑战期内发起申诉，理由：「${d.disputeReason}」（申诉交易 ${shortHash(d.disputeTxHash) || '—'}）。` }
        : { time: '—', text: `企业发起申诉（历史数据无事件时间戳），理由：「${d.disputeReason}」。` },
      d.settled
        ? { time: fmtTime(d.resolvedTs || d.ts), text: `监管已作出裁决并上链确认：${d.resolvedRefunded ? '托管费用退回企业押金池（申诉成立）' : '托管费用放款给数据所有者（申诉驳回）'}。` }
        : { time: '当前', text: '争议处于待决状态，托管资金持续锁定，等待监管作出二选一裁决。' },
    ];
    // ② 证据分析：凭证核验 / 申诉主张 / 程序合规 / 信誉档案 / 资金锁定
    const evidence = [
      { label: '交付凭证哈希', value: shortHash(d.deliveryHash) || '—', note: '链上存证、不可篡改；可在「凭证审计」抽屉在线打开链下原始文件并比对摘要一致。' },
      { label: '申诉理由（企业自述）', value: d.disputeReason || '—', note: '企业单方主张，属自由文本，需结合凭证核验与信誉档案综合判断。' },
      { label: '申诉程序合规性', value: `挑战期 ${challenge} 秒内提交`, note: '合约强制校验申诉时限（CHALLENGE_PERIOD），超期申诉会被直接拒绝 —— 出现在裁决列表即证明程序合规。' },
      { label: '企业信誉档案', value: rep ? `${rep.score} 分（成功 ${rep.success} / 拦截 ${rep.blocked} / 败诉 ${rep.lost}${rep.isFlagged ? ' / 已失信' : ''}）` : '无调用档案', note: '信誉分 600 分为基线；历史恶意申诉败诉与失信标记是裁量参考因素。' },
      { label: '争议金额', value: `${fmtEth(d.amount)} ETH`, note: '由合约托管锁定，裁决前任何一方（含监管）均无法动用。' },
    ];
    // ③ 适用规则（基础三条；各路径专属规则在裁量过程中标注）
    const baseRules = ['R-05', 'R-06', 'R-09'];
    // ④ 裁量过程：放款路径的用户实得 = 90%（PLATFORM_FEE_BPS = 1000 / 10000）
    let userAmt = '—';
    try { userAmt = fmtEth(BigInt(d.amount) * 9000n / 10000n); } catch { /* 金额异常时展示占位 */ }
    return {
      facts,
      evidence,
      baseRules,
      paths: {
        refund: {
          title: '路径 A · 裁定退款给企业（申诉成立）',
          steps: [
            `托管费用 ${fmtEth(d.amount)} ETH 全额退回企业押金池，可继续用于后续数据调用；`,
            '分账取消：数据所有者本次不获得收益；',
            '企业信誉不受影响（不记恶意申诉败诉）。',
          ],
          ruleIds: ['R-02', 'R-03'],
        },
        payout: {
          title: '路径 B · 裁定放款给数据所有者（申诉驳回）',
          steps: [
            `数据所有者实得 ${userAmt} ETH（90%，上链自动到账），平台服务费 10% 入国库；`,
            `企业记一次恶意申诉败诉：信誉分扣减 150 分（当前 ${rep ? rep.score : '—'} 分 → ${rep ? Math.max(0, rep.score - 150) : '—'} 分）；`,
            '信誉分累计低于 300 分将被合约自动暂停调用权限。',
          ],
          ruleIds: ['R-01', 'R-04', 'R-07'],
        },
      },
    };
  };

  // ★ 打开裁决说明书弹窗（重置确认勾选，防止上次残留直接提交）
  const openRulingModal = (d) => {
    setRulingConfirm(false);
    setRulingModal({ dispute: d, basis: buildRulingBasis(d) });
  };

  // ★ 确认裁决：先把「裁决说明书」存档（localStorage，供审计报告并档），再发起链上裁决交易
  const confirmRuling = (refund) => {
    if (!rulingModal) return;
    const { dispute: d, basis } = rulingModal;
    saveRulingDoc(d.escrowId, {
      escrowId: d.escrowId,
      fieldName: d.fieldName,
      user: d.user,
      enterprise: d.enterprise,
      amount: d.amount,
      disputeReason: d.disputeReason,
      createdAt: d.ts,
      disputeTs: d.disputeTs,
      facts: basis.facts,
      evidence: basis.evidence,
      baseRules: basis.baseRules,
      paths: basis.paths,
      outcome: refund ? 'refund' : 'payout',
      regulator: account,
      legalNotice: LEGAL_NOTICE,
    });
    setRulingModal(null);
    setRulingConfirm(false);
    handleResolve(d.escrowId, refund);
  };

  // ★ 失信标记 / 解除：只影响调用权限，不触碰任何资金
  const handleFlag = (address, flag) => runTx(flag ? 'flag' : 'unflag', async () => {
    await confirmTx(contract.flagEnterprise(address, flag, flag ? '监管判定存在违规调用行为' : ''));
  }, flag ? '已标记失信，该企业调用权限已暂停' : '已解除失信标记，调用权限恢复');

  const refresh = useCallback(async () => {
    if (!contract) return;
    const { regulatorChart } = await buildAllCharts(contract, null);
    setChartData(regulatorChart);
  }, [contract]);

  useEffect(() => { refresh(); }, [refresh]);
  useChainEvents(contract, () => setTimeout(() => { refresh(); load(); }, 1000));

  const inTimeMode = (ts, mode, dt) => {
    if (mode === '全部') return true;
    const t = Number(ts) * 1000;
    if (mode === '今天') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return t >= start.getTime();
    }
    if (mode === '近 7 天') return Date.now() - t <= 7 * 86400 * 1000;
    if (mode === '自定义') {
      const { y, mo, d, h, mi, s } = dt;
      if (!y || !mo || !d) return true;
      const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h || 0), Number(mi || 0), Number(s || 0));
      return t >= date.getTime();
    }
    return true;
  };

  const filteredAudit = auditLogs.filter((l) => {
    if (auditType !== '全部' && l.type !== auditType) return false;
    if (!inTimeMode(l.ts, auditTimeMode, auditDate)) return false;
    return true;
  });

  // ★ 凭证审计筛选
  const filteredEscrows = allEscrows.filter((e) => {
    if (proofStatus !== '全部') {
      const st = e.refunded ? '已退款' : e.settled ? '已放款'
        : e.disputed ? '争议中' : e.confirmedAt > 0 ? '已提前结算' : '托管中';
      if (st !== proofStatus) return false;
    }
    if (proofKeyword.trim()) {
      const k = proofKeyword.trim().toLowerCase();
      const hay = `${e.fieldName} ${e.user} ${e.enterprise} ${e.deliveryHash || ''}`.toLowerCase();
      if (!hay.includes(k)) return false;
    }
    return true;
  });

  const filteredAlerts = blocked.filter((l) => {
    if (alertReason !== '全部') {
      const reason = l.reason || '';
      if (!reason.includes(alertReason)) return false;
    }
    if (!inTimeMode(l.ts, alertTimeMode, alertDate)) return false;
    return true;
  });

  // 断开钱包连接（侧边栏与顶部账号菜单共用）
  const handleLogout = () => {
    // 演示模式：没有钱包权限可撤销，直接断开模拟连接并刷新（刷新后回到首页未登录态）
    if (web3.isSim) { web3.disconnect(); window.location.reload(); return; }
    if (window.ethereum) {
      window.ethereum.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
        .then(() => window.location.reload())
        .catch(() => window.location.reload());
    } else {
      window.location.reload();
    }
  };

  // ★ AI 审计摘要：输入全部来自链上真实统计，AI 只负责翻译成结论与提示关注点，
  //   不改变任何结论、不触发任何操作（链上裁决权仍在人手里）。
  const aiAudit = useMemo(
    () => auditSummary({ stats, settlement, blockedAttempts: blocked, escrows: allEscrows }),
    [stats, settlement, blocked, allEscrows]
  );

  return (
    <div className="min-h-screen bg-[#F4F7FE] font-sans flex p-4 gap-4">
      {/* 侧边栏 */}
      <Sidebar
        title="监管工作台"
        items={NAV}
        activeKey={tab}
        onChange={setTab}
        collapsed={collapsed}
        onToggle={setCollapsed}
        userAddress={account || '0x0000000000000000000000000000000000000000'}
        userName="监管节点"
        onLogout={handleLogout}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        blockNumber={blockNumber}
        isSim={web3.isSim}
        contractVersion={web3.contractVersion}
        versionOk={web3.versionOk}
      />

      {/* 右侧白色大圆角工作区 */}
      <main className={`transition-all duration-300 flex-1 min-w-0 h-[calc(100vh-2rem)] relative ${collapsed ? 'ml-20' : 'ml-72'}`}>
        <div className="flex flex-col h-full bg-white rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden relative">

          {/* 顶部导航栏：左标题 + 右灵动岛组件群，随内容排布，不再悬浮遮挡 */}
          <Header
            variant="dashboard"
            title="监管工作台"
            account={account}
            role="regulator"
            mode={mode}
            onToggleMode={onToggleMode}
            onOpenLogin={() => { console.log('请求登录'); }}
            blockNumber={blockNumber}
            onSwitchAccount={web3.switchAccount}
            onLogout={handleLogout}
            onNavigate={(path) => {
              // ★ 通知跳转白名单（v4.5）：仅接受本工作台真实存在的页签 key，
              //   命中即直连切换页签；旧版「非 requests 一律落概览」的映射已移除
              if (['overview', 'proofs', 'audit', 'disputes', 'alerts'].includes(path)) setTab(path);
            }}
          />

          {/* 内容滚动区 */}
          <div className="flex-1 overflow-auto p-8 bg-[#FAFBFC]">

            {tab === 'overview' && (
              <div className="space-y-8 animate-fade-in">
                <WelcomeBanner
                  greeting="欢迎回来"
                  name="监管节点"
                  subtitle="只读审计全链 · 裁决托管争议 · 标记失信企业。"
                  icon={Globe}
                  gradient="from-slate-700 via-slate-800 to-slate-900"
                  action={{
                    label: '待裁决争议',
                    value: `${settlement.disputePending} 笔`,
                    hint: settlement.disputePending > 0 ? '点击前往裁决' : '暂无待裁决争议',
                    onClick: settlement.disputePending > 0 ? () => setTab('disputes') : undefined,
                  }}
                />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <StatCard label="数据授权总量" value={`${stats.authTotal} 次`} accent="text-cyan-600" icon={FileText}
                    gradient="from-cyan-400 to-blue-500" delay={0} />
                  <StatCard label="全局分账总额" value={`${stats.distributeTotal} ETH`} accent="text-emerald-600" icon={TrendingUp}
                    gradient="from-emerald-400 to-teal-500" delay={80} />
                  <StatCard label="已上链数据字段" value={`${stats.fieldCount} 个`} accent="text-slate-800" icon={DatabaseIcon}
                    gradient="from-purple-400 to-pink-500" delay={160} />
                </div>

                {/* ★ AI 审计摘要：把链上事件翻译成人话 + 提示关注点（只解读，不决策） */}
                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex items-start justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 flex items-center justify-center text-white shadow-lg">
                        <Sparkles className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-800">AI 审计摘要</h3>
                        <p className="text-xs text-slate-400 mt-0.5">基于链上事件自动生成，供监管快速掌握全链状态</p>
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold px-3 py-1.5 rounded-full shrink-0 ${
                      aiAudit.level === 'high' ? 'bg-rose-50 text-rose-600'
                        : aiAudit.level === 'medium' ? 'bg-amber-50 text-amber-600'
                        : 'bg-emerald-50 text-emerald-600'
                    }`}>
                      {aiAudit.level === 'high' ? '需重点处理' : aiAudit.level === 'medium' ? '需关注' : '运行正常'}
                    </span>
                  </div>

                  <div className="text-sm font-bold text-slate-800 mb-4">{aiAudit.headline}</div>

                  <ul className="space-y-2">
                    {aiAudit.points.map((p, i) => (
                      <li key={i} className="text-xs text-slate-600 leading-relaxed flex gap-2">
                        <span className="text-slate-300 shrink-0">·</span><span>{p}</span>
                      </li>
                    ))}
                  </ul>

                  {aiAudit.risks.length > 0 && (
                    <div className="mt-4 px-4 py-3.5 rounded-2xl bg-amber-50/60 border border-amber-100">
                      <div className="text-[11px] font-bold text-amber-800 mb-2">关注点</div>
                      <ul className="space-y-1.5">
                        {aiAudit.risks.map((r, i) => (
                          <li key={i} className="text-[11px] text-amber-700 leading-relaxed flex gap-2">
                            <span className="shrink-0">·</span><span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="mt-4 text-[10px] text-slate-400 leading-relaxed">{AI_DISCLAIMER}</p>
                </div>

                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white shadow-lg">
                      <Activity className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800">全网交易量趋势（近 7 日）</h3>
                  </div>
                  {chartData.length === 0 ? <Empty text="暂无交易数据" /> : (
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="regulatorAreaFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#0891B2" stopOpacity={0.4} />
                              <stop offset="100%" stopColor="#0891B2" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="4 4" stroke="#F1F5F9" vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} dy={10} />
                          <YAxis tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                          <Tooltip formatter={(v) => [`${v} 笔`, '交易量']} contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 30px rgb(0,0,0,0.08)' }} />
                          <Area type="monotone" dataKey="交易量" stroke="#0891B2" strokeWidth={2.5} fill="url(#regulatorAreaFill)" dot={{ r: 4, fill: '#0891B2' }} activeDot={{ r: 6 }} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ★ 凭证审计：监管的核心职责之一 —— 可查验全部交付凭证与完整证据链 */}
            {tab === 'proofs' && (
              <div className="space-y-8 animate-fade-in">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
                  <StatCard label="托管中" value={`${settlement.pending} ETH`} accent="text-amber-600" icon={DatabaseIcon}
                    gradient="from-amber-400 to-orange-500" delay={0} />
                  <StatCard label="已放款给用户" value={`${settlement.withdrawn} ETH`} accent="text-emerald-600" icon={TrendingUp}
                    gradient="from-emerald-400 to-teal-500" delay={60} />
                  <StatCard label="已退款给企业" value={`${settlement.refunded} ETH`} accent="text-slate-800" icon={Activity}
                    gradient="from-slate-400 to-slate-600" delay={120} />
                  <StatCard label="待裁决争议" value={`${settlement.disputePending} 笔`} accent="text-rose-500" icon={Scale}
                    gradient="from-rose-400 to-red-500" delay={180} />
                </div>

                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white shadow-lg">
                        <ShieldCheck className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-800 flex items-center">
                          交付凭证审计
                          <Hint title="证据链包含什么">
                            该笔交付的全部链上事件节点（区块号 + 交易哈希）、交付凭证摘要、托管与结算状态。
                            可据此核对授权是否成立、结算是否准确、流程是否留痕。
                          </Hint>
                        </h3>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleExportReport('html')}
                        disabled={reporting}
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold transition-all hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
                      >
                        <Download className="w-4 h-4" />
                        {reporting ? '生成中...' : '导出审计报告'}
                      </button>
                      <button
                        onClick={() => handleExportReport('md')}
                        disabled={reporting}
                        title="导出纯文本 Markdown 版（无图表）"
                        className="px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-500 text-xs font-bold hover:bg-slate-50 hover:text-slate-700 disabled:opacity-60 transition-colors"
                      >
                        Markdown
                      </button>
                      <Hint title="导出格式区别">
                        <b>HTML 图表版</b>：自带内联图表与排版，浏览器打开即可看，也可直接「打印 → 另存为 PDF」当正式材料提交。<br />
                        <b>Markdown 版</b>：纯文本表格，便于复制进其他文档，但没有图形。
                      </Hint>
                    </div>
                  </div>

                  <div className="mb-8 p-6 rounded-2xl bg-slate-50/70 border border-slate-100">
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-slate-500 whitespace-nowrap">结算状态</label>
                        <select value={proofStatus} onChange={(e) => setProofStatus(e.target.value)}
                          className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs focus:outline-none focus:border-cyan-500 shadow-sm">
                          {PROOF_STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>
                      <div className="flex-1 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white border border-slate-200 min-w-[220px]">
                        <Search className="w-4 h-4 text-slate-400" strokeWidth={2} />
                        <input
                          value={proofKeyword}
                          onChange={(e) => setProofKeyword(e.target.value)}
                          placeholder="搜索字段名 / 地址 / 凭证哈希..."
                          className="flex-1 bg-transparent text-xs focus:outline-none"
                        />
                      </div>
                      <button
                        onClick={() => { setProofStatus('全部'); setProofKeyword(''); }}
                        className="px-6 py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        重置
                      </button>
                    </div>
                    <div className="mt-4 text-xs text-slate-400">共 {filteredEscrows.length} 条交付记录</div>
                  </div>

                  {filteredEscrows.length === 0 ? <Empty text="暂无符合条件的交付凭证" /> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead>
                          <tr className="text-xs text-slate-400 border-b border-slate-100">
                            <th className="pb-4 font-medium px-4">托管单</th>
                            <th className="pb-4 font-medium px-4">数据字段</th>
                            <th className="pb-4 font-medium px-4">数据所有者</th>
                            <th className="pb-4 font-medium px-4">调用企业</th>
                            <th className="pb-4 font-medium px-4">交付凭证</th>
                            <th className="pb-4 font-medium px-4 text-right">金额</th>
                            <th className="pb-4 font-medium px-4">状态</th>
                            <th className="pb-4 font-medium px-4 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredEscrows.map((e) => (
                            <tr key={e.escrowId} className="group hover:bg-slate-50 transition-colors">
                              <td className="py-5 px-4 text-slate-500 font-mono text-xs">
                                #{e.escrowId}
                                <div className="text-[10px] text-slate-400 mt-1">{fmtTime(e.ts)}</div>
                              </td>
                              <td className="py-5 px-4 text-slate-800 font-medium">{e.fieldName}</td>
                              <td className="py-5 px-4 text-slate-500 font-mono text-xs">{shortAddr(e.user)}</td>
                              <td className="py-5 px-4 text-slate-500 font-mono text-xs">{shortAddr(e.enterprise)}</td>
                              <td className="py-5 px-4">
                                <code className="text-[11px] font-mono text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md" title={e.deliveryHash}>
                                  {shortHash(e.deliveryHash) || '—'}
                                </code>
                              </td>
                              <td className="py-5 px-4 text-right font-bold text-slate-700">{fmtEth(e.amount)} ETH</td>
                              <td className="py-5 px-4">
                                <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                                  e.refunded ? 'bg-slate-100 text-slate-500'
                                    : e.settled ? 'bg-emerald-50 text-emerald-600'
                                    : e.disputed ? 'bg-rose-50 text-rose-500'
                                    : e.confirmedAt > 0 ? 'bg-cyan-50 text-cyan-600'
                                    : 'bg-amber-50 text-amber-600'
                                }`}>
                                  {e.refunded ? '已退款' : e.settled ? '已放款'
                                    : e.disputed ? '争议中' : e.confirmedAt > 0 ? '已提前结算' : '托管中'}
                                </span>
                              </td>
                              <td className="py-5 px-4 text-right">
                                <button
                                  onClick={() => setProofRow(e)}
                                  className="px-4 py-2 rounded-xl bg-slate-100 text-xs font-bold text-slate-600 group-hover:bg-slate-900 group-hover:text-white transition-all"
                                >
                                  查看存证
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'audit' && (
              <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50 animate-fade-in">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white shadow-lg">
                    <FileText className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800">全局审计日志（只读）</h3>
                </div>
                <p className="text-xs text-slate-400 mb-8 ml-13">点击任意行可查看该笔链上记录的完整详情</p>

                <div className="mb-8 p-6 rounded-2xl bg-slate-50/70 border border-slate-100">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-slate-500 whitespace-nowrap">类型</label>
                      <select value={auditType} onChange={(e) => setAuditType(e.target.value)}
                        className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs focus:outline-none focus:border-cyan-500 shadow-sm">
                        {AUDIT_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-slate-500 whitespace-nowrap">时间</label>
                      <select value={auditTimeMode} onChange={(e) => setAuditTimeMode(e.target.value)}
                        className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs focus:outline-none focus:border-cyan-500 shadow-sm">
                        {TIME_MODE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    {auditTimeMode === '自定义' && <DateTimePicker value={auditDate} onChange={setAuditDate} />}
                    <button
                      onClick={() => { setAuditType('全部'); setAuditTimeMode('全部'); setAuditDate(EMPTY_DATE); }}
                      className="ml-auto px-6 py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      重置
                    </button>
                  </div>
                  <div className="mt-4 text-xs text-slate-400">共 {filteredAudit.length} 条记录</div>
                </div>

                {/* ★ 图表化概览：随类型 / 时间筛选联动，与下方明细表互为「概览 / 明细」 */}
                <AuditCharts logs={filteredAudit} />

                {filteredAudit.length === 0 ? <Empty text="暂无符合条件的审计记录" /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead>
                        <tr className="text-xs text-slate-400 border-b border-slate-100">
                          <th className="pb-4 font-medium px-4">时间</th>
                          <th className="pb-4 font-medium px-4">区块</th>
                          <th className="pb-4 font-medium px-4">类型</th>
                          <th className="pb-4 font-medium px-4">字段</th>
                          <th className="pb-4 font-medium px-4">用户</th>
                          <th className="pb-4 font-medium px-4">企业</th>
                          <th className="pb-4 font-medium px-4 text-right">金额（ETH）</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAudit.map((l, i) => (
                          <tr key={i} onClick={() => setSelectedLog(l)}
                            className="group hover:bg-slate-50 transition-colors cursor-pointer">
                            <td className="py-5 px-4 text-slate-500 whitespace-nowrap text-xs">{fmtTime(l.ts)}</td>
                            <td className="py-5 px-4 text-slate-500 text-xs">{l.blockNumber}</td>
                            <td className="py-5 px-4"><TypeBadge type={l.type} /></td>
                            <td className="py-5 px-4 text-slate-800 font-medium">{l.fieldId !== null ? `字段#${l.fieldId}` : '-'}</td>
                            <td className="py-5 px-4 text-slate-500 font-mono text-xs">{l.user ? shortAddr(l.user) : '-'}</td>
                            <td className="py-5 px-4 text-slate-500 font-mono text-xs">{l.enterprise ? shortAddr(l.enterprise) : '-'}</td>
                            <td className="py-5 px-4 text-right text-slate-800 font-bold">{l.amount ? fmtEth(l.amount) : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ★ 争议裁决：托管资金的救济通道，监管只能裁决归属、不能动用资金 */}
            {tab === 'disputes' && (
              <div className="space-y-8 animate-fade-in">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
                  <StatCard label="托管中金额" value={`${settlement.pending} ETH`} accent="text-amber-600" icon={DatabaseIcon}
                    gradient="from-amber-400 to-orange-500" delay={0} />
                  <StatCard label="已提现给用户" value={`${settlement.withdrawn} ETH`} accent="text-emerald-600" icon={TrendingUp}
                    gradient="from-emerald-400 to-teal-500" delay={60} />
                  <StatCard label="已退款给企业" value={`${settlement.refunded} ETH`} accent="text-slate-800" icon={Activity}
                    gradient="from-slate-400 to-slate-600" delay={120} />
                  <StatCard label="待裁决争议" value={`${settlement.disputePending} 笔`} accent="text-rose-500" icon={Scale}
                    gradient="from-rose-400 to-red-500" delay={180} />
                </div>

                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-400 to-red-500 flex items-center justify-center text-white shadow-lg">
                      <Scale className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">争议裁决</h3>
                      <p className="text-xs text-slate-400 mt-1 flex items-center">
                        只能裁决资金归属：退回企业 / 放款用户
                        <Hint title="监管的权力边界">
                          合约层面不存在把托管资金转给监管或第三方的任何函数 —— 可裁决，不可动钱。
                          裁决只有两个选项：退款企业押金池，或放款给数据所有者。
                        </Hint>
                      </p>
                    </div>
                  </div>

                  {disputes.length === 0 ? (
                    // ★ 空列表引导（v4.4）：说明争议从何而来，便于演示时快速理解申诉 → 裁决链路
                    <div className="text-center py-10">
                      <Empty text="当前没有争议记录" />
                      <p className="text-xs text-slate-400 mt-2">
                        企业需在其托管单的挑战期内（{chainInfo.challenge ?? 600} 秒）发起申诉，
                        申诉后该笔托管单会自动出现在此处等待裁决
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead>
                          <tr className="text-xs text-slate-400 border-b border-slate-100">
                            <th className="pb-4 font-medium px-4">托管单</th>
                            <th className="pb-4 font-medium px-4">字段</th>
                            <th className="pb-4 font-medium px-4">数据所有者</th>
                            <th className="pb-4 font-medium px-4">申诉企业</th>
                            <th className="pb-4 font-medium px-4">交付凭证</th>
                            <th className="pb-4 font-medium px-4">申诉理由</th>
                            <th className="pb-4 font-medium px-4">详情</th>
                            <th className="pb-4 font-medium px-4 text-right">争议金额</th>
                            <th className="pb-4 font-medium px-4 text-right">裁决</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* ★ v4.5：每行可折叠展开「裁决详情」（四要素紧凑版）；
                              裁决按钮先弹出「裁决说明书」弹窗，阅读确认后才发链上交易 */}
                          {disputes.map((d) => (
                            <Fragment key={d.escrowId}>
                              <tr className="group hover:bg-slate-50 transition-colors">
                                <td className="py-5 px-4 text-slate-500 font-mono text-xs">
                                  #{d.escrowId}
                                  <div className="text-[10px] text-slate-400 mt-1">{fmtTime(d.ts)}</div>
                                </td>
                                <td className="py-5 px-4 text-slate-800 font-medium">{d.fieldName}</td>
                                <td className="py-5 px-4 text-slate-500 font-mono text-xs">{shortAddr(d.user)}</td>
                                <td className="py-5 px-4 text-slate-500 font-mono text-xs">{shortAddr(d.enterprise)}</td>
                                <td className="py-5 px-4">
                                  <code className="text-[11px] font-mono text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md" title={d.deliveryHash}>
                                    {shortHash(d.deliveryHash) || '—'}
                                  </code>
                                </td>
                                <td className="py-5 px-4 text-xs text-slate-500 max-w-[200px]">
                                  <div className="truncate" title={d.disputeReason}>{d.disputeReason || '—'}</div>
                                </td>
                                {/* 折叠 / 展开裁决详情（四要素紧凑版） */}
                                <td className="py-5 px-4">
                                  <button
                                    onClick={() => setExpandedDispute(expandedDispute === d.escrowId ? null : d.escrowId)}
                                    className="flex items-center gap-1 text-[11px] font-bold text-cyan-600 hover:text-cyan-700 transition-colors"
                                  >
                                    {expandedDispute === d.escrowId
                                      ? <><ChevronUp className="w-3.5 h-3.5" />收起</>
                                      : <><ChevronDown className="w-3.5 h-3.5" />裁决详情</>}
                                  </button>
                                </td>
                                <td className="py-5 px-4 text-right font-bold text-slate-700">{fmtEth(d.amount)} ETH</td>
                                <td className="py-5 px-4 text-right whitespace-nowrap">
                                  {d.settled ? (
                                    <div className="inline-flex flex-col items-end gap-1">
                                      <span className={`text-xs font-bold px-3 py-1 rounded-full ${d.refunded ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-600'}`}>
                                        {d.refunded ? '已退款给企业' : '已放款给用户'}
                                      </span>
                                      {/* 裁决说明书存档标识（v4.5） */}
                                      {getRulingDoc(d.escrowId) && (
                                        <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                                          <FileCheck className="w-3 h-3" />说明书已存档
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => openRulingModal(d)}
                                      disabled={pending !== ''}
                                      title="先查阅裁决说明书（事实认定 / 证据分析 / 适用规则 / 裁量过程），确认后作出裁决"
                                      className="px-4 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                                    >
                                      作出裁决
                                    </button>
                                  )}
                                </td>
                              </tr>
                              {/* 折叠行：四要素紧凑版裁决详情 */}
                              {expandedDispute === d.escrowId && (
                                <tr>
                                  <td colSpan={9} className="bg-slate-50/80 px-6 py-4 border-y border-slate-100">
                                    <RulingBasisView basis={buildRulingBasis(d)} compact />
                                    {!d.settled && (
                                      <p className="mt-2 text-[10px] text-slate-400">
                                        以上为依据概要，点击「作出裁决」可查看完整裁决说明书并发起链上裁决交易。
                                      </p>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'alerts' && (
              <div className="space-y-8 animate-fade-in">

                {/* ★ 企业信誉与失信管理：把「信任」做成链上可计算的资产 */}
                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-lg">
                      <Activity className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800">企业信誉分与失信管理</h3>
                  </div>
                  <p className="text-xs text-slate-400 mb-8 ml-13 flex items-center">
                    低于 300 分自动暂停其调用权限
                    <Hint title="信誉分公式" width="300">
                      600 基线 + 成功调用 ×8 − 被拦截 ×60 − 恶意申诉败诉 ×150。<br />
                      标记失信只影响调用权限 —— 监管无法冻结或划转企业资金。
                    </Hint>
                  </p>

                  {enterpriseRep.length === 0 ? <Empty text="暂无企业调用记录" /> : (
                    <div className="grid grid-cols-1 gap-4">
                      {enterpriseRep.map((r) => (
                        <div key={r.address} className="flex items-center gap-6 p-5 rounded-2xl bg-slate-50/70 border border-slate-100">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3">
                              <code className="text-xs font-mono text-slate-700">{shortAddr(r.address)}</code>
                              {r.isFlagged && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-500">失信主体</span>
                              )}
                            </div>
                            <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${r.score >= 600 ? 'bg-emerald-500' : r.score >= 300 ? 'bg-amber-500' : 'bg-red-500'}`}
                                style={{ width: `${Math.max(2, (r.score / 1000) * 100)}%` }}
                              />
                            </div>
                            {r.isFlagged && r.flagReason && (
                              <div className="mt-2 text-[11px] text-red-500">标记原因：{r.flagReason}</div>
                            )}
                          </div>
                          <div className="text-center shrink-0">
                            <div className="text-xs text-slate-400">信誉分</div>
                            <div className={`text-lg font-bold ${r.score >= 600 ? 'text-emerald-600' : r.score >= 300 ? 'text-amber-600' : 'text-red-500'}`}>
                              {r.score}
                            </div>
                          </div>
                          <div className="text-center shrink-0">
                            <div className="text-xs text-slate-400">成功调用</div>
                            <div className="text-sm font-bold text-slate-700">{r.success}</div>
                          </div>
                          <div className="text-center shrink-0">
                            <div className="text-xs text-slate-400">被拦截</div>
                            <div className="text-sm font-bold text-amber-600">{r.blocked}</div>
                          </div>
                          <div className="text-center shrink-0">
                            <div className="text-xs text-slate-400">申诉败诉</div>
                            <div className="text-sm font-bold text-rose-500">{r.lost}</div>
                          </div>
                          <button
                            onClick={() => handleFlag(r.address, !r.isFlagged)}
                            disabled={pending !== ''}
                            className={`px-4 py-2 rounded-xl text-xs font-bold shrink-0 transition-colors disabled:opacity-60 ${
                              r.isFlagged
                                ? 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                                : 'bg-red-500 text-white hover:bg-red-600'
                            }`}
                          >
                            {pending === 'flag' || pending === 'unflag' ? '处理中...' : r.isFlagged ? '解除失信' : '标记失信'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-red-400 to-pink-500 flex items-center justify-center text-white shadow-lg">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800">被拦截的非法调用（高亮告警）</h3>
                </div>
                <p className="text-xs text-slate-400 mb-8 ml-13">
                  拦截记录由智能合约在业务校验中自动写入，原因由合约判定 —— 企业既无法伪造理由，也无法选择性不上报，
                  可与押金池余额、授权状态交叉核验
                </p>

                <div className="mb-8 p-6 rounded-2xl bg-slate-50/70 border border-slate-100">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-slate-500 whitespace-nowrap">原因</label>
                      <select value={alertReason} onChange={(e) => setAlertReason(e.target.value)}
                        className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs focus:outline-none focus:border-cyan-500 shadow-sm">
                        <option value="全部">全部</option>
                        <option value="余额不足">余额不足</option>
                        <option value="未获得授权">未获得授权</option>
                        <option value="已过期">授权已过期</option>
                        <option value="次数已用尽">次数已用尽</option>
                        <option value="失信">监管失信标记</option>
                        <option value="信誉分">信誉分不足</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-slate-500 whitespace-nowrap">时间</label>
                      <select value={alertTimeMode} onChange={(e) => setAlertTimeMode(e.target.value)}
                        className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs focus:outline-none focus:border-cyan-500 shadow-sm">
                        {TIME_MODE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    {alertTimeMode === '自定义' && <DateTimePicker value={alertDate} onChange={setAlertDate} />}
                    <button
                      onClick={() => { setAlertReason('全部'); setAlertTimeMode('全部'); setAlertDate(EMPTY_DATE); }}
                      className="ml-auto px-6 py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      重置
                    </button>
                  </div>
                  {/* ★ 同步状态条：最后同步时间 + 手动刷新，演示时可即时确认「已与链上对齐」 */}
                  <div className="mt-4 flex items-center justify-between">
                    <div className="text-xs text-slate-400">
                      共 {filteredAlerts.length} 条告警
                      {lastSync && <span className="ml-2">· 链上同步于 {new Date(lastSync).toLocaleTimeString('zh-CN')}</span>}
                    </div>
                    <button
                      onClick={() => load()}
                      title="立即从链上重新拉取拦截记录"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-medium text-slate-500 hover:text-cyan-600 hover:border-cyan-200 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      立即同步
                    </button>
                  </div>
                </div>

                {filteredAlerts.length === 0 ? <Empty text="暂无符合条件的异常记录" /> : (
                  <div className="grid grid-cols-1 gap-6">
                    {filteredAlerts.map((a, i) => (
                      <div key={i} className="p-6 rounded-[1.5rem] bg-red-50/50 border border-red-100 hover:bg-white hover:border-red-100 hover:shadow-[0_20px_40px_-20px_rgba(239,68,68,0.2)] transition-all duration-300">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-4">
                            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-red-400 to-pink-500 flex items-center justify-center text-white shadow-lg shrink-0 mt-0.5">
                              <AlertTriangle className="w-5 h-5" />
                            </div>
                            <div>
                              <div className="text-base font-bold text-red-600">{a.reason || '非法拦截'}</div>
                              <div className="mt-2 text-sm text-slate-600 font-medium">
                                调用企业 <code className="font-mono bg-white px-2 py-0.5 rounded-md text-xs">{shortAddr(a.enterprise)}</code> · 目标字段#{a.fieldId}
                              </div>
                            </div>
                          </div>
                          <div className="text-xs text-slate-400 whitespace-nowrap font-medium">{fmtTime(a.ts)}</div>
                        </div>
                        <div className="mt-4 ml-14 px-4 py-3 rounded-xl bg-white/80 text-xs text-slate-500 font-medium">
                          已由智能合约 AccessControl + ReentrancyGuard 防护层拦截，未产生任何分账
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ★ 上链存证详情抽屉 */}
      {proofRow && (
        <ProofDrawer row={proofRow} contract={contract} viewer="regulator" onClose={() => setProofRow(null)} />
      )}

      {/* ★ 裁决说明书弹窗（v4.5）：阅读四要素 → 勾选确认 → 二选一裁决 */}
      <RulingModal
        modal={rulingModal}
        confirm={rulingConfirm}
        onConfirmChange={setRulingConfirm}
        onClose={() => { setRulingModal(null); setRulingConfirm(false); }}
        onRule={confirmRuling}
      />

      {/* ★ 设置弹窗（侧边栏底部入口） */}
      {settingsOpen && (
        <SettingsModal web3={web3} blockNumber={blockNumber} onClose={() => setSettingsOpen(false)} />
      )}

      {/* ★ 使用说明 / 疑问处 */}
      {helpOpen && (
        <HelpModal role="regulator" onClose={() => setHelpOpen(false)} />
      )}

      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setSelectedLog(null)} />
          <div className="relative w-full max-w-md bg-white shadow-xl rounded-3xl p-8 animate-fade-in">
            <h3 className="text-xl font-bold text-slate-900">链上记录详情</h3>
            <div className="mt-6 space-y-3 text-sm">
              <Row label="事件类型" value={<TypeBadge type={selectedLog.type} />} />
              <Row label="交易哈希" value={<code className="text-xs font-mono break-all bg-slate-100 px-2 py-1 rounded-md">{selectedLog.txHash}</code>} />
              <Row label="区块号" value={selectedLog.blockNumber} />
              <Row label="时间" value={fmtTime(selectedLog.ts)} />
              {selectedLog.fieldId !== null && <Row label="字段 ID" value={`#${selectedLog.fieldId}`} />}
              {selectedLog.user && <Row label="用户" value={<code className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded-md">{selectedLog.user}</code>} />}
              {selectedLog.enterprise && <Row label="企业" value={<code className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded-md">{selectedLog.enterprise}</code>} />}
              {selectedLog.amount && <Row label="金额" value={`${fmtEth(selectedLog.amount)} ETH`} />}
              {selectedLog.reason && <Row label="拦截原因" value={<span className="text-red-500 font-bold">{selectedLog.reason}</span>} />}
            </div>
            <div className="mt-8 flex justify-end">
              <button onClick={() => setSelectedLog(null)}
                className="px-8 py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold transition-all hover:bg-slate-800">
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }) {
  const colorMap = {
    '字段上链': 'bg-slate-100 text-slate-500',
    '授权': 'bg-cyan-50 text-cyan-600',
    '撤销授权': 'bg-slate-100 text-slate-500',
    '押金充值': 'bg-blue-50 text-blue-600',
    '调用分账': 'bg-emerald-50 text-emerald-600',
    '非法拦截': 'bg-red-50 text-red-500',
  };
  return (
    <span className={`text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap ${colorMap[type] || 'bg-slate-100 text-slate-500'}`}>
      {type}
    </span>
  );
}

function StatCard({ label, value, accent, icon: Icon, gradient, delay = 0 }) {
  return (
    <div
      className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_-20px_rgba(15,23,42,0.1)] animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex justify-between items-start mb-6">
        <span className="text-sm font-medium text-slate-400">{label}</span>
        {Icon && (
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center bg-gradient-to-br ${gradient} shadow-lg shadow-current/20`}>
            <Icon className="w-6 h-6 text-white" strokeWidth={2} />
          </div>
        )}
      </div>
      <div className={`text-4xl font-extrabold tracking-tight ${accent}`}>{value}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-900 text-right break-all">{value}</span>
    </div>
  );
}