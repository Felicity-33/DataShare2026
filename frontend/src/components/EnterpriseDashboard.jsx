// ============================================================
// EnterpriseDashboard.jsx —— 企业工作台
// ------------------------------------------------------------
// 侧边栏：概览 / 充值押金 / 数据市场 / 调用记录（贴边悬浮·可收缩）
// 顶部：统一标题栏（灵动岛，定位在右上角）
// 功能：
//   - 概览：押金池余额 + 累计消耗押金 + 近 7 日押金收支柱状图
//   - 充值押金：自由填金额 + 充值（deposit）
//   - 数据市场：分类筛选 + 已授权字段 + 调用 + 未授权发起申请
//   - 调用记录：分类查询（字段 / 数据所有者 / 时间 / 关键词）
// 关键报错：押金不足时顶部滑下红色横幅 + 链上补记拦截
// 调用成功：弹出 ZKP 验证结果卡片
// ============================================================
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend
} from 'recharts';
import {
  LayoutDashboard, Wallet, Store, History,
  TrendingUp, Activity, ShieldCheck, Search, Sparkles, ChevronDown
} from 'lucide-react';
import { ethers } from 'ethers';
import {
  shortAddr, shortHash, fmtEth, fmtTime, fmtCountdown, parseTxError, emitGlobalError,
  buildDeliveryHash, getDataPayload, dataFileUrl, loadAllData, hashPayload, syncChainClock, ACTIVE_NETWORK,
} from '../config.js';
import { requestIntent, recommendFields, AI_DISCLAIMER } from '../ai.js';

// 重算某笔交付的链下数据摘要，用于与链上凭证比对（验证数据未被篡改）
const digestOfEscrow = (row) => {
  const payload = getDataPayload(row.dataRef);
  return payload ? hashPayload(payload) : '';
};
import { buildAllCharts, useChainEvents, useBlockNumber, useChainNow } from '../hooks/useWeb3.js';
// ★ 通知中心（v4.6 苹果精简版）：只推核心第三方事件（授权结果 / 拦截 / 裁决结果），
//   点击直达功能页；发起申请 / 充值 / 提交申诉等自主操作不产生通知
import {
  pushNotifications, nfAuthResult, nfBlocked, nfDisputeResolved,
} from '../notifications.js';
import Sidebar from './Sidebar';
import SettingsModal from './SettingsModal';
import HelpModal from './HelpModal';
import ProofDrawer from './ProofDrawer';
import Hint from './Hint.jsx';
import DataPayloadView from './DataPayloadView.jsx';
import WelcomeBanner from './WelcomeBanner';


import Header from './Header';

const NAV = [
  { key: 'dashboard', label: '概览', icon: LayoutDashboard },
  { key: 'deposit', label: '充值押金', icon: Wallet },
  { key: 'market', label: '数据市场', icon: Store },
  { key: 'escrow', label: '托管结算', icon: ShieldCheck },
  { key: 'history', label: '调用记录', icon: History }
];

const TIME_MODE_OPTIONS = ['全部', '今天', '近 7 天', '自定义'];
const EMPTY_DATE = { y: '', mo: '', d: '', h: '', mi: '', s: '' };

// 关键词匹配：已授权 / 未授权两组搜索框共用同一口径（按字段名）
const matchByKeyword = (f, kw) => {
  if (!kw) return true;
  const k = kw.toLowerCase().trim();
  if (!k) return true;
  const name = f.name.toLowerCase();
  return name.includes(k) || k.includes(name) || k.split(/\s+/).some((w) => w && name.includes(w));
};

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
  const sel = 'px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:border-cyan-500';

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

export default function EnterpriseDashboard({ web3, onNotice, onBlocked, onTx, mode, onToggleMode }) {
  const { contract, account } = web3;

  const [tab, setTab] = useState('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);      // ★ 使用说明 / 疑问处   // ★ 设置弹窗
  const blockNumber = useBlockNumber(web3.provider);          // ★ 实时区块高度

  const [deposit, setDeposit] = useState('');
  const [depositBal, setDepositBal] = useState('0');
  const [consumed, setConsumed] = useState('0');
  const [callCount, setCallCount] = useState(0);
  const [fields, setFields] = useState([]);
  const [permissions, setPermissions] = useState({});
  const [calls, setCalls] = useState([]);
  const [pending, setPending] = useState('');
  const [callModal, setCallModal] = useState(null);
  const [callPeriodType, setCallPeriodType] = useState(0);  // ★ 调用周期（单价由合约计算）
  const [callUnits, setCallUnits] = useState(1);            // ★ 调用数量（次数 / 天数）
  const [showCallPriceNote, setShowCallPriceNote] = useState(false); // ★ 计费说明默认折叠
  const [enterpriseChart, setEnterpriseChart] = useState([]);

  const [applyModal, setApplyModal] = useState(null);
  const [applyPeriodType, setApplyPeriodType] = useState(0);
  const [applyUnits, setApplyUnits] = useState(1);
  // ★ 链上标准价（合约公开常量，前端只读取用于展示与预估金额，无法传入）
  const [stdPrice, setStdPrice] = useState({ call: '0.05', day: '0.5' });

  const [resultCard, setResultCard] = useState(null);

  // ★ 托管结算闭环新增状态
  const [escrows, setEscrows] = useState([]);          // 本企业发起的托管单（含结算状态）
  const [challengeSec, setChallengeSec] = useState(600); // 链上挑战期（秒）：申诉窗口提示用，读取失败时按 v4.4 默认 600
  const [reputation, setReputation] = useState({ score: 600, success: 0, blocked: 0, lost: 0, isFlagged: false });
  const [disputeModal, setDisputeModal] = useState(null); // { escrowId, fieldName }
  const [disputeReason, setDisputeReason] = useState('交付数据与描述不符');
  const [proofRow, setProofRow] = useState(null);      // ★ 上链存证抽屉（企业视角）
  // ★ 裁决结果即时通知（v4.4）：保存上一次托管单快照，load 时对比发现
  //   「争议中 → 已结算」的迁移即弹提示，让企业第一时间知道监管裁决结果
  const prevEscrowsRef = useRef([]);

  // ★ 精准筛选：已授权 / 未授权各自独立的关键词搜索框（输入即时生效）
  const [authSearch, setAuthSearch] = useState('');
  const [unauthSearch, setUnauthSearch] = useState('');
  // ★ 已授权 / 未授权两个区块支持折叠展开
  const [authOpen, setAuthOpen] = useState(true);
  const [unauthOpen, setUnauthOpen] = useState(true);
  // ★ AI 需求解析（自然语言 → 筛选条件 + 匹配理由）
  const [aiText, setAiText] = useState('');
  const [aiResult, setAiResult] = useState(null);
  // ★ AI 推荐字段点击跳转后，被定位的字段卡片短暂高亮（便于一眼找到）
  const [highlightField, setHighlightField] = useState(null);

  const [callFieldFilter, setCallFieldFilter] = useState('全部');
  const [callOwnerFilter, setCallOwnerFilter] = useState('全部');
  const [callTimeMode, setCallTimeMode] = useState('全部');
  const [callDate, setCallDate] = useState(EMPTY_DATE);
  const [callKeyword, setCallKeyword] = useState('');

  const load = useCallback(async () => {
    if (!contract || !account) return;
    try {
      // ★ 先加载链下数据文件（筛选 / AI 匹配 / 摘要校验都依赖它）
      await loadAllData();
      const bal = await contract.deposits(account);
      setDepositBal(fmtEth(bal));

      const count = Number(await contract.getFieldsCount());
      const allFields = [];
      const perms = {};
      for (let i = 0; i < count; i++) {
        const f = await contract.fields(i);
        allFields.push({ id: i, owner: f.owner, name: f.name, callCount: Number(f.callCount), dataRef: f.dataRef });
        try {
          // ★ 同时取「是否可调用」与「授权范围」：
          //   hasPermission 决定能不能调（含过期/用完的判定），getPermission 给出额度上限，
          //   后者用于在调用弹窗里限制数量 —— 企业不能绕开申请时约定的范围。
          const ok = await contract.hasPermission(i, account);
          if (ok) {
            const p = await contract.getPermission(i, account);
            perms[i] = {
              expiry: Number(p.expiry),
              maxCalls: Number(p.maxCalls),
              usedCalls: Number(p.usedCalls),
            };
          } else {
            perms[i] = false;
          }
        } catch { perms[i] = false; }
      }
      setFields(allFields);
      setPermissions(perms);

      // ★ 链上标准价：直接从合约常量读取，价格来自链上而非前端写死
      try {
        const [pc, pd] = await Promise.all([
          contract.STANDARD_PRICE_PER_CALL(),
          contract.STANDARD_PRICE_PER_DAY(),
        ]);
        setStdPrice({ call: fmtEth(pc), day: fmtEth(pd) });
      } catch { /* 旧版合约无此常量，忽略 */ }

      // ★ 链上挑战期（v4.4）：申诉窗口提示与禁用原因文案使用链上真实参数
      try {
        setChallengeSec(Number(await contract.CHALLENGE_PERIOD()));
      } catch { /* 旧版合约无此常量，保留默认值 */ }

      // ★ 调用记录 = 托管结算单：每一次调用一条，带结算状态与交付凭证
      //   （金额来自 EscrowCreated，因此「托管中」的资金也计入消耗，口径与押金池一致）
      const escEvs = await contract.queryFilter(contract.filters.EscrowCreated(), 0, 'latest');
      const rows = [];
      for (const ev of escEvs) {
        if (ev.args.enterprise.toLowerCase() !== account.toLowerCase()) continue;
        const id = Number(ev.args.escrowId);
        const e = await contract.escrows(id);
        const [canWithdraw, releaseAt] = await contract.canWithdraw(id);
        const b = await ev.getBlock();
        rows.push({
          escrowId: id,
          fieldId: Number(e.fieldId),
          fieldName: allFields[Number(e.fieldId)]?.name || `字段#${Number(e.fieldId)}`,
          dataRef: allFields[Number(e.fieldId)]?.dataRef || '',
          user: e.user,
          amount: e.amount.toString(),
          deliveryHash: e.deliveryHash,
          ts: b.timestamp,
          txHash: ev.transactionHash,
          disputed: e.disputed,
          settled: e.settled,
          refunded: e.refunded,
          confirmedAt: Number(e.confirmedAt),
          disputeReason: e.disputeReason,
          releaseAt: Number(releaseAt),
          canWithdraw,
        });
      }
      rows.sort((a, b) => b.ts - a.ts);
      setCalls(rows);
      setEscrows(rows);

      // ★ 裁决结果即时通知（v4.4）：监管裁决会使托管单从「争议中」迁移到「已结算」，
      //   对比前后快照发现该迁移时弹出结果提示（DisputeResolved 事件已在 useWeb3
      //   中订阅并触发 eventsVersion 刷新，这里只负责把结果翻译成企业能懂的一句话）
      const prevRows = prevEscrowsRef.current;
      const adjudicated = rows.find((r) => {
        const p = prevRows.find((x) => x.escrowId === r.escrowId);
        return p && p.disputed && !p.settled && r.settled;
      });
      if (adjudicated) {
        onNotice?.(adjudicated.refunded ? 'success' : 'error',
          adjudicated.refunded
            ? `监管裁决：托管单 #${adjudicated.escrowId} 申诉成立，费用已退回押金池`
            : `监管裁决：托管单 #${adjudicated.escrowId} 申诉被驳回，费用已放款给数据所有者`);
      }
      prevEscrowsRef.current = rows;

      const total = rows.reduce((s, r) => s + Number(fmtEth(r.amount)), 0);
      setConsumed(total.toFixed(4));
      setCallCount(rows.length);

      // ★ 链上信誉分：成功调用 / 被拦截 / 恶意申诉败诉 的综合评分
      const rep = await contract.reputationOf(account);
      setReputation({
        score: Number(rep[0]), success: Number(rep[1]),
        blocked: Number(rep[2]), lost: Number(rep[3]), isFlagged: rep[4],
      });

      // ============================================================
      // ★ 通知中心同步（v4.6 苹果精简版）：只推核心第三方事件
      //   授权结果（用户审批决定）/ 异常拦截（安全告警）/ 裁决结果；
      //   发起申请 / 押金充值 / 提交申诉均为企业自主操作，不推送通知。
      //   （重复推送按 id 去重；账户首次同步自动建立「已读基线」）
      // ============================================================
      try {
        // 授权结果 + 拦截事件一次拉齐，客户端按本企业地址过滤
        const [appEvs, denyEvs, blkEvs] = await Promise.all([
          contract.queryFilter('AuthorizationApproved', 0, 'latest'),
          contract.queryFilter('AuthorizationDenied', 0, 'latest'),
          contract.queryFilter('AccessAttemptBlocked', 0, 'latest'),
        ]);
        const mine = (addr) => (addr || '').toLowerCase() === account.toLowerCase();
        const candidates = [];

        // 1) 审批流程：我发起申请的用户审批结果（第三方决定，保留）
        const pushResult = async (ev, approved) => {
          if (!mine(ev.args.enterprise)) return;
          const b = await ev.getBlock();
          candidates.push(nfAuthResult({
            requestId: Number(ev.args.requestId),
            fieldName: allFields[Number(ev.args.fieldId)]?.name || `字段#${Number(ev.args.fieldId)}`,
            approved, ts: b.timestamp * 1000,
          }, 'market'));
        };
        for (const ev of appEvs) await pushResult(ev, true);
        for (const ev of denyEvs) await pushResult(ev, false);
        // 2) 异常拦截：我的调用被合约拦截（安全告警，逐条保留）
        for (const ev of blkEvs) {
          if (!mine(ev.args.enterprise)) continue;
          const b = await ev.getBlock();
          candidates.push(nfBlocked({
            fieldId: Number(ev.args.fieldId), reason: ev.args.reason, ts: b.timestamp * 1000,
          }, 'history'));
        }
        // 3) 监管裁决：裁决结果（第三方裁决，保留；申诉提交为自主操作不推）
        rows.forEach((r) => {
          if (r.disputed && r.settled) {
            candidates.push(nfDisputeResolved({
              escrowId: r.escrowId, fieldName: r.fieldName,
              amount: fmtEth(r.amount), reason: r.disputeReason, ts: r.ts * 1000,
              refunded: r.refunded,
            }, 'escrow', 'enterprise'));
          }
        });
        // drop：清洗历史版本已淘汰的通知（申请已发起 / 押金充值 / 申诉已提交）
        pushNotifications(account, candidates, (n) => (
          /^approval:req\d+:open$/.test(n.id) || /^funds:dep-/.test(n.id) || /^ruling:\d+:open$/.test(n.id)
        ));
      } catch (e) {
        console.error('通知同步失败', e); // 通知失败不影响主数据加载
      }
    } catch (e) {
      console.error('加载企业数据失败', e);
      // ★ 同步失败不能静默——进入全局异常通道；文案按运行模式分支（模拟模式不提 Ganache）
      emitGlobalError(web3.isSim
        ? '演示数据同步失败：请刷新页面恢复；若仍异常，请在右上角设置中重置演示数据'
        : `企业数据同步失败：请确认钱包已连接 ${ACTIVE_NETWORK.label}（本地演示需 Ganache 在 7545 端口运行）后刷新页面`);
    }
  }, [contract, account]);

  useEffect(() => { load(); }, [load, web3.eventsVersion]);

  // ★ 倒计时基准 = 链上时间（区块时间戳 + 本地经过时间），与合约 block.timestamp 对齐。
  //   用本地时钟会出现「界面说已到期、链上仍判定未到期」的偏差（Ganache 空闲时不出块）。
  const nowSec = useChainNow(web3.provider, blockNumber);


  // ★ 统一交易确认：等待回执并触发「已上链」确认条
  const confirmTx = async (txPromise) => {
    const tx = await txPromise;
    const rc = await tx.wait();
    onTx?.({ hash: rc.hash, blockNumber: rc.blockNumber });
    return rc;
  };

  const runTx = async (label, fn, successMsg) => {
    setPending(label);
    try {
      await fn();
      onNotice?.('success', successMsg);
      await load();
    } catch (e) {
      const msg = parseTxError(e);
      if (msg.includes('余额不足')) onBlocked?.(msg);
      else onNotice?.('error', msg);
    } finally {
      setPending('');
    }
  };

  const handleDeposit = async () => {
    const v = deposit.trim();
    if (!v || Number(v) <= 0) { onNotice?.('error', '请输入正确的押金金额'); return; }
    await runTx('deposit', async () => {
      await confirmTx(contract.deposit({ value: ethers.parseEther(v) }));
    }, `充值 ${v} ETH 成功`);
    setDeposit('');
  };

  // ★ 调用数据（唯一入口）：先 staticCall 预演，再真实发交易
  //   - 成功：押金扣除并进入合约托管，同时上链一枚交付凭证，等待挑战期满自动结算
  //   - 失败：合约自动写入拦截留痕（原因由合约判定，企业无法伪造），前端展示错误横幅
  // 链上标准价数值（用于本地预估金额；真实扣款以合约计算为准）
  const stdPriceValue = (periodType) => Number(periodType === 0 ? stdPrice.call : stdPrice.day);

  const handleCall = async (fieldId, periodType, units) => {
    const u = Number(units);
    if (!u || u <= 0) { onNotice?.('error', '请输入正确的数量'); return; }
    const target = fields.find((f) => f.id === fieldId);
    // ★ 交付凭证 = 链下数据文件的摘要（读文件 → 重算摘要 → 上链存证）
    const deliveryHash = buildDeliveryHash(target?.dataRef);
    if (!deliveryHash) {
      onNotice?.('error', '该字段未关联链下数据文件，无法交付 —— 请让数据所有者重新确权');
      return;
    }
    const total = stdPriceValue(periodType) * u;

    try {
      setPending('call');
      // 预演仅用于读取合约判定的 ok / reason（eth_call 不落链，取返回值供前端展示）；
      // ★ 拦截是否留痕以真实交易为准 —— 校验（押金 / 次数 / 授权）全部由合约执行，
      //   违规时合约「先存证再报错」：_recordBlocked 落库 + emit AccessAttemptBlocked，
      //   交易正常出块不回滚，监管端异常监控与企业信誉分即时可查
      const [ok, , reason] = await contract.callData.staticCall(fieldId, periodType, u, deliveryHash);
      const rc = await (await contract.callData(fieldId, periodType, u, deliveryHash)).wait();
      onTx?.({ hash: rc.hash, blockNumber: rc.blockNumber });

      if (!ok) {
        // 合约拦截：红横幅展示合约判定的原因（企业无法伪造）；记录已上链，立即刷新同步
        onBlocked?.(reason);
        await load();
        return;
      }

      setResultCard({
        fieldId,
        fieldName: target?.name || `字段#${fieldId}`,
        dataRef: target?.dataRef || '',
        owner: target?.owner,
        price: total.toFixed(4),
        periodLabel: periodType === 0 ? `按次 × ${u}` : `按天 × ${u}`,
        txHash: rc.hash,
        blockNumber: rc.blockNumber,
        deliveryHash,
      });
      setCallModal(null);
      setCallUnits(1);
      await load();
    } catch (e) {
      const msg = parseTxError(e);
      if (msg.includes('余额不足')) onBlocked?.(msg);
      else onNotice?.('error', msg);
    } finally {
      setPending('');
    }
  };

  // ★ 提前结算：挑战期内主动结算，该笔托管立即解锁，数据所有者可马上提现
  const handleConfirmDelivery = (escrowId) => runTx('confirm', async () => {
    // 时间闸门动作：先让本地链时钟追上真实时间（详见 config.js 的 syncChainClock）
    await syncChainClock();
    await confirmTx(contract.confirmDelivery(escrowId, { gasLimit: 400000n }));
  }, '已提前结算，该笔收益已解锁给数据所有者');

  // ★ 取消订单（v4.1）：挑战期内可自助取消，资金原路退回押金池
  //   窗口结束后资金已按约定归数据所有者，合约会拒绝取消
  const handleCancelOrder = (escrowId) => runTx('cancel', async () => {
    await syncChainClock();
    await confirmTx(contract.cancelOrder(escrowId, { gasLimit: 400000n }));
  }, '订单已取消，托管资金已原路退回押金池');

  // ★ 发起争议申诉：窗口内可申诉，资金锁定等待监管裁决
  const handleRaiseDispute = async () => {
    const reason = disputeReason.trim();
    if (!reason) { onNotice?.('error', '请填写申诉理由'); return; }
    const id = disputeModal?.escrowId;
    await runTx('dispute', async () => {
      await syncChainClock();
      await confirmTx(contract.raiseDispute(id, reason, { gasLimit: 400000n }));
    }, '已发起申诉，资金锁定等待监管裁决');
    setDisputeModal(null);
  };

  // ★ 发起授权申请：单价由合约按链上标准价计算，前端不再传价格
  const handleApplyAuthorization = async (fieldId, periodType, units) => {
    const u = Number(units);
    if (!u || u <= 0) { onNotice?.('error', '请输入正确的数量'); return; }

    const total = stdPriceValue(periodType) * u;
    if (Number(depositBal) < total) {
      onNotice?.('error', `押金不足（当前 ${depositBal} ETH，需要 ${total.toFixed(4)} ETH），请先充值`);
      return;
    }

    try {
      setPending('apply');
      await confirmTx(contract.requestAuthorization(fieldId, periodType, u));
      const periodLabel = periodType === 0 ? '按次' : '按天';
      onNotice?.('success', `已提交授权申请（${periodLabel} × ${u}，总计 ${total.toFixed(4)} ETH）`);
      setApplyModal(null);
      setApplyPeriodType(0);
      setApplyUnits(1);
      await load();
    } catch (e) {
      onNotice?.('error', parseTxError(e));
    } finally {
      setPending('');
    }
  };

  const refresh = useCallback(async () => {
    if (!contract || !account) return;
    const { enterpriseChart } = await buildAllCharts(contract, account);
    setEnterpriseChart(enterpriseChart);
  }, [contract, account]);

  useEffect(() => { refresh(); }, [refresh]);
  useChainEvents(contract, () => setTimeout(refresh, 1000));

  const authorizedFields = useMemo(() => fields.filter((f) => permissions[f.id]), [fields, permissions]);

  // ★ 调用弹窗的扣款预估（真实金额以合约按标准价计算为准）
  const callUnitPrice = Number(callPeriodType === 0 ? stdPrice.call : stdPrice.day);
  const callTotal = callUnitPrice * Number(callUnits || 0);
  // ★ 押金预检：本次扣款超过押金池余额 → 弹窗内直接拦截（红字警示 + 按钮禁用），
  //   明确展示差额
  const callDepositOk = callTotal <= Number(depositBal);
  const callDepositShort = callDepositOk ? 0 : callTotal - Number(depositBal);
  const callAfterDeposit = Math.max(0, Number(depositBal) - callTotal);

  // ★ 授权范围约束：调用弹窗沿用「已授予的授权范围」，
  //   并据此限制本次数量上限 —— 从界面上就不可能超出申请时约定的额度。
  //   次数型授权（maxCalls>0）-> 只能按次；期限型授权（expiry>0）-> 只能按天。
  const lockPeriodFor = (fieldId) => {
    const p = permissions[fieldId];
    if (!p) return 0;
    if (p.maxCalls > 0) return 0;
    if (p.expiry > 0) return 1;
    return 0;
  };

  const openCallModal = (f) => {
    if (!f) return;
    setCallModal(f);
    setCallUnits(1);
    setCallPeriodType(lockPeriodFor(f.id));
  };

  const callScope = callModal ? permissions[callModal.id] : null;
  const callRemainCalls = callScope && callScope.maxCalls > 0
    ? Math.max(0, callScope.maxCalls - callScope.usedCalls) : null;
  const callRemainDays = callScope && callScope.expiry > 0
    ? Math.max(0, Math.ceil((callScope.expiry - nowSec) / 86400)) : null;
  const callMaxUnits = callRemainCalls != null ? callRemainCalls
    : (callRemainDays != null ? callRemainDays : Infinity);
  const callUnitsOver = Number(callUnits) > callMaxUnits;
  const callScopeLabel = !callScope
    ? '—'
    : callScope.maxCalls > 0
      ? `按次 · 剩余 ${Math.max(0, callScope.maxCalls - callScope.usedCalls)} / ${callScope.maxCalls} 次`
      : callScope.expiry > 0
        ? `按天 · 有效期至 ${fmtTime(callScope.expiry)}`
        : '不限次数 · 长期有效';

  // ★ AI 需求解析：把一句自然语言需求转成结构化匹配结果并填入两组搜索框。
  //   纯本地确定性解析（见 ai.js），不调用外部模型、不参与任何链上决策。
  const handleAiParse = () => {
    const intent = requestIntent(aiText);
    setAiResult(intent);
    if (intent.keywords) { setAuthSearch(intent.keywords); setUnauthSearch(intent.keywords); }
  };

  // 已授权组：按组内关键词搜索
  const filteredFields = useMemo(
    () => authorizedFields.filter((f) => matchByKeyword(f, authSearch)),
    [authorizedFields, authSearch]
  );

  // ★ 未授权组：同样可按关键词搜索
  const filteredUnauth = useMemo(
    () => fields.filter((f) => !permissions[f.id] && matchByKeyword(f, unauthSearch)),
    [fields, permissions, unauthSearch]
  );

  // 未授权字段总数（与搜索无关，决定整个区块是否显示）
  const unauthTotal = useMemo(() => fields.filter((f) => !permissions[f.id]).length, [fields, permissions]);

  // ★ AI 推荐字段：按需求与字段数据集的真实匹配度排序。
  //   一旦解析出条件或关键词，就只保留真正命中的字段（score > 0），
  //   避免「匹配度 0% 的字段也被推荐」——推荐必须是精确结果，而不是凑数的默认排序。
  const aiRecs = useMemo(() => {
    if (!aiResult) return [];
    const all = recommendFields(fields, aiResult);
    const hasCond = aiResult.hits.length > 0 || !!aiResult.keywords;
    return (hasCond ? all.filter((r) => r.score > 0 || r.nameHit) : all).slice(0, 3);
  }, [aiResult, fields]);

  // ★ 点击 AI 推荐字段 → 定位到下方对应的字段卡片：
  //   展开所属分组 → 若搜索词会把它过滤掉则清空 → 滚动到卡片并短暂高亮。
  //   这样「AI 搜出来的字段」与「可点击调用的字段」是同一个对象，不会各说各话。
  const jumpToField = useCallback((field) => {
    if (!field) return;
    const granted = !!permissions[field.id];
    if (granted) {
      setAuthOpen(true);
      if (authSearch && !matchByKeyword(field, authSearch)) setAuthSearch('');
    } else {
      setUnauthOpen(true);
      if (unauthSearch && !matchByKeyword(field, unauthSearch)) setUnauthSearch('');
    }
    setHighlightField(field.id);
    // 等分组展开与搜索词清除引发的 DOM 更新完成后再滚动定位
    setTimeout(() => {
      const el = document.getElementById(`field-card-${field.id}`);
      if (!el) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }, 60);
    setTimeout(() => setHighlightField(null), 2600);
  }, [permissions, authSearch, unauthSearch]);

  const filteredCalls = useMemo(() => {
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

    return calls.filter((c) => {
      if (callFieldFilter !== '全部') {
        const name = fields.find((f) => f.id === c.fieldId)?.name || `字段#${c.fieldId}`;
        if (name !== callFieldFilter) return false;
      }
      if (callOwnerFilter !== '全部') {
        if (c.user.toLowerCase() !== callOwnerFilter.toLowerCase()) return false;
      }
      if (!inTimeMode(c.ts, callTimeMode, callDate)) return false;
      if (callKeyword.trim()) {
        const k = callKeyword.trim().toLowerCase();
        const name = (fields.find((f) => f.id === c.fieldId)?.name || '').toLowerCase();
        const owner = (c.user || '').toLowerCase();
        if (!name.includes(k) && !owner.includes(k)) return false;
      }
      return true;
    });
  }, [calls, fields, callFieldFilter, callOwnerFilter, callTimeMode, callDate, callKeyword]);

  const calledFieldNames = useMemo(() => {
    const set = new Set();
    calls.forEach((c) => {
      const name = fields.find((f) => f.id === c.fieldId)?.name || `字段#${c.fieldId}`;
      set.add(name);
    });
    return Array.from(set);
  }, [calls, fields]);

  const calledOwners = useMemo(() => {
    const set = new Set();
    calls.forEach((c) => set.add(c.user.toLowerCase()));
    return Array.from(set);
  }, [calls]);

  // ★ 争议申诉弹窗派生值（v4.4）：当前申诉目标单 + 实时剩余申诉时间。
  //   倒计时基准用 useChainNow（链上/本地取大），与合约 block.timestamp 判定口径一致
  const disputeTarget = disputeModal ? escrows.find((x) => x.escrowId === disputeModal.escrowId) : null;
  const disputeRemain = disputeTarget ? disputeTarget.releaseAt - nowSec : 0;
  const disputeExpired = disputeRemain <= 0;

  return (
    <div className="min-h-screen bg-[#F4F7FE] font-sans flex p-4 gap-4 overflow-hidden">
      
      {/* 1. 左侧深色悬浮胶囊侧边栏 */}
      <Sidebar
        title="企业工作台"
        items={NAV}
        activeKey={tab}
        onChange={setTab}
        collapsed={collapsed}
        onToggle={setCollapsed}
        userAddress={account}
        userName="企业"
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenHelp={() => setHelpOpen(true)}
        blockNumber={blockNumber}
        isSim={web3.isSim}
        contractVersion={web3.contractVersion}
        versionOk={web3.versionOk}
        onLogout={() => {
          if (window.ethereum) {
            window.ethereum.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
              .then(() => window.location.reload())
              .catch(() => window.location.reload());
          } else {
            window.location.reload();
          }
        }}
      />

      {/* 2. 右侧白色大圆角工作区 */}
      <main className={`transition-all duration-300 flex-1 min-w-0 h-[calc(100vh-2rem)] relative ${collapsed ? 'ml-20' : 'ml-72'}`}>
        <div className="flex flex-col h-full bg-white rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden relative">
          
          {/* 3. 工作台顶部导航栏（左标题，右侧灵动岛组件群） */}
          <Header
            account={account}
            role="enterprise"
            variant="dashboard"
            title="企业工作台"
            mode={mode}
            onToggleMode={onToggleMode}
            onOpenLogin={() => {}}
            blockNumber={blockNumber}
            onSwitchAccount={async (targetAddr) => {
              // 演示模式：直接切换到指定内置身份（下拉列表点选）；无参时轮换下一个
              if (web3.isSim) { await web3.switchAccount(targetAddr); return; }
              if (!window.ethereum) return;
              try {
                await window.ethereum.request({
                  method: 'wallet_revokePermissions',
                  params: [{ eth_accounts: {} }],
                });
              } catch (e) { console.warn('撤销权限失败', e); }
              
              try {
                await window.ethereum.request({
                  method: 'wallet_requestPermissions',
                  params: [{ eth_accounts: {} }],
                });
                window.location.reload();
              } catch (e) { console.error('切换账号失败', e); }
            }}
            onLogout={() => {
              // 演示模式：直接断开模拟连接并刷新（刷新后回到首页未登录态）
              if (web3.isSim) { web3.disconnect(); window.location.reload(); return; }
              if (window.ethereum) {
                window.ethereum.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
                  .then(() => window.location.reload())
                  .catch(() => window.location.reload());
              } else {
                window.location.reload();
              }
            }}
            onNavigate={(path) => {
              // ★ 通知跳转白名单（v4.5）：仅接受本工作台真实存在的页签 key，
              //   命中即直连切换页签；旧版 home/profile/requests/settings 映射已移除
              if (['dashboard', 'deposit', 'market', 'escrow', 'history'].includes(path)) setTab(path);
            }}
          />

          {/* 4. 内容滚动区 */}
          <div className="flex-1 overflow-auto p-8 bg-[#FAFBFC]">
            
            {/* 概览 */}
            {tab === 'dashboard' && (
              <div className="space-y-8 animate-fade-in">
                <WelcomeBanner
                  greeting="欢迎回来"
                  name="数据分析方"
                  subtitle="调用已授权数据；费用进合约托管，挑战期满自动结算。"
                  icon={Store}
                  gradient="from-cyan-500 via-blue-500 to-indigo-500"
                  action={{
                    label: '待结算托管单',
                    value: `${escrows.filter((e) => !e.settled && !e.refunded).length} 笔`,
                    hint: '点击查看结算进度',
                    onClick: () => setTab('escrow'),
                  }}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
                  <StatCard label="押金池余额" value={`${depositBal} ETH`} accent="text-cyan-600" icon={Wallet}
                    gradient="from-cyan-400 to-blue-500" delay={0} />
                  <StatCard label="累计消耗押金" value={`${consumed} ETH`} accent="text-slate-800" icon={TrendingUp}
                    gradient="from-purple-400 to-pink-500" delay={60} />
                  <StatCard label="已调用次数" value={`${callCount} 次`} accent="text-emerald-600" icon={Activity}
                    gradient="from-emerald-400 to-teal-500" delay={120} />
                  <StatCard label="链上信誉分" value={`${reputation.score} / 1000`}
                    accent={reputation.isFlagged ? 'text-red-500' : reputation.score < 300 ? 'text-amber-600' : 'text-emerald-600'}
                    icon={ShieldCheck} gradient="from-amber-400 to-orange-500" delay={180} />
                </div>

                {reputation.isFlagged && (
                  <div className="bg-red-50 border border-red-100 rounded-[2rem] px-8 py-5 text-sm text-red-600 font-medium">
                    已被监管标记为失信主体，调用权限已暂停。
                  </div>
                )}
                {!reputation.isFlagged && reputation.score < 300 && (
                  <div className="bg-amber-50 border border-amber-100 rounded-[2rem] px-8 py-5 text-sm text-amber-700 font-medium">
                    信誉分低于 300，调用权限已自动暂停。
                  </div>
                )}

                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white shadow-lg">
                      <TrendingUp className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800">近 7 日押金收支</h3>
                  </div>
                  {enterpriseChart.length === 0 ? <Empty text="暂无押金收支记录" /> : (
                    <div className="h-80">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={enterpriseChart} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="4 4" stroke="#F1F5F9" vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} dy={10} />
                          <YAxis tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                          <Tooltip cursor={{ fill: 'transparent' }} formatter={(v) => [`${v} ETH`, '']} contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 30px rgb(0,0,0,0.08)' }} />
                          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 20 }} iconType="circle" />
                          <Bar dataKey="充值" fill="#06B6D4" radius={[8, 8, 8, 8]} barSize={24} />
                          <Bar dataKey="消耗" fill="#F97316" radius={[8, 8, 8, 8]} barSize={24} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 充值押金 */}
            {tab === 'deposit' && (
              <div className="animate-fade-in">
                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50 max-w-2xl">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white shadow-lg">
                      <Wallet className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800">充值押金</h3>
                  </div>
                  <div className="mb-6 p-6 rounded-2xl bg-cyan-50/50 border border-cyan-100/50">
                    <div className="text-sm text-slate-500 mb-1">当前押金池余额</div>
                    <div className="text-4xl font-extrabold text-cyan-600">{depositBal} ETH</div>
                  </div>
                  <div className="flex gap-4">
                    <input
                      value={deposit}
                      onChange={(e) => setDeposit(e.target.value)}
                      placeholder="输入充值金额（ETH）"
                      type="number"
                      step="0.01"
                      className="flex-1 px-5 py-3.5 rounded-2xl bg-slate-50 border-none text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all"
                    />
                    <button
                      onClick={handleDeposit}
                      disabled={pending !== ''}
                      className="px-8 py-3.5 rounded-2xl bg-slate-900 text-white text-sm font-bold transition-all duration-300 hover:bg-slate-800 hover:shadow-lg disabled:bg-slate-300 disabled:cursor-not-allowed"
                    >
                      {pending === 'deposit' ? '交易确认中...' : '充值'}
                    </button>
                  </div>
                  <p className="mt-4 text-xs text-slate-400 text-center flex items-center justify-center">
                    费用优先从押金池扣除
                    <Hint title="关于押金">
                      每次调用都从押金池扣款并进入合约托管；押金不足会被智能合约拦截，
                      并自动在链上留下一条拦截记录（监管可见）。
                    </Hint>
                  </p>
                </div>
              </div>
            )}

            {/* 数据市场 */}
            {tab === 'market' && (
              <div className="space-y-8 animate-fade-in">
                {/* ★ AI 需求解析：一句自然语言 → 结构化条件 + 真实匹配理由 */}
                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white shadow-lg">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800 flex items-center">
                        AI 需求解析
                        <Hint title="AI 需求解析">
                          用一句话描述你要找的人群，AI 会解析成结构化条件（含可信度），
                          并比对字段链下数据集的实际属性给出匹配理由。AI 只做解读，不参与定价与扣款。
                        </Hint>
                      </h3>
                    </div>
                  </div>

                  <div className="flex flex-col md:flex-row gap-4">
                    <input
                      value={aiText}
                      onChange={(e) => setAiText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAiParse(); }}
                      placeholder="例：我需要 25-30 岁、喜欢运动户外、月消费 3000 以上的用户"
                      className="flex-1 px-5 py-3.5 rounded-2xl bg-slate-50 border-none text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all"
                    />
                    <button onClick={handleAiParse} disabled={!aiText.trim()}
                      className="px-8 py-3.5 rounded-2xl bg-slate-900 text-white text-sm font-bold transition-all hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed whitespace-nowrap">
                      解析需求
                    </button>
                  </div>

                  {aiResult && (
                    <div className="mt-6 space-y-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-xs font-bold text-slate-600">{aiResult.summary}</span>
                        <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                          aiResult.confidence >= 0.66 ? 'bg-emerald-50 text-emerald-600'
                            : aiResult.confidence > 0 ? 'bg-amber-50 text-amber-600'
                            : 'bg-slate-100 text-slate-500'
                        }`}>
                          解析可信度 {Math.round(aiResult.confidence * 100)}%
                        </span>
                      </div>

                      {aiResult.hits.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {aiResult.hits.map((h) => (
                            <span key={h.dim} className="text-xs px-3 py-1.5 rounded-full bg-cyan-50 text-cyan-700">
                              {h.dim}：{h.value}
                            </span>
                          ))}
                        </div>
                      )}

                      {aiRecs.length > 0 && (
                        <div className="rounded-2xl border border-slate-100 overflow-hidden">
                          <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-700">
                            AI 推荐字段（按与需求的匹配度排序 · 点击定位到下方字段卡片）
                          </div>
                          <div className="divide-y divide-slate-100">
                            {aiRecs.map((r) => {
                              const target = fields.find((f) => f.id === r.fieldId);
                              return (
                              <div key={r.fieldId}
                                onClick={() => jumpToField(target)}
                                title="点击定位到下方对应的字段卡片"
                                className="px-4 py-3.5 flex items-start justify-between gap-4 cursor-pointer hover:bg-cyan-50/40 transition-colors">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-bold text-slate-800">「{r.fieldName}」</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                      r.matched ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                                    }`}>
                                      匹配度 {Math.round(r.score * 100)}%
                                    </span>
                                    <span className="text-[10px] text-slate-400">样本 {r.sampleSize} 条</span>
                                  </div>
                                  <ul className="mt-1.5 space-y-0.5">
                                    {r.reasons.map((t, i) => (
                                      <li key={i} className={`text-[10px] ${t.startsWith('✓') ? 'text-emerald-600' : 'text-slate-400'}`}>{t}</li>
                                    ))}
                                  </ul>
                                </div>
                                <div className="shrink-0 flex items-center gap-2">
                                  {/* ★ 定位按钮：与整行点击同一个动作，显式提示「能跳转」 */}
                                  <button
                                    onClick={(e) => { e.stopPropagation(); jumpToField(target); }}
                                    className="px-3 py-2 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition-colors">
                                    定位
                                  </button>
                                  {permissions[r.fieldId] ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openCallModal(target); }}
                                      className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors">
                                      直接调用
                                    </button>
                                  ) : (
                                    <span className="px-4 py-2 rounded-xl bg-slate-50 text-slate-400 text-xs font-bold">需先申请授权</span>
                                  )}
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* ★ 无精确命中时的兜底提示：不给「匹配度 0%」的凑数推荐 */}
                      {aiRecs.length === 0 && (
                        <div className="px-4 py-4 rounded-2xl bg-amber-50/60 border border-amber-100 text-xs text-amber-700 leading-relaxed">
                          未找到与该需求匹配的字段。可换用字段名关键词（如「购物」「运动健康」），
                          或直接点【解析需求】旁的下方搜索框按字段名查找。
                        </div>
                      )}

                      <p className="text-[10px] text-slate-400 leading-relaxed">{AI_DISCLAIMER}</p>
                    </div>
                  )}
                </div>

                {/* ★ 原「精确筛选·条件」面板已移除：搜索功能由下方两组标题旁的搜索框承担 */}

                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  {/* ★ 标题行可点击折叠/展开；右侧为组内关键词搜索框 */}
                  <div className="flex items-center justify-between gap-4 mb-8">
                    <div className="flex items-center gap-3 cursor-pointer select-none" onClick={() => setAuthOpen((v) => !v)}>
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white shadow-lg">
                        <Store className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-800">已授权数据</h3>
                        <p className="text-xs text-slate-400 mt-0.5">已获授权 · 可直接调用</p>
                      </div>
                      <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${authOpen ? '' : '-rotate-90'}`} />
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="relative w-60 hidden md:block">
                        <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                        <input
                          value={authSearch}
                          onChange={(e) => setAuthSearch(e.target.value)}
                          placeholder="搜索字段名"
                          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 border-none text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                        />
                      </div>
                      <span className="text-xs text-slate-400 whitespace-nowrap">{filteredFields.length} 个字段</span>
                    </div>
                  </div>
                  {authOpen && (filteredFields.length === 0 ? <Empty text="没有符合条件的已授权数据" /> : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {filteredFields.map((f) => (
                        <div key={f.id} id={`field-card-${f.id}`}
                          className={`p-6 rounded-[1.5rem] bg-slate-50 hover:bg-white border transition-all duration-300 ${
                            highlightField === f.id
                              ? 'border-cyan-400 ring-2 ring-cyan-300/70 bg-white'
                              : 'border-transparent hover:border-slate-100 hover:shadow-[0_20px_40px_-20px_rgba(15,23,42,0.1)]'
                          }`}>
                          <div className="flex justify-between items-start mb-4">
                            <div className="text-lg font-bold text-slate-800">「{f.name}」</div>
                            <span className="text-xs font-medium text-slate-400 bg-white px-3 py-1 rounded-full shadow-sm">ID: {f.id}</span>
                          </div>
                          <div className="text-xs text-slate-500 mb-6 space-y-1">
                            <p>所有者：{shortAddr(f.owner)}</p>
                            <p>已调用：{f.callCount} 次</p>
                          </div>
                          <button onClick={() => openCallModal(f)}
                            className="w-full py-3 rounded-2xl bg-white text-slate-800 text-sm font-bold shadow-sm hover:bg-slate-900 hover:text-white transition-all duration-300">
                            直接调用
                            <span className="block mt-0.5 text-[10px] font-normal opacity-60">立即扣款 · 进入合约托管</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {unauthTotal > 0 && (
                  <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                    {/* ★ 标题行可点击折叠/展开；右侧为组内关键词搜索框（与已授权组独立） */}
                    <div className="flex items-center justify-between gap-4 mb-8">
                      <div className="flex items-center gap-3 cursor-pointer select-none" onClick={() => setUnauthOpen((v) => !v)}>
                        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white shadow-lg">
                          <Store className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-lg font-bold text-slate-800">未授权字段</h3>
                          <p className="text-xs text-slate-400 mt-0.5">需先申请授权 · 申请不扣款</p>
                        </div>
                        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${unauthOpen ? '' : '-rotate-90'}`} />
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="relative w-60 hidden md:block">
                          <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                          <input
                            value={unauthSearch}
                            onChange={(e) => setUnauthSearch(e.target.value)}
                            placeholder="搜索字段名"
                            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 border-none text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                          />
                        </div>
                        <span className="text-xs text-slate-400 whitespace-nowrap">{filteredUnauth.length} 个字段</span>
                      </div>
                    </div>
                    {unauthOpen && (filteredUnauth.length === 0 ? <Empty text="没有符合条件的未授权字段" /> : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {filteredUnauth.map((f) => (
                          <div key={f.id} id={`field-card-${f.id}`}
                            className={`p-6 rounded-[1.5rem] bg-slate-50 border flex flex-col justify-between transition-all duration-300 ${
                              highlightField === f.id ? 'border-cyan-400 ring-2 ring-cyan-300/70 bg-white' : 'border-transparent'
                            }`}>
                            <div>
                              <div className="text-lg font-bold text-slate-800 mb-2">「{f.name}」</div>
                              <div className="text-xs text-slate-500 mb-6">ID: {f.id} · 所有者 {shortAddr(f.owner)}</div>
                            </div>
                            <button
                              onClick={() => setApplyModal(f)}
                              className="w-full py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold transition-all duration-300 hover:bg-slate-800"
                            >
                              申请授权
                              <span className="block mt-0.5 text-[10px] font-normal opacity-60">不扣款 · 需数据所有者审批</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 调用记录 */}
            {/* ★ 托管结算：挑战期自动结算 / 提前结算 / 发起争议申诉 */}
            {tab === 'escrow' && (
              <div className="space-y-8 animate-fade-in">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                  <StatCard label="托管中金额" icon={Wallet} gradient="from-amber-400 to-orange-500" accent="text-amber-600" delay={0}
                    value={`${escrows.filter((e) => !e.settled).reduce((s, e) => s + Number(fmtEth(e.amount)), 0).toFixed(4)} ETH`} />
                  <StatCard label="挑战期内 · 待自动结算" icon={Activity} gradient="from-cyan-400 to-blue-500" accent="text-cyan-600" delay={80}
                    value={`${escrows.filter((e) => !e.settled && !e.disputed && e.confirmedAt === 0).length} 笔`} />
                  <StatCard label="争议中" icon={ShieldCheck} gradient="from-rose-400 to-red-500" accent="text-rose-500" delay={160}
                    value={`${escrows.filter((e) => e.disputed && !e.settled).length} 笔`} />
                </div>

                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-lg">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800 flex items-center">
                        托管结算单
                        <Hint title="可做的三件事" width="300">
                          默认无需任何操作 —— 挑战期满自动结算给数据所有者。<br />
                          · <b>提前结算</b>：加速放款<br />
                          · <b>取消订单</b>：资金原路退回押金池<br />
                          · <b>申诉</b>：锁定资金，交由监管裁决
                        </Hint>
                      </h3>
                    </div>
                  </div>

                  {escrows.length === 0 ? <Empty text="暂无托管结算单" /> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-left border-collapse">
                        <thead>
                          <tr className="text-xs text-slate-400 border-b border-slate-100">
                            <th className="pb-4 font-medium px-4">托管单</th>
                            <th className="pb-4 font-medium px-4">字段</th>
                            <th className="pb-4 font-medium px-4">数据所有者</th>
                            <th className="pb-4 font-medium px-4">交付凭证</th>
                            <th className="pb-4 font-medium px-4">状态</th>
                            <th className="pb-4 font-medium px-4 text-right">金额</th>
                            <th className="pb-4 font-medium px-4 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {escrows.map((e) => {
                            const remain = e.releaseAt - nowSec;
                            const inWindow = !e.settled && !e.disputed && e.confirmedAt === 0 && remain > 0;
                            // ★ 申诉不可用原因（v4.4）：窗口关闭后不再直接隐藏按钮，
                            //   改为禁用态 + 明确原因，避免企业不知道「为什么申诉不了」
                            const disputeBlockedReason = e.disputed ? '已在争议中，等待监管裁决'
                              : e.settled ? (e.refunded ? '该笔已退款结案，无需申诉' : '该笔已结算放款，申诉通道已关闭')
                              : e.confirmedAt > 0 ? '已确认收货（提前结算），申诉窗口已关闭'
                              : remain <= 0 ? `争议窗口已结束（挑战期 ${challengeSec} 秒），无法再申诉`
                              : '';
                            return (
                              <tr key={e.escrowId} className="group hover:bg-slate-50 transition-colors">
                                <td className="py-5 px-4 text-slate-500 font-mono text-xs">
                                  #{e.escrowId}
                                  <div className="text-[10px] text-slate-400 mt-1">{fmtTime(e.ts)}</div>
                                </td>
                                <td className="py-5 px-4 text-slate-800 font-medium">{e.fieldName}</td>
                                <td className="py-5 px-4 text-slate-500 font-mono text-xs">{shortAddr(e.user)}</td>
                                <td className="py-5 px-4">
                                  <button
                                    onClick={() => setProofRow(e)}
                                    title={`${e.deliveryHash}\n\n点击查看完整存证与证据链`}
                                    className="text-[11px] font-mono text-slate-500 bg-slate-50 hover:bg-slate-900 hover:text-white px-2 py-0.5 rounded-md transition-colors"
                                  >
                                    {shortHash(e.deliveryHash) || '—'}
                                  </button>
                                </td>
                                <td className="py-5 px-4">
                                  {e.refunded ? (
                                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 text-slate-500">已退款</span>
                                  ) : e.settled ? (
                                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-600">已放款</span>
                                  ) : e.disputed ? (
                                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-rose-50 text-rose-500" title={e.disputeReason}>
                                      争议中 · 待裁决
                                    </span>
                                  ) : e.confirmedAt > 0 ? (
                                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-cyan-50 text-cyan-600">已提前结算</span>
                                  ) : (
                                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-50 text-amber-600">
                                      {fmtCountdown(remain)}
                                    </span>
                                  )}
                                  {/* ★ 挑战期提示（v4.4）：明确告知窗口内可申诉，与倒计时并列展示 */}
                                  {!e.refunded && !e.settled && !e.disputed && e.confirmedAt === 0 && remain > 0 && (
                                    <div className="text-[10px] text-slate-400 mt-1" title={`挑战期共 ${challengeSec} 秒，期内可提前结算 / 取消订单 / 发起申诉`}>
                                      挑战期内可申诉
                                    </div>
                                  )}
                                  {e.disputed && e.disputeReason && (
                                    <div className="text-[10px] text-slate-400 mt-1 max-w-[180px] truncate" title={e.disputeReason}>
                                      理由：{e.disputeReason}
                                    </div>
                                  )}
                                </td>
                                <td className="py-5 px-4 text-right font-bold text-slate-700">-{fmtEth(e.amount)} ETH</td>
                                <td className="py-5 px-4 text-right whitespace-nowrap">
                                  {inWindow ? (
                                    <div className="flex items-center justify-end gap-2">
                                      <button
                                        onClick={() => handleConfirmDelivery(e.escrowId)}
                                        disabled={pending !== ''}
                                        className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold transition-all hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                                      >
                                        {pending === 'confirm' ? '处理中...' : '提前结算'}
                                      </button>
                                      <button
                                        onClick={() => handleCancelOrder(e.escrowId)}
                                        disabled={pending !== ''}
                                        title="挑战期内可取消，托管资金原路退回押金池"
                                        className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50 disabled:opacity-60 transition-colors"
                                      >
                                        {pending === 'cancel' ? '处理中...' : '取消订单'}
                                      </button>
                                      <button
                                        onClick={() => { setDisputeReason('交付数据与描述不符'); setDisputeModal({ escrowId: e.escrowId, fieldName: e.fieldName }); }}
                                        disabled={pending !== ''}
                                        className="px-3 py-1.5 rounded-xl bg-white border border-rose-200 text-rose-500 text-xs font-bold hover:bg-rose-50 disabled:opacity-60 transition-colors"
                                      >
                                        {pending === 'dispute' ? '处理中...' : '申诉'}
                                      </button>
                                    </div>
                                  ) : (
                                    // ★ 窗口关闭/已结算后的禁用态（v4.4）：按钮保留 + 原因说明，
                                    //   替代旧版直接显示「—」导致企业无从知晓申诉失败原因的问题
                                    <div className="flex flex-col items-end gap-1">
                                      <button
                                        disabled
                                        title={disputeBlockedReason}
                                        className="px-3 py-1.5 rounded-xl bg-white border border-rose-100 text-rose-300 text-xs font-bold cursor-not-allowed"
                                      >
                                        申诉
                                      </button>
                                      {disputeBlockedReason && (
                                        <span className="text-[10px] text-slate-300 max-w-[210px] text-right leading-snug" title={disputeBlockedReason}>
                                          {disputeBlockedReason}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'history' && (
              <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50 animate-fade-in">
                <div className="flex items-center gap-3 mb-8">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center text-white shadow-lg">
                    <History className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-800">调用记录</h3>
                </div>

                <div className="mb-8 p-6 rounded-2xl bg-slate-50/70 border border-slate-100 space-y-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-slate-500 whitespace-nowrap">字段</label>
                      <select
                        value={callFieldFilter}
                        onChange={(e) => setCallFieldFilter(e.target.value)}
                        className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                      >
                        <option value="全部">全部</option>
                        {calledFieldNames.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-slate-500 whitespace-nowrap">数据所有者</label>
                      <select
                        value={callOwnerFilter}
                        onChange={(e) => setCallOwnerFilter(e.target.value)}
                        className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                      >
                        <option value="全部">全部</option>
                        {calledOwners.map((addr) => <option key={addr} value={addr}>{shortAddr(addr)}</option>)}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-slate-500 whitespace-nowrap">时间</label>
                      <select
                        value={callTimeMode}
                        onChange={(e) => setCallTimeMode(e.target.value)}
                        className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-xs focus:outline-none focus:border-cyan-500"
                      >
                        {TIME_MODE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    {callTimeMode === '自定义' && <DateTimePicker value={callDate} onChange={setCallDate} />}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white border border-slate-200">
                      <Search className="w-4 h-4 text-slate-400" strokeWidth={2} />
                      <input
                        value={callKeyword}
                        onChange={(e) => setCallKeyword(e.target.value)}
                        placeholder="搜索字段名或所有者地址..."
                        className="flex-1 bg-transparent text-xs focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={() => {
                        setCallFieldFilter('全部');
                        setCallOwnerFilter('全部');
                        setCallTimeMode('全部');
                        setCallDate(EMPTY_DATE);
                        setCallKeyword('');
                      }}
                      className="px-6 py-2.5 rounded-xl bg-white border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      重置
                    </button>
                  </div>
                  <div className="text-xs text-slate-400">共 {filteredCalls.length} 条记录</div>
                </div>

                {filteredCalls.length === 0 ? <Empty text="暂无符合条件的调用记录" /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead>
                        <tr className="text-xs text-slate-400 border-b border-slate-100">
                          <th className="pb-4 font-medium px-4">时间</th>
                          <th className="pb-4 font-medium px-4">字段</th>
                          <th className="pb-4 font-medium px-4">数据所有者</th>
                          <th className="pb-4 font-medium px-4 text-right">消耗押金</th>
                          <th className="pb-4 font-medium px-4">结算状态</th>
                          <th className="pb-4 font-medium px-4 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredCalls.map((c, i) => (
                          <tr key={i} className="group hover:bg-slate-50 transition-colors">
                            <td className="py-5 px-4 text-slate-500 whitespace-nowrap text-xs">{fmtTime(c.ts)}</td>
                            <td className="py-5 px-4 text-slate-800 font-medium">{fields.find((f) => f.id === c.fieldId)?.name || `字段#${c.fieldId}`}</td>
                            <td className="py-5 px-4 text-slate-500 font-mono text-xs">{shortAddr(c.user)}</td>
                            <td className="py-5 px-4 text-right font-bold text-rose-500">-{fmtEth(c.amount)} ETH</td>
                            <td className="py-5 px-4">
                              <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                                c.refunded ? 'bg-slate-100 text-slate-500'
                                  : c.settled ? 'bg-emerald-50 text-emerald-600'
                                  : c.disputed ? 'bg-rose-50 text-rose-500'
                                  : c.confirmedAt > 0 ? 'bg-cyan-50 text-cyan-600'
                                  : 'bg-amber-50 text-amber-600'
                              }`}>
                                {c.refunded ? '已退款' : c.settled ? '已放款' : c.disputed ? '争议中' : c.confirmedAt > 0 ? '已提前结算' : '托管中'}
                              </span>
                              <div className="text-[10px] text-slate-400 font-mono mt-1" title={c.deliveryHash}>
                                {shortHash(c.deliveryHash) || '无凭证'}
                              </div>
                            </td>
                            <td className="py-5 px-4 text-right">
                              <button
                                onClick={() => setResultCard({
                                  fieldId: c.fieldId,
                                  fieldName: fields.find((f) => f.id === c.fieldId)?.name || `字段#${c.fieldId}`,
                                  owner: c.user,
                                  price: fmtEth(c.amount),
                                  txHash: c.txHash,
                                  deliveryHash: c.deliveryHash,
                                  // ★ 链下数据引用与托管单状态：存证重算与资金状态展示的必需字段
                                  dataRef: c.dataRef,
                                  refunded: c.refunded, settled: c.settled, disputed: c.disputed, confirmedAt: c.confirmedAt,
                                })}
                                className="px-4 py-2 rounded-xl bg-slate-100 text-xs font-bold text-slate-600 group-hover:bg-slate-900 group-hover:text-white transition-all"
                              >
                                查看结果
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ★ 设置弹窗（侧边栏底部入口） */}
      {settingsOpen && (
        <SettingsModal web3={web3} blockNumber={blockNumber} onClose={() => setSettingsOpen(false)} />
      )}

      {/* ★ 使用说明 / 疑问处 */}
      {helpOpen && (
        <HelpModal role="enterprise" onClose={() => setHelpOpen(false)} />
      )}

      {/* ★ 争议申诉弹窗 */}
      {/* ★ 上链存证抽屉（企业视角：仅本次授权字段的最小必要范围） */}
      {proofRow && (
        <ProofDrawer row={proofRow} contract={contract} viewer="enterprise" onClose={() => setProofRow(null)} />
      )}

      {disputeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setDisputeModal(null)} />
          <div className="relative w-full max-w-md bg-white shadow-xl rounded-3xl p-8 animate-fade-in">
            <h3 className="text-xl font-bold text-slate-900">发起争议申诉</h3>
            <p className="mt-2 text-xs text-slate-500">
              托管单 #{disputeModal.escrowId} · 字段「{disputeModal.fieldName}」
            </p>
            {/* ★ 交付凭证展示（v4.4）：申诉时直接展示该笔链上交付凭证哈希与本地摘要校验结果，
                让申诉理由有据可依，监管在裁决端也能看到同一凭证形成交叉验证 */}
            {disputeTarget && (
              <div className="mt-4 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">链上交付凭证</span>
                  {(() => {
                    const local = digestOfEscrow(disputeTarget);
                    const match = local && local === disputeTarget.deliveryHash;
                    return (
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${match ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                        {match ? '✓ 摘要校验一致' : '⚠ 摘要不一致 / 历史凭证'}
                      </span>
                    );
                  })()}
                </div>
                <div className="mt-1.5 text-[11px] font-mono text-slate-600 break-all leading-relaxed">
                  {shortHash(disputeTarget.deliveryHash) ? disputeTarget.deliveryHash : '—'}
                </div>
              </div>
            )}
            <div className="mt-6">
              <label className="block text-sm font-medium text-slate-500 mb-2">申诉理由</label>
              <textarea
                value={disputeReason}
                onChange={(e) => setDisputeReason(e.target.value)}
                rows={3}
                placeholder="请说明交付数据与约定不符的具体情况"
                className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border-none text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 transition-all resize-none"
              />
              {/* ★ 结构化预置理由（v4.4）：覆盖常见争议类型，摘要校验不一致项与上方凭证校验联动 */}
              <div className="mt-3 flex flex-wrap gap-2">
                {['交付数据与描述不符', '数据为空或不可用', '交付延迟超出约定', '重复计费', '摘要校验不一致（交付疑似被篡改）'].map((r) => (
                  <button key={r} onClick={() => setDisputeReason(r)}
                    className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-[11px] text-slate-500 hover:border-rose-300 hover:text-rose-500 transition-all">
                    {r}
                  </button>
                ))}
              </div>
              {/* ★ 实时剩余申诉时间（v4.4）：与合约 block.timestamp 判定口径一致（useChainNow），
                  归零后禁用提交并明确提示，避免发出注定失败的交易 */}
              {disputeTarget && !disputeTarget.settled && (
                <p className={`mt-3 text-[11px] font-medium ${disputeExpired ? 'text-rose-500' : 'text-slate-400'}`}>
                  {disputeExpired
                    ? '争议窗口已结束，无法再提交申诉'
                    : `剩余申诉时间：${Math.floor(disputeRemain / 60)} 分 ${String(disputeRemain % 60).padStart(2, '0')} 秒（挑战期 ${challengeSec} 秒）`}
                </p>
              )}
              <p className="mt-4 text-[11px] text-slate-400 flex items-center">
                申诉后资金锁定，等待监管裁决
                <Hint title="申诉后果">
                  资金将不再自动解锁。裁决退款则退回押金池；裁决驳回则放款给数据所有者，
                  并计入一次恶意申诉败诉（信誉分 −150）。
                </Hint>
              </p>
            </div>
            <div className="mt-8 flex gap-3">
              <button onClick={() => setDisputeModal(null)} disabled={pending !== ''}
                className="flex-1 px-5 py-3 rounded-2xl bg-white border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 disabled:opacity-60 transition-colors">
                取消
              </button>
              <button onClick={handleRaiseDispute} disabled={pending !== '' || disputeExpired}
                className="flex-1 px-5 py-3 rounded-2xl bg-rose-500 text-white text-sm font-bold hover:bg-rose-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors">
                {disputeExpired ? '窗口已结束' : pending === 'dispute' ? '提交中...' : '确认申诉'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 调用弹窗 */}
      {callModal && (
        // ★ 面板限高 + 内部滚动（与用户端弹窗同一写法）：小屏 / 投影仪（如 1366×768）下弹窗高于视口时，
        //   底部【确认调用并托管】仍能滚到，避免出现「按钮在屏幕外点不到」而中断演示
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setCallModal(null)} />
          <div className="relative w-full max-w-sm max-h-[85vh] overflow-y-auto bg-white shadow-xl rounded-3xl p-8 animate-fade-in">
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-bold text-slate-900">调用数据</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-600">已授权 · 立即扣款</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              调用「{callModal.name}」· 数据所有者 {shortAddr(callModal.owner)}
            </p>

            <div className="mt-4 px-4 py-3 rounded-2xl bg-cyan-50/70 border border-cyan-100">
              <p className="text-[11px] text-cyan-800">
                确认后立即从押金池扣除并进入合约托管，挑战期满自动结算。
              </p>
            </div>

            {/* ★ 授权范围（来自用户批准时的约定，企业不能超出） */}
            <div className="mt-5 px-4 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">已授予范围</span>
                <span className="text-xs font-bold text-slate-700 text-right">{callScopeLabel}</span>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200/70 pt-2.5">
                <span className="text-xs text-slate-500">本次数量</span>
                <span className="flex items-center gap-1.5">
                  <input
                    type="number" min="1" value={callUnits}
                    onChange={(e) => setCallUnits(Math.max(1, Number(e.target.value) || 1))}
                    className={`w-20 px-3 py-1.5 rounded-xl bg-white border text-xs text-right focus:outline-none transition-colors ${
                      callUnitsOver ? 'border-rose-300 text-rose-600 focus:border-rose-400' : 'border-slate-200 focus:border-cyan-500'
                    }`}
                  />
                  <span className="text-[11px] text-slate-400">{callPeriodType === 0 ? '次' : '天'}</span>
                </span>
              </div>
              {callUnitsOver && (
                <div className="text-[11px] text-rose-500 leading-relaxed">
                  超出授权范围：本次最多 {callMaxUnits} {callPeriodType === 0 ? '次' : '天'}。
                  超出会被合约拒绝，并留下一条拦截记录（监管可见）。
                </div>
              )}

              <div className="flex items-center justify-between border-t border-slate-200/70 pt-2.5">
                <span className="text-xs font-medium text-slate-600">本次扣款</span>
                <span className="text-lg font-bold text-slate-900">{callTotal.toFixed(4)} ETH</span>
              </div>

              <button
                onClick={() => setShowCallPriceNote((v) => !v)}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
              >
                计费说明（链上标准价）
                <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${showCallPriceNote ? 'rotate-180' : ''}`} />
              </button>
              {showCallPriceNote && (
                <p className="text-[10px] text-slate-400">
                  单价 {callPeriodType === 0 ? stdPrice.call : stdPrice.day} ETH / {callPeriodType === 0 ? '次' : '天'}，来自合约公开常量，任何一方都无法改价。
                </p>
              )}
            </div>
            {/* ★ 押金预检展示：不足时整行变红并显示差额 */}
            <div className={`mt-3 flex items-center justify-between px-4 py-3 rounded-2xl border ${
              callDepositOk ? 'bg-slate-50 border-slate-100' : 'bg-rose-50 border-rose-200'
            }`}>
              <span className="text-xs text-slate-500">押金池余额</span>
              <span className={`text-xs font-mono font-semibold ${callDepositOk ? 'text-slate-700' : 'text-rose-600'}`}>
                {depositBal}
                <span className="font-sans text-slate-400 mx-1.5">→</span>
                {callDepositOk ? `${callAfterDeposit.toFixed(4)} ETH` : `差 ${callDepositShort.toFixed(4)} ETH`}
              </span>
            </div>

            {/* ★ 押金不足警示框：一行给出本次需 / 余额；详细后果收进「?」说明，减少弹窗视觉干扰 */}
            {!callDepositOk && (
              <div className="mt-2 px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200">
                <p className="text-[11px] font-bold text-rose-600 flex items-center">
                  押金不足 —— 本次需 {callTotal.toFixed(4)} ETH，押金池仅 {depositBal} ETH
                  <Hint title="押金不足说明" width="300">
                    仍可确认：本次调用将由智能合约拦截并上链留痕（监管端可见、信誉分扣减 60）；
                    或先到【充值押金】补足后再调用。
                  </Hint>
                </p>
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button onClick={() => setCallModal(null)}
                className="flex-1 px-5 py-3 rounded-2xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors">
                取消
              </button>
              {/* ★ 确认按钮保持可点击：押金不足 / 超次由合约拦截并上链留痕（先存证再报错），
                  前端只在确认前给出警示文案，让「合约自动拦截」在监管端可见、可演示 */}
              <button onClick={() => handleCall(callModal.id, callPeriodType, callUnits)}
                disabled={pending !== ''}
                className="flex-1 px-5 py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold transition-all hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed">
                {pending === 'call' ? '交易确认中...' : '确认调用并托管'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 发起授权申请弹窗 */}
      {applyModal && (
        // ★ 同「调用弹窗」：面板限高 + 内部滚动，保证小屏下【提交申请】始终可达
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setApplyModal(null)} />
          <div className="relative w-full max-w-sm max-h-[85vh] overflow-y-auto bg-white shadow-xl rounded-3xl p-8 animate-fade-in">
            <div className="flex items-center gap-2">
              <h3 className="text-xl font-bold text-slate-900">申请调用授权</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">不扣款 · 待审批</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              申请调用「{applyModal.name}」· 数据所有者 {shortAddr(applyModal.owner)}
            </p>

            <div className="mt-4 px-4 py-3 rounded-2xl bg-amber-50/70 border border-amber-100">
              <p className="text-[11px] text-amber-800">
                这是<strong>授权申请，不会扣款</strong>；审批通过后，在「已授权数据」里调用才扣款。
              </p>
            </div>

            <div className="mt-5">
              <BillingPicker
                periodType={applyPeriodType}
                setPeriodType={setApplyPeriodType}
                units={applyUnits}
                setUnits={setApplyUnits}
                stdPrice={stdPrice}
              />
            </div>

            <div className="mt-3 flex items-center justify-between px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100">
              <span className="text-xs text-slate-500">审批通过后可用额度</span>
              <span className="text-xs font-semibold text-slate-700">
                {applyUnits} {applyPeriodType === 0 ? '次调用' : '天有效期'}
              </span>
            </div>

            <div className="mt-6 flex gap-3">
              <button onClick={() => setApplyModal(null)}
                className="flex-1 px-5 py-3 rounded-2xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 transition-colors">
                取消
              </button>
              <button
                onClick={() => handleApplyAuthorization(applyModal.id, applyPeriodType, applyUnits)}
                disabled={pending !== ''}
                className="flex-1 px-5 py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold transition-all hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {pending === 'apply' ? '提交中...' : '提交申请（不扣款）'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 调用成功 · ZKP 验证结果卡片 */}
      {resultCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setResultCard(null)} />
          <div className="relative w-full max-w-xl bg-white shadow-xl rounded-3xl overflow-hidden animate-fade-in">
            <div className="bg-gradient-to-br from-emerald-50 to-cyan-50 px-8 pt-8 pb-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg">
                  <ShieldCheck className="w-6 h-6 text-white" strokeWidth={2.5} />
                </div>
                <div>
                  <div className="text-lg font-bold text-slate-900">调用成功 · 数据已交付</div>
                  <div className="text-xs text-slate-500 mt-0.5">费用已进入合约托管</div>
                </div>
              </div>
            </div>

            <div className="px-8 py-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* ① 交付数据：企业实际拿到的链下数据文件内容 */}
              <div>
                <div className="text-xs font-bold text-slate-700 mb-2">交付数据</div>
                <DataPayloadView
                  payload={getDataPayload(resultCard.dataRef)}
                  fileUrl={dataFileUrl(resultCard.dataRef)}
                />
              </div>

              {/* ② 摘要校验：链下数据 vs 链上凭证 —— 三态判定：一致 / 无法重算（文件缺失）/ 真不一致 */}
              {(() => {
                const d = digestOfEscrow(resultCard);
                const match = d === resultCard.deliveryHash;
                const unverifiable = !d;   // 链下文件缺失或不可读 → 无法重算，不能据此判定"不一致"
                return (
                  <div className={`p-4 rounded-2xl border ${
                    match ? 'bg-emerald-50/60 border-emerald-100' : 'bg-amber-50/60 border-amber-100'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${
                        match ? 'text-emerald-700' : 'text-amber-700'
                      }`}>
                        {match ? '✓ 摘要校验一致' : unverifiable ? '⚠ 无法本地重算' : '⚠ 与链上凭证不一致'}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {match ? '链下数据未被篡改' : unverifiable ? '链下数据文件缺失或不可读，无法比对' : '链下数据与确权时可能已被修改'}
                      </span>
                    </div>
                    <div className="mt-3 space-y-1.5 text-[10px] font-mono break-all">
                      <div className="text-slate-500">本地重算摘要：<span className="text-slate-700">{d || '—（文件不可用）'}</span></div>
                      <div className="text-slate-500">链上存证凭证：<span className="text-slate-700">{resultCard.deliveryHash}</span></div>
                    </div>
                  </div>
                );
              })()}

              {/* ③ 链上托管凭证 */}
              <div className="p-6 rounded-2xl bg-slate-50 border border-slate-100">
                <div className="text-xs font-medium text-slate-400 mb-4">链上托管凭证</div>
                <div className="space-y-3 text-sm">
                  <ResultRow label="数据字段" value={`「${resultCard.fieldName}」`} />
                  <ResultRow label="数据所有者" value={<code className="text-xs font-mono">{shortAddr(resultCard.owner)}</code>} />
                  {resultCard.periodLabel && <ResultRow label="计费方式" value={resultCard.periodLabel} />}
                  <ResultRow label="扣款金额" value={<span className="text-emerald-600 font-bold">{resultCard.price} ETH</span>} />
                  {resultCard.blockNumber !== undefined && (
                    <ResultRow label="上链确认" value={
                      <span className="text-slate-600 font-mono text-xs">区块 #{resultCard.blockNumber}</span>
                    } />
                  )}
                  <ResultRow label="ZKP 验证" value={<span className="text-cyan-600">字段「{resultCard.fieldName}」属性谓词验证通过</span>} />
                  {/* ★ 资金状态与调用记录列表同一状态机 —— 修复弹窗恒显「托管中」与列表「已放款」矛盾 */}
                  <ResultRow label="资金状态" value={
                    resultCard.refunded ? <span className="text-slate-500">已退款（资金退回企业押金池）</span>
                      : resultCard.settled ? <span className="text-emerald-600 font-bold">已放款（资金已放款给数据所有者）</span>
                      : resultCard.disputed ? <span className="text-rose-500">争议中，等待监管裁决</span>
                      : resultCard.confirmedAt > 0 ? <span className="text-cyan-600">已提前结算</span>
                      : <span className="text-amber-600">合约托管中，挑战期满自动结算</span>
                  } />
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50">
                <div className="text-[10px] text-slate-400 mb-1">交易哈希</div>
                <code className="text-[10px] font-mono text-slate-600 break-all">{resultCard.txHash}</code>
              </div>
            </div>

            <div className="px-8 pb-8">
              <button
                onClick={() => setResultCard(null)}
                className="w-full py-4 rounded-2xl bg-slate-900 text-white text-sm font-bold transition-all hover:bg-slate-800"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ★ 计费选择器：周期 + 数量；单价来自「链上标准价」，前端只读展示、不参与传参
//   金额仅用于本地预估，真实扣款金额以合约按标准价计算为准
function BillingPicker({ periodType, setPeriodType, units, setUnits, stdPrice }) {
  const unit = Number(periodType === 0 ? stdPrice.call : stdPrice.day);
  const total = unit * Number(units || 0);
  const [showDetail, setShowDetail] = useState(false);   // ★ 计费说明默认折叠
  const OPTIONS = [
    { v: 0, label: '按次', price: stdPrice.call, suffix: '次' },
    { v: 1, label: '按天', price: stdPrice.day, suffix: '天' },
  ];

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-slate-500 mb-3">调用周期</label>
        <div className="space-y-3">
          {OPTIONS.map((o) => (
            <label
              key={o.v}
              className={`flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-all ${
                periodType === o.v ? 'bg-cyan-50/70 ring-2 ring-cyan-500' : 'bg-slate-50 hover:ring-2 hover:ring-cyan-300'
              }`}
            >
              <input
                type="radio"
                name="periodType"
                checked={periodType === o.v}
                onChange={() => setPeriodType(o.v)}
                className="w-4 h-4 accent-cyan-600"
              />
              <span className="text-sm font-medium text-slate-900">{o.label}</span>
              <span className="ml-auto text-xs text-slate-500">{o.price} ETH / {o.suffix}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <label className="block text-xs font-medium text-slate-500 mb-2">
          {periodType === 0 ? '次数' : '天数'}
        </label>
        <input
          value={units}
          onChange={(e) => setUnits(Math.max(1, Number(e.target.value) || 1))}
          type="number"
          min="1"
          step="1"
          className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-none text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all"
        />
      </div>

      {/* ★ 计费金额常显，单价与说明折叠，弹窗保持简洁 */}
      <div className="mt-5 p-4 rounded-2xl bg-slate-50 border border-slate-100">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">总计</span>
          <span className="text-lg font-bold text-slate-900">{total.toFixed(4)} ETH</span>
        </div>
        <button
          onClick={() => setShowDetail((v) => !v)}
          className="mt-2 flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
        >
          计费说明（链上标准价）
          <ChevronDown className={`w-3 h-3 transition-transform duration-300 ${showDetail ? 'rotate-180' : ''}`} />
        </button>
        {showDetail && (
          <div className="mt-2 pt-2 border-t border-slate-200/70 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">链上标准单价</span>
              <span className="text-[10px] font-bold text-slate-600">
                {unit} ETH <span className="font-normal text-slate-400">/ {periodType === 0 ? '次' : '天'}</span>
              </span>
            </div>
            <p className="text-[10px] text-slate-400">价格来自合约公开常量，任何一方都无法改价。</p>
          </div>
        )}
      </div>
    </>
  );
}

function ResultRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="text-slate-900 text-right break-all">{value}</span>
    </div>
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