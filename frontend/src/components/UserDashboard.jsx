// ============================================================
// UserDashboard.jsx —— 用户工作台
// ------------------------------------------------------------
// 侧边栏：概览 / 我的数据 / 授权申请 / 收益流水（贴边悬浮·可收缩）
// 顶部：灵动岛（右上角定位）
// 功能：
//   - 概览：总收益 + 近7日收益折线图 + 数据被调用比例饼图
//   - 我的数据：注册字段 + 字段列表（显示剩余次数/有效期）+ 授权开关
//   - 授权申请：查看企业申请（带周期/数量/单价），同意/拒绝
//   - 收益流水：企业调用数据分账明细
// ============================================================
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Area, AreaChart
} from 'recharts';
import {
  LayoutDashboard, Database as DatabaseIcon, Receipt,
  TrendingUp, Activity, Bell, ShieldCheck, Wallet, Sparkles
} from 'lucide-react';
import {
  shortAddr, shortHash, fmtEth, fmtTime, fmtCountdown, parseTxError, DEMO_ENTERPRISE_ADDRESS, emitGlobalError,
  syncChainClock, loadAllData, ACTIVE_NETWORK,
} from '../config.js';
import { authorizationTips } from '../ai.js';
// ★ 确权所需的零知识证明：在浏览器本地生成，权属密钥不出本机
import { getOwnershipSecret, makeOwnershipProof, makeDemoProof } from '../zk.js';
import { buildAllCharts, useChainEvents, useBlockNumber, useChainNow } from '../hooks/useWeb3.js';
// ★ 通知中心（v4.6 苹果精简版）：只推核心第三方事件（待审批 / 收益汇总 / 裁决），
//   点击直达功能页；markRead 用于自主审批后闭合对应待办红点
import {
  pushNotifications, nfAuthRequest, nfRevenueDigest,
  nfDisputeRaised, nfDisputeResolved, markRead,
} from '../notifications.js';
import Sidebar from './Sidebar';
import Hint from './Hint.jsx';
import SettingsModal from './SettingsModal';
import HelpModal from './HelpModal';

import Header from './Header';
import ProofDrawer from './ProofDrawer';
import WelcomeBanner from './WelcomeBanner';


const NAV = [
  { key: 'dashboard', label: '概览', icon: LayoutDashboard },
  { key: 'mydata', label: '我的数据', icon: DatabaseIcon },
  { key: 'requests', label: '授权申请', icon: Bell },
  { key: 'escrow', label: '托管结算', icon: Wallet },
  { key: 'revenue', label: '收益流水', icon: Receipt },
  { key: 'proofs', label: '取用凭证', icon: ShieldCheck }
];

// ★ 字段分类即链下数据文件标识（dataRef）：每个分类都对应 public/data/<分类>.json。
//   故意不提供「不限/自定义」选项 —— 那样确权出来的字段没有链下数据文件，
//   企业调用时会因交付摘要为空而被拦下，演示时看着像故障。分类必须落在真实数据集上。
const FIELD_CATEGORY_OPTIONS = [
  '消费偏好', '出行习惯', '购物偏好', '运动健康', '兴趣娱乐', '阅读学习', '饮食口味',
  '收入水平', '教育背景', '职业信息', '社交活跃', '设备偏好',
  '金融理财', '保险健康', '母婴育儿', '宠物生活', '汽车出行',
];

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

export default function UserDashboard({ web3, onNotice, onTx, mode, onToggleMode }) {
  const { contract, account } = web3;
  const me = account?.toLowerCase();

  const [tab, setTab] = useState('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);      // ★ 使用说明 / 疑问处   // ★ 设置弹窗
  const blockNumber = useBlockNumber(web3.provider);          // ★ 实时区块高度

  const [fields, setFields] = useState([]);
  const [perms, setPerms] = useState({});
  const [revenue, setRevenue] = useState([]);
  const [requests, setRequests] = useState([]);
  const [detail, setDetail] = useState(null);
  const [newFieldCategory, setNewFieldCategory] = useState('消费偏好');
  const [newField, setNewField] = useState('');
  const [proofStage, setProofStage] = useState('');     // ★ 生成证明的进度文案（确权要几秒）
  const [entAddr, setEntAddr] = useState(DEMO_ENTERPRISE_ADDRESS);
  const [pending, setPending] = useState('');
  const [revenueData, setRevenueData] = useState([]);
  const [pieData, setPieData] = useState([]);
  const [escrows, setEscrows] = useState([]);          // ★ 托管结算单（待结算 / 争议 / 已结算）
  const [proofRow, setProofRow] = useState(null);
  // 授权设置弹窗：对象 / 时效 / 次数上限；以及撤销二次确认
  const [authModal, setAuthModal] = useState(null);
  const [revokeModal, setRevokeModal] = useState(null);
  const [authEnt, setAuthEnt] = useState('');
  const [authMode, setAuthMode] = useState('forever');
  const [authDays, setAuthDays] = useState(30);
  const [callMode, setCallMode] = useState('unlimited');
  const [authMaxCalls, setAuthMaxCalls] = useState(10);
  const [authEntRole, setAuthEntRole] = useState(null); // 授权对象的链上角色（企业 / 未注册 / …）   // ★ 上链存证抽屉
  // ★ 链上标准价（合约常量，前端只读取用于展示）
  const [stdPrice, setStdPrice] = useState({ call: '0', day: '0' });
  // ★ 平台服务费比例（基点）：从链上常量读取，不在前端写死
  const [platformFeeBps, setPlatformFeeBps] = useState(0);

  const load = useCallback(async () => {
    if (!contract || !account) return;
    try {
      // ★ 先加载链下数据文件（取用凭证抽屉要展示它）
      await loadAllData();
      const count = Number(await contract.getFieldsCount());
      const list = [];
      const p = {};
      for (let i = 0; i < count; i++) {
        const f = await contract.fields(i);
        if (f.owner.toLowerCase() === me) {
          list.push({ id: i, name: f.name, callCount: Number(f.callCount) });
          // 读取授权详情（有效期 / 剩余次数）
          try {
            const perm = await contract.getPermission(i, entAddr.trim());
            p[i] = {
              active: perm.active,
              expiry: Number(perm.expiry),
              maxCalls: Number(perm.maxCalls),
              usedCalls: Number(perm.usedCalls),
            };
          } catch {
            p[i] = { active: false, expiry: 0, maxCalls: 0, usedCalls: 0 };
          }
        }
      }
      setFields(list);
      setPerms(p);

      // ★ 链上标准价：直接从合约常量读取，证明价格来自链上而非前端写死
      try {
        const [pc, pd] = await Promise.all([
          contract.STANDARD_PRICE_PER_CALL(),
          contract.STANDARD_PRICE_PER_DAY(),
        ]);
        setStdPrice({ call: fmtEth(pc), day: fmtEth(pd) });
        // 平台服务费比例（链上常量），用于把「总额」拆成「用户实得 + 平台服务费」
        const bps = await contract.PLATFORM_FEE_BPS();
        setPlatformFeeBps(Number(bps));
      } catch { /* 旧版合约无此常量，忽略 */ }

      const rev = await contract.queryFilter(contract.filters.RevenueDistributed(null, account, null), 0, 'latest');
      const rows = await Promise.all(rev.map(async (ev) => {
        const b = await ev.getBlock();
        return { fieldId: Number(ev.args.fieldId), enterprise: ev.args.enterprise, amount: ev.args.amount.toString(), ts: b.timestamp };
      }));
      setRevenue(rows.sort((a, b) => b.ts - a.ts));

      // ★ 托管结算单：先取 EscrowCreated 事件中属于当前用户的记录，再逐条读最新状态
      const escEvs = await contract.queryFilter(contract.filters.EscrowCreated(null, null, account), 0, 'latest');
      const escList = [];
      for (const ev of escEvs) {
        const id = Number(ev.args.escrowId);
        const e = await contract.escrows(id);
        const [ok, releaseAt] = await contract.canWithdraw(id);
        let fieldName = `字段#${Number(e.fieldId)}`;
        let dataRef = '';
        try {
          const f = await contract.fields(Number(e.fieldId));
          fieldName = f.name;
          dataRef = f.dataRef;
        } catch { /* 忽略 */ }
        const b = await ev.getBlock();
        escList.push({
          id,
          fieldId: Number(e.fieldId),
          fieldName,
          dataRef,
          enterprise: e.enterprise,
          amount: e.amount.toString(),
          deliveryHash: e.deliveryHash,
          createdAt: Number(e.createdAt),
          confirmedAt: Number(e.confirmedAt),
          disputed: e.disputed,
          settled: e.settled,
          refunded: e.refunded,
          disputeReason: e.disputeReason,
          releaseAt: Number(releaseAt),
          canWithdraw: ok,
          ts: b.timestamp,
          user: e.user,
          txHash: ev.transactionHash,
        });
      }
      setEscrows(escList.sort((a, b) => b.id - a.id));

      // 授权申请：新字段（含周期）
      const reqCount = Number(await contract.getAuthRequestsCount());
      const reqList = [];
      for (let i = 0; i < reqCount; i++) {
        const r = await contract.authRequests(i);
        if (r.user.toLowerCase() === me) {
          let fieldName = '未知字段';
          try { fieldName = (await contract.fields(Number(r.fieldId))).name; } catch {}
          reqList.push({
            id: i,
            fieldId: Number(r.fieldId),
            fieldName,
            enterprise: r.enterprise,
            periodType: Number(r.periodType),
            units: Number(r.units),
            unitPrice: r.unitPrice.toString(),
            totalPrice: r.totalPrice.toString(),
            resolved: r.resolved,
          });
        }
      }
      setRequests(reqList.sort((a, b) => b.id - a.id));

      // ============================================================
      // ★ 通知中心同步（v4.6 苹果精简版）：只推核心第三方事件
      //   待审批申请（待办）/ 数据被申诉（紧急）/ 裁决结果（结果）；
      //   逐笔收益合并为一条汇总通报；审批结果由用户本人操作产生，
      //   不推送（审批动作时直接闭合对应待办红点，见 handleApprove）。
      //   （重复推送按 id 去重；账户首次同步自动建立「已读基线」）
      // ============================================================
      try {
        const candidates = [];
        // 1) 核心待办：待审批申请保持未读红点，点击直达「授权申请」页
        reqList.forEach((r) => {
          if (!r.resolved) {
            candidates.push(nfAuthRequest({
              requestId: r.id, fieldName: r.fieldName,
              enterprise: shortAddr(r.enterprise), totalPrice: fmtEth(r.totalPrice),
            }, 'requests'));
          }
        });
        // 2) 资金变动：全部收益分账聚合为一条汇总通报（新分账入账自动更新并点亮）
        if (rows.length > 0) {
          const totalWei = rows.reduce((s, r) => s + BigInt(r.amount), 0n);
          candidates.push(nfRevenueDigest({
            count: rows.length, total: fmtEth(totalWei),
            ts: Math.max(...rows.map((r) => r.ts)) * 1000,
          }, 'revenue'));
        }
        // 3) 监管裁决：我的托管单被申诉（待决）/ 裁决结果（自动闭合申诉提醒）
        escList.forEach((e) => {
          const common = {
            escrowId: e.id, fieldName: e.fieldName,
            amount: fmtEth(e.amount), reason: e.disputeReason, ts: e.ts * 1000,
          };
          if (e.disputed && !e.settled) candidates.push(nfDisputeRaised(common, 'escrow', 'user'));
          if (e.disputed && e.settled) candidates.push(nfDisputeResolved({ ...common, refunded: e.refunded }, 'escrow', 'user'));
        });
        // drop：清洗历史版本已淘汰的通知（审批结果 / 逐笔收益）
        pushNotifications(account, candidates, (n) => (
          /^approval:req\d+:(ok|no)$/.test(n.id) || /^funds:rev/.test(n.id)
        ));
      } catch (e) {
        console.error('通知同步失败', e); // 通知失败不影响主数据加载
      }
    } catch (e) {
      console.error('加载用户数据失败', e);
      // ★ 同步失败不能静默——进入全局异常通道；文案按运行模式分支（模拟模式不提 Ganache）
      emitGlobalError(web3.isSim
        ? '演示数据同步失败：请刷新页面恢复；若仍异常，请在右上角设置中重置演示数据'
        : `用户数据同步失败：请确认钱包已连接 ${ACTIVE_NETWORK.label}（本地演示需 Ganache 在 7545 端口运行）后刷新页面`);
    }
  }, [contract, account, me, entAddr]);

  useEffect(() => { load(); }, [load, web3.eventsVersion]);

  // ★ 倒计时基准必须用「链上时间」而不是本地时钟
  //   合约用 block.timestamp 判定挑战期，而 Ganache 空闲时不出块、区块时间会冻结；
  //   用本地时钟会导致「界面已显示可提现、链上却仍判定未到期」（详见 useChainNow 注释）。
  //   ⚠️ 必须在下面那个 effect 之前声明：effect 的依赖数组在渲染时就要求值，
  //      声明在后会因 TDZ 抛出 ReferenceError。
  const nowSec = useChainNow(web3.provider, blockNumber);

  // ★ 倒计时归零后自动回链上复核一次
  //   canWithdraw 是 load() 时的快照，窗口到期后若不再拉取，链上认为「可提现」而前端仍是 false。
  //   这里在检测到某笔已到期但快照仍未解锁时，重新 load() 一次，保证按钮状态与链上一致。
  const refreshedRef = useRef('');
  useEffect(() => {
    const due = escrows.filter((e) => !e.settled && !e.disputed && !e.canWithdraw && e.releaseAt - nowSec <= 0);
    if (due.length === 0) return;
    const key = due.map((e) => e.id).join(',');
    if (refreshedRef.current === key) return;   // 同一批只复核一次，避免无限循环
    refreshedRef.current = key;
    load();
  }, [escrows, nowSec, load]);

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
      onNotice?.('error', parseTxError(e));
    } finally {
      setPending('');
    }
  };

  // ★ 最终要上链的字段名（分类 + 可选自定义名）
  const composedName = useMemo(() => {
    const category = newFieldCategory === '不限' ? '' : newFieldCategory;
    const custom = newField.trim();
    if (category && custom) return `${category}·${custom}`;
    if (category) return category;
    if (custom) return custom;
    return '';
  }, [newFieldCategory, newField]);

  // ★ 链上索引：链下数据文件标识（按分类对应 public/data/<分类>.json）
  const composedDataRef = useMemo(
    () => (newFieldCategory === '不限' ? '' : newFieldCategory),
    [newFieldCategory],
  );

  // ★ 重名检测：同一个人没必要确权两个同名资产 ——
  //   链上允许重复（fieldId 才是唯一标识，且同名不同内容在业务上是合理的），
  //   但界面上必须拦住，否则列表会出现两行一模一样的字段名，自己也分不清哪个是哪个。
  const dupField = useMemo(
    () => (composedName ? fields.find((f) => f.name === composedName) : null),
    [composedName, fields],
  );

  const handleRegisterField = async () => {
    const name = composedName;
    if (!name) { onNotice?.('error', '请选择字段分类或输入字段名称'); return; }
    if (dupField) {
      onNotice?.('error', `你已确权过「${name}」（#${dupField.id}），请换一个名称，例如「${name}·2026Q3」`);
      return;
    }

    await runTx('register', async () => {
      // ★ 第一步：在浏览器本地生成 ZK 权属证明（证明「我掌握该数据的权属密钥」）
      //   权属密钥只存在于本机浏览器、绝不上链；证明里的 owner 必须等于当前账户。
      //   演示模式：模拟合约不执行 Groth16 验证，用同形演示证明秒出且永不失败；
      //   链上模式：真实生成 Groth16 证明（snarkjs），安全性与真实链完全一致。
      setProofStage('① 正在生成零知识证明...');
      const secret = getOwnershipSecret(account);
      const pf = web3.isSim
        ? makeDemoProof(secret, account)
        : await makeOwnershipProof(secret, account);

      // ★ 第二步：字段名 + 权属证明 一起提交上链
      setProofStage('② 证明已生成，等待钱包确认...');
      // ★ 字段名 + 链上索引(dataRef) + 权属证明 一起上链
      //   数据本体在链下的数据文件里，链上只登记文件标识与内容摘要
      await confirmTx(contract.registerField(name, composedDataRef, pf.pA, pf.pB, pf.pC, pf.pubSignals));
    }, `字段「${name}」已上链确权`);

    setNewField('');
    setProofStage('');
  };

  const handleToggle = (field, active) => {
    if (active) { setRevokeModal({ field }); return; }
    setAuthEnt(entAddr.trim());
    setAuthMode('forever');
    setAuthDays(30);
    setCallMode('unlimited');
    setAuthMaxCalls(10);
    setAuthModal({ field });
  };

  // ★ 授权前在链上核对对方是否为「已注册企业」
  //   合约 grantPermissionWithLimit 内有 require(hasRole(ENTERPRISE_ROLE, enterprise))，
  //   若地址不是企业角色，这笔交易必然失败 —— 与其让用户吃一个英文报错，不如提前拦住。
  useEffect(() => {
    if (!contract || !authModal) { setAuthEntRole(null); return; }
    const ent = authEnt.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(ent)) { setAuthEntRole(null); return; }
    let alive = true;
    setAuthEntRole('checking');
    (async () => {
      try {
        const r = await contract.roleOf(ent);
        if (alive) setAuthEntRole(r);
      } catch {
        if (alive) setAuthEntRole(null);
      }
    })();
    return () => { alive = false; };
  }, [contract, authEnt, authModal]);

  // 确认授权：按用户选择的时效与次数上限上链
  const confirmAuth = async () => {    const field = authModal?.field;
    if (!field) return;
    const ent = authEnt.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(ent)) { onNotice?.('error', '请输入正确的企业地址'); return; }
    const expiry = authMode === 'forever' ? 0 : Math.floor(Date.now() / 1000) + Number(authDays) * 86400;
    const maxCalls = callMode === 'unlimited' ? 0 : Number(authMaxCalls);
    const scope = `${authMode === 'forever' ? '永久' : `${authDays} 天`}·${callMode === 'unlimited' ? '不限次数' : `限 ${authMaxCalls} 次`}`;
    await runTx('grant', async () => {
      await confirmTx(contract.grantPermissionWithLimit(field.id, ent, expiry, maxCalls));
    }, `已授权「${field.name}」给 ${shortAddr(ent)}（${scope}）`);
    // 授权对象若与当前「授权关系视角」不同，自动切过去
    // —— 否则回到表格会看不到刚做的授权，像是没生效
    if (ent.toLowerCase() !== entAddr.trim().toLowerCase()) setEntAddr(ent);
    setAuthModal(null);
  };

  // 确认撤销：撤销立即生效，后续调用会被合约拦截
  const confirmRevoke = async () => {
    const field = revokeModal?.field;
    if (!field) return;
    const ent = entAddr.trim();
    await runTx('revoke', async () => {
      await confirmTx(contract.revokePermission(field.id, ent));
    }, `已撤销对 ${shortAddr(ent)} 的授权，后续调用将被合约拦截`);
    setRevokeModal(null);
  };

  const handleApprove = (req) => runTx('approve', async () => {
    await confirmTx(contract.approveAuthorization(req.id));
    // ★ 审批结果由本人操作产生，不推送结果通知 —— 这里直接闭合对应「待审批」红点
    markRead(account, `approval:req${req.id}:open`);
  }, '已同意授权申请').then(() => setDetail(null));

  const handleDeny = (req) => runTx('deny', async () => {
    await confirmTx(contract.denyAuthorization(req.id));
    // ★ v4.6：拒绝同样由本人操作产生，直接闭合对应「待审批」红点
    markRead(account, `approval:req${req.id}:open`);
  }, '已拒绝授权申请').then(() => setDetail(null));

  // ★ 提现托管中的收益（企业提前结算后、或争议窗口结束后可提）
  const handleWithdraw = (escrowId) => runTx('withdraw', async () => {
    // ★ 时间闸门动作，两处特别处理（原因见 config.js 的 syncChainClock 注释）：
    //   ① 先把本地链的时钟推到真实时间 —— 否则 gas 估算会按"冻住的旧区块时间"误判
    //      「仍在争议窗口内」，交易在发出前就失败；
    //   ② 再显式指定 gasLimit —— 万一节点不支持 evm_mine，也确保交易能发出去
    //     （金额与条件仍由合约判定，前端只是不替合约做时间判断）。
    await syncChainClock();
    await confirmTx(contract.withdrawRevenue(escrowId, { gasLimit: 500000n }));
  }, '收益已提现到账');

  const refresh = useCallback(async () => {
    if (!contract || !account) return;
    const { userRevenueData, userPieData } = await buildAllCharts(contract, account);
    setRevenueData(userRevenueData);
    setPieData(userPieData);
  }, [contract, account]);

  useEffect(() => { refresh(); }, [refresh]);
  useChainEvents(contract, () => setTimeout(refresh, 1000));

  const hasRevenue = revenueData.some((d) => d.收益 > 0);
  const PIE_COLORS = ['#0891B2', '#10B981', '#F59E0B', '#8B5CF6'];
  const totalRevenue = revenue.reduce((s, r) => s + Number(fmtEth(r.amount)), 0);
  // ★ 托管中待结算的收益（尚未提现 / 未退款）
  const openEscrows = escrows.filter((e) => !e.settled && !e.refunded);
  // 按链上比例拆分：用户实得 / 平台服务费（退款不抽费，这里只用于"待结算收益"的展示）
  const splitOf = (amountWei) => {
    const total = Number(fmtEth(amountWei));
    const platform = platformFeeBps > 0 ? (total * platformFeeBps) / 10000 : 0;
    return { total, user: total - platform, platform };
  };

  const pendingTotal = openEscrows.reduce((s, e) => s + Number(fmtEth(e.amount)), 0);
  const pendingUserTotal = openEscrows.reduce((s, e) => s + splitOf(e.amount).user, 0);
  const disputedCount = escrows.filter((e) => e.disputed && !e.settled).length;
  const unread = requests.filter((r) => !r.resolved).length;

  // ★ 授权对象候选与状态判定
  //   合约层面有两条授权路径：① 企业申请 -> 用户审批（被动）② 用户直接主动授权（主动）。
  //   两条都合法，但界面上必须让用户清楚自己此刻在做哪一件事。
  const authEntNorm = authEnt.trim().toLowerCase();
  const entCandidates = [...new Set(requests.map((r) => r.enterprise))];
  const authPendingReq = requests.find((r) => !r.resolved && r.enterprise.toLowerCase() === authEntNorm);
  const authEverRequested = requests.some((r) => r.enterprise.toLowerCase() === authEntNorm);
  const authEntValid = /^0x[a-fA-F0-9]{40}$/.test(authEnt.trim());
  const viewEntValid = /^0x[a-fA-F0-9]{40}$/.test(entAddr.trim());

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

  return (
    <div className="min-h-screen bg-[#F4F7FE] font-sans flex p-4 gap-4">
      {/* 侧边栏 */}
      <Sidebar
        title="用户工作台"
        items={NAV}
        activeKey={tab}
        onChange={setTab}
        collapsed={collapsed}
        onToggle={setCollapsed}
        userAddress={account}
        userName="用户"
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

          {/* 顶部导航栏：左标题 + 右灵动岛组件群，随内容排布，避免悬浮遮挡 */}
          <Header
            variant="dashboard"
            title="用户工作台"
            account={account}
            role="user"
            mode={mode}
            onToggleMode={onToggleMode}
            onOpenLogin={() => {}}
            blockNumber={blockNumber}
            onSwitchAccount={web3.switchAccount}
            onLogout={handleLogout}
            onNavigate={(path) => {
              // ★ 通知跳转白名单（v4.5）：仅接受本工作台真实存在的页签 key，
              //   命中即直连切换页签；旧版「非 requests 一律落概览」的映射已移除
              if (['dashboard', 'mydata', 'requests', 'escrow', 'revenue', 'proofs'].includes(path)) setTab(path);
            }}
          />

          {/* 内容滚动区 */}
          <div className="flex-1 overflow-auto p-8 bg-[#FAFBFC]">

            {/* 概览 */}
            {tab === 'dashboard' && (
              <div className="space-y-8 animate-fade-in">
                <WelcomeBanner
                  greeting="欢迎回来"
                  name="数据所有者"
                  subtitle="确权、授权、收益提现与争议处理。"
                  icon={DatabaseIcon}
                  gradient="from-indigo-500 via-violet-500 to-purple-500"
                  action={{
                    label: '待处理授权申请',
                    value: `${unread} 笔`,
                    hint: unread > 0 ? '点击前往处理' : '暂无待处理事项',
                    onClick: unread > 0 ? () => setTab('requests') : undefined,
                  }}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8">
                  <StatCard label="已到账收益" value={`${totalRevenue.toFixed(4)} ETH`} accent="text-emerald-600" icon={TrendingUp}
                    gradient="from-emerald-400 to-teal-500" delay={0} />
                  <StatCard label="托管中待结算" value={`${pendingTotal.toFixed(4)} ETH`} accent="text-amber-600" icon={Receipt}
                    gradient="from-amber-400 to-orange-500" delay={60} />
                  <StatCard label="已授权字段" value={`${Object.values(perms).filter((p) => p && p.active).length} 个`} accent="text-cyan-600" icon={DatabaseIcon}
                    gradient="from-cyan-400 to-blue-500" delay={120} />
                  <StatCard label="数据被调用次数" value={`${fields.reduce((s, f) => s + f.callCount, 0)} 次`} accent="text-slate-800" icon={Activity}
                    gradient="from-purple-400 to-pink-500" delay={180} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
                  <div className="md:col-span-3 bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                    <div className="flex items-center gap-3 mb-8">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white shadow-lg">
                        <TrendingUp className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-800">近 7 日收益趋势</h3>
                    </div>
                    {!hasRevenue ? <Empty text="暂无收益数据" /> : (
                      <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={revenueData} margin={{ top: 8, right: 0, left: -20, bottom: 0 }}>
                            <defs>
                              <linearGradient id="lineFill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#0891B2" stopOpacity={0.35} />
                                <stop offset="100%" stopColor="#0891B2" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="4 4" stroke="#F1F5F9" vertical={false} />
                            <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} dy={10} />
                            <YAxis tick={{ fontSize: 12, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                            <Tooltip formatter={(v) => [`${v} ETH`, '收益']} contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 30px rgb(0,0,0,0.08)' }} />
                            <Area type="monotone" dataKey="收益" stroke="#0891B2" strokeWidth={2.5} fill="url(#lineFill)" dot={{ r: 4, fill: '#0891B2' }} activeDot={{ r: 6 }} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-2 bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                    <div className="flex items-center gap-3 mb-8">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white shadow-lg">
                        <Activity className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-800">数据被调用比例</h3>
                    </div>
                    {pieData.length === 0 ? <Empty text="暂无调用记录" /> : (
                      <>
                        <div className="h-56 relative">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3}>
                                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                              </Pie>
                              <Tooltip formatter={(v, n) => [`${v} 次`, n]} contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 30px rgb(0,0,0,0.08)' }} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <div className="text-2xl font-bold text-slate-900">{pieData.reduce((s, p) => s + p.value, 0)}</div>
                            <div className="text-xs text-slate-400">总次数</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap justify-center gap-3 mt-4">
                          {pieData.map((p, i) => (
                            <span key={p.name} className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                              <span className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                              {p.name}（{p.value} 次）
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 我的数据 */}
            {tab === 'mydata' && (
              <div className="space-y-8 animate-fade-in">
                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white shadow-lg">
                      <DatabaseIcon className="w-5 h-5" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800">注册新数据字段（上链确权）</h3>
                  </div>
                  <div className="flex flex-col md:flex-row gap-4">
                    <div className="md:w-48 shrink-0">
                      <label className="block text-sm font-medium text-slate-500 mb-2 flex items-center">
                        字段分类
                        <Hint title="链下数据文件">
                          每个分类对应一个链下数据文件 <code className="font-mono">data/&lt;分类&gt;.json</code>。<br />
                          确权时只把「文件标识（索引）」与「内容摘要（承诺）」上链，数据本体留在链下。
                        </Hint>
                      </label>
                      <select value={newFieldCategory} onChange={(e) => setNewFieldCategory(e.target.value)}
                        className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border-none text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all appearance-none cursor-pointer">
                        {FIELD_CATEGORY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-slate-500 mb-2">自定义名称（可选）</label>
                      <input value={newField} onChange={(e) => setNewField(e.target.value)} placeholder="例如：购物偏好"
                        className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border-none text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all" />
                    </div>
                    <div className="flex items-end">
                      <button onClick={handleRegisterField} disabled={pending !== '' || !!dupField}
                        className="px-8 py-3.5 rounded-2xl bg-slate-900 text-white text-sm font-bold transition-all duration-300 hover:bg-slate-800 hover:shadow-lg disabled:bg-slate-300 disabled:cursor-not-allowed whitespace-nowrap">
                        {pending === 'register' ? (proofStage || '交易确认中...') : '上链确权'}
                      </button>
                    </div>
                  </div>

                  {dupField && (
                    <p className="mt-4 text-xs text-amber-600 text-center">
                      已存在同名「{dupField.name}」（#{dupField.id}），请加后缀区分，如「{dupField.name}·2026Q3」
                    </p>
                  )}
                </div>

                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-white shadow-lg">
                      <DatabaseIcon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800 flex items-center">
                        授权关系视角
                        <Hint title="授权关系视角">
                          下面的开关表示「该企业」对各字段的授权状态，换一个地址即可管理与其他企业的授权关系。
                          你不必等企业来申请 —— 直接打开开关即「主动授权」，数据的持有权在你手上。
                        </Hint>
                      </h3>
                    </div>
                  </div>
                  <input value={entAddr} onChange={(e) => setEntAddr(e.target.value)} placeholder="0x..."
                    className={`w-full px-5 py-3.5 rounded-2xl border-none text-sm font-mono focus:outline-none focus:ring-2 transition-all ${
                      viewEntValid ? 'bg-slate-50 focus:ring-purple-500' : 'bg-rose-50 focus:ring-rose-400'
                    }`} />
                  {!viewEntValid && (
                    <p className="mt-3 text-xs text-rose-500">地址格式不正确（应为 0x + 40 位十六进制），当前不展示授权状态。</p>
                  )}
                </div>

                {fields.length === 0 ? <Empty text="还没有上链的数据字段" /> : (
                  <FieldList fields={fields} perms={perms} pending={pending} onToggle={handleToggle} stdPrice={stdPrice} entAddr={entAddr} onNotice={onNotice} />
                )}
              </div>
            )}

            {/* 授权申请 */}
            {tab === 'requests' && (
              <div className="space-y-8 animate-fade-in">
                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center text-white shadow-lg">
                        <Bell className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-slate-800">授权申请</h3>
                      {unread > 0 && (
                        <span className="text-xs px-3 py-1 rounded-full bg-red-50 text-red-500 font-bold">
                          {unread} 条待审批
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400">{requests.length} 条</span>
                  </div>

                  {requests.length === 0 ? <Empty text="暂无授权申请" /> : (
                    <div className="space-y-4">
                      {requests.map((r) => {
                        const periodLabel = r.periodType === 0 ? '按次' : '按天';
                        const unitLabel = r.periodType === 0 ? '次' : '天';
                        return (
                          <div key={r.id} className="p-6 rounded-[1.5rem] bg-slate-50 hover:bg-white border border-transparent hover:border-slate-100 hover:shadow-[0_20px_40px_-20px_rgba(15,23,42,0.1)] transition-all duration-300">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="text-base font-bold text-slate-800">
                                  「{r.fieldName}」调用申请
                                </div>
                                <div className="mt-2 text-sm text-slate-500">
                                  申请企业 <code className="font-mono bg-white px-2 py-0.5 rounded-md text-xs">{shortAddr(r.enterprise)}</code>
                                </div>
                                <div className="mt-2 text-sm text-slate-500">
                                  调用周期：{periodLabel} × {r.units} {unitLabel}
                                </div>
                                <div className="mt-2 text-sm text-slate-500">
                                  单价 {fmtEth(r.unitPrice)} ETH · 总计 <span className="text-emerald-600 font-bold">{fmtEth(r.totalPrice)} ETH</span>
                                </div>
                                <div className="mt-4">
                                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                                    r.resolved ? 'bg-slate-200 text-slate-500' : 'bg-amber-100 text-amber-600'
                                  }`}>
                                    {r.resolved ? '已处理' : '待审批'}
                                  </span>
                                </div>
                              </div>
                              {!r.resolved && (
                                <div className="flex gap-3 shrink-0">
                                  <button
                                    onClick={() => handleDeny(r)}
                                    disabled={pending !== ''}
                                    className="px-6 py-3 rounded-2xl bg-white border border-red-200 text-red-500 text-sm font-bold hover:bg-red-50 disabled:opacity-60 transition-colors"
                                  >
                                    {pending === 'deny' ? '处理中...' : '拒绝'}
                                  </button>
                                  <button
                                    onClick={() => handleApprove(r)}
                                    disabled={pending !== ''}
                                    className="px-6 py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed transition-all"
                                  >
                                    {pending === 'approve' ? '处理中...' : '同意'}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 收益流水 */}
            {tab === 'escrow' && (
              <div className="space-y-8 animate-fade-in">

                {/* ★ 托管结算：待结算 / 争议中，企业提前结算或窗口结束后可提现 */}
                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-lg">
                        <Receipt className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-slate-800 flex items-center">
                          托管结算（待提现）
                          <Hint title="托管结算与平台服务费">
                            调用费用先进入合约托管：挑战期满自动结算给你（无需任何操作）；
                            企业也可在挑战期内【提前结算】立即放款。若进入争议，则由监管裁决资金归属。<br /><br />
                            结算时按链上公开比例扣除平台服务费，左边数字是你实际到手的部分。
                          </Hint>
                        </h3>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-slate-400">托管中（实得 / 总额）</div>
                      <div className="text-xl font-bold text-amber-600">
                        {pendingUserTotal.toFixed(4)}
                        <span className="text-sm font-normal text-slate-400"> / {pendingTotal.toFixed(4)} ETH</span>
                      </div>

                    </div>
                  </div>

                  {openEscrows.length === 0 ? <Empty text="暂无托管中的收益" /> : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-sm text-left border-collapse">
                        <thead>
                          <tr className="text-xs text-slate-400 border-b border-slate-100">
                            <th className="pb-4 font-medium px-4">托管单</th>
                            <th className="pb-4 font-medium px-4">字段</th>
                            <th className="pb-4 font-medium px-4">调用企业</th>
                            <th className="pb-4 font-medium px-4">交付凭证</th>
                            <th className="pb-4 font-medium px-4">状态</th>
                            <th className="pb-4 font-medium px-4 text-right">金额</th>
                            <th className="pb-4 font-medium px-4 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {openEscrows.map((e) => {
                            const remain = e.releaseAt - nowSec;
                            // ★ canWithdraw 是 load() 时取的一次性链上快照（基于「最新区块时间戳」），
                            //   而 Ganache 空闲时不出块、该时间戳会冻结，导致窗口早已过去却仍返回 false。
                            //   因此以实时倒计时为准；留 1 秒余量避免因取整误差被合约拒绝。
                            const canWithdrawNow = !e.settled && !e.disputed && (e.canWithdraw || remain <= -1);
                            return (
                              <tr key={e.id} className="group hover:bg-slate-50 transition-colors">
                                <td className="py-5 px-4 text-slate-500 font-mono text-xs">#{e.id}</td>
                                <td className="py-5 px-4 text-slate-800 font-medium">{e.fieldName}</td>
                                <td className="py-5 px-4 text-slate-500 font-mono text-xs">{shortAddr(e.enterprise)}</td>
                                <td className="py-5 px-4">
                                  <code className="text-[11px] font-mono text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md" title={e.deliveryHash}>
                                    {shortHash(e.deliveryHash) || '—'}
                                  </code>
                                </td>
                                <td className="py-5 px-4">
                                  {e.disputed ? (
                                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-red-50 text-red-500">
                                      争议中 · 待裁决
                                    </span>
                                  ) : canWithdrawNow ? (
                                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-600">
                                      可提现
                                    </span>
                                  ) : (
                                    <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-50 text-amber-600">
                                      {remain <= 0 ? '即将可提现' : fmtCountdown(remain)}
                                    </span>
                                  )}
                                </td>
                                <td className="py-5 px-4 text-right">
                                  <div className="font-bold text-amber-600">+{splitOf(e.amount).user.toFixed(4)} ETH</div>
                                  {platformFeeBps > 0 && (
                                    <div className="mt-0.5 text-[10px] text-slate-400">
                                      总额 {splitOf(e.amount).total.toFixed(4)} · 平台服务费 {splitOf(e.amount).platform.toFixed(4)}
                                    </div>
                                  )}
                                </td>
                                <td className="py-5 px-4 text-right whitespace-nowrap">
                                  <button
                                    onClick={() => setProofRow({ ...e, escrowId: e.id, user: account })}
                                    className="mr-2 px-3 py-1.5 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200 transition-all"
                                  >
                                    存证
                                  </button>
                                  <button
                                    onClick={() => handleWithdraw(e.id)}
                                    disabled={!canWithdrawNow || pending !== ''}
                                    title={canWithdrawNow ? '提现到钱包' : '挑战期结束后或企业提前结算后可提现'}
                                    className="px-4 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold transition-all hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
                                  >
                                    {pending === 'withdraw' ? '确认中...' : '提现'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {disputedCount > 0 && (
                    <p className="mt-6 text-xs text-red-500 bg-red-50 rounded-2xl px-5 py-3">
                      {disputedCount} 笔收益争议中，资金已锁定，等待监管裁决。
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* 已到账收益流水 */}
            {tab === 'revenue' && (
                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white shadow-lg">
                      <TrendingUp className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">已到账收益流水</h3>
                      <p className="text-xs text-slate-400 mt-1">提现完成后收益才真正转入你的钱包</p>
                    </div>
                  </div>
                  {revenue.length === 0 ? <Empty text="暂无已到账收益记录" /> : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-sm text-left border-collapse">
                        <thead>
                          <tr className="text-xs text-slate-400 border-b border-slate-100">
                            <th className="pb-4 font-medium px-4">时间</th>
                            <th className="pb-4 font-medium px-4">字段</th>
                            <th className="pb-4 font-medium px-4">调用企业</th>
                            <th className="pb-4 font-medium px-4 text-right">到账收益</th>
                          </tr>
                        </thead>
                        <tbody>
                          {revenue.map((r, i) => (
                            <tr key={i} className="group hover:bg-slate-50 transition-colors">
                              <td className="py-5 px-4 text-slate-500 whitespace-nowrap text-xs">{fmtTime(r.ts)}</td>
                              <td className="py-5 px-4 text-slate-800 font-medium">{fields.find((f) => f.id === r.fieldId)?.name || `字段#${r.fieldId}`}</td>
                              <td className="py-5 px-4 text-slate-500 font-mono text-xs">{shortAddr(r.enterprise)}</td>
                              <td className="py-5 px-4 text-right font-bold text-emerald-600">+{fmtEth(r.amount)} ETH</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
            )}

            {/* ★ 企业取用凭证：链上存证，用户可核验「谁在何时取走了哪条数据」 */}
            {tab === 'proofs' && (
                <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50">
                  <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center text-white shadow-lg">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800 flex items-center">
                        企业取用凭证
                        <Hint title="取用凭证">
                          每一次交付都会在链上留一枚凭证：谁、何时、取走哪条字段、交付内容摘要与结算状态。
                          链上只存摘要哈希，原始个人数据不出域。
                        </Hint>
                      </h3>
                    </div>
                  </div>
                  {escrows.length === 0 ? <Empty text="暂无企业取用记录" /> : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[720px] text-sm text-left border-collapse">
                        <thead>
                          <tr className="text-xs text-slate-400 border-b border-slate-100">
                            <th className="pb-4 font-medium px-4">取用时间</th>
                            <th className="pb-4 font-medium px-4">数据字段</th>
                            <th className="pb-4 font-medium px-4">取用企业</th>
                            <th className="pb-4 font-medium px-4">交付凭证哈希</th>
                            <th className="pb-4 font-medium px-4">结算状态</th>
                            <th className="pb-4 font-medium px-4 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {escrows.map((e) => (
                            <tr key={e.id} className="group hover:bg-slate-50 transition-colors">
                              <td className="py-5 px-4 text-slate-500 whitespace-nowrap text-xs">{fmtTime(e.ts)}</td>
                              <td className="py-5 px-4 text-slate-800 font-medium">{e.fieldName}</td>
                              <td className="py-5 px-4 text-slate-500 font-mono text-xs">{shortAddr(e.enterprise)}</td>
                              <td className="py-5 px-4">
                                <code className="text-[11px] font-mono text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md" title={e.deliveryHash}>
                                  {shortHash(e.deliveryHash) || '—'}
                                </code>
                              </td>
                              <td className="py-5 px-4 text-right">
                                <span className={`text-xs font-bold px-3 py-1 rounded-full ${
                                  e.refunded ? 'bg-slate-100 text-slate-500'
                                    : e.settled ? 'bg-emerald-50 text-emerald-600'
                                    : e.disputed ? 'bg-red-50 text-red-500'
                                    : 'bg-amber-50 text-amber-600'
                                }`}>
                                  {e.refunded ? '已退款' : e.settled ? '已提现' : e.disputed ? '争议中' : '托管中'}
                                </span>
                              </td>
                              <td className="py-5 px-4 text-right">
                                <button
                                  onClick={() => setProofRow({ ...e, escrowId: e.id, user: account })}
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
            )}
          </div>
        </div>
      </main>

      {/* 授权设置弹窗：明确「授权给谁、多久、多少次」 */}
      {authModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setAuthModal(null)} />
          <div className="relative w-full max-w-md bg-white shadow-xl rounded-3xl p-8 animate-fade-in max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-slate-900">设置授权范围</h3>
            <p className="mt-2 text-sm text-slate-500">
              字段「{authModal.field.name}」· 历史调用 {authModal.field.callCount} 次
            </p>

            {/* ★ 明确区分两种授权路径：企业申请后的「审批」 vs 用户发起的「主动授权」 */}
            {authPendingReq ? (
              <div className="mt-4 px-4 py-3 rounded-2xl bg-amber-50/70 border border-amber-100">
                <div className="text-[11px] font-bold text-amber-800">该企业已提交申请 —— 这里是审批</div>
                <div className="mt-1 text-[11px] text-amber-700">
                  申请内容：{authPendingReq.periodType === 0 ? '按次' : '按天'} × {authPendingReq.units}。你正在设定批准范围。
                </div>
              </div>
            ) : authEverRequested ? (
              <div className="mt-4 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100 text-[11px] text-slate-600">
                此前申请过（已处理）—— 你正在<span className="font-bold">主动调整</span>授权范围。
              </div>
            ) : (
              <div className="mt-4 px-4 py-3 rounded-2xl bg-cyan-50/60 border border-cyan-100 text-[11px] text-cyan-800">
                该企业尚未发起申请 —— 你正在<span className="font-bold">主动授权</span>（数据持有权在你手上）。
              </div>
            )}

            <div className="mt-5">
              <label className="block text-xs font-medium text-slate-500 mb-2">授权对象企业地址</label>
              <input value={authEnt} onChange={(e) => setAuthEnt(e.target.value)} placeholder="0x..."
                className={`w-full px-5 py-3.5 rounded-2xl border-none text-sm font-mono focus:outline-none focus:ring-2 transition-all ${
                  authEntValid ? 'bg-slate-50 focus:ring-cyan-500' : 'bg-rose-50 focus:ring-rose-400'
                }`} />
              {!authEntValid && (
                <div className="mt-2 text-[11px] text-rose-500">地址格式不正确（应为 0x + 40 位十六进制），已禁用确认。</div>
              )}
              {authEntValid && authEntRole === 'checking' && (
                <div className="mt-2 text-[11px] text-slate-400">正在链上核对该地址的角色…</div>
              )}
              {authEntValid && authEntRole && authEntRole !== 'checking' && (
                authEntRole === 'enterprise' ? (
                  <div className="mt-2 text-[11px] text-emerald-600">✓ 链上已注册为「企业」角色，可以授权</div>
                ) : (
                  <div className="mt-2 text-[11px] text-rose-500">
                    该地址在链上是「{authEntRole === 'none' ? '未注册' : authEntRole === 'user' ? '用户' : '监管'}」角色；
                    合约只允许授权给已注册企业，这笔交易会被拒绝。
                  </div>
                )
              )}

              {entCandidates.length > 0 && (
                <div className="mt-3">
                  <div className="text-[11px] text-slate-400 mb-1.5">从向你申请过的企业中选择</div>
                  <div className="flex flex-wrap gap-2">
                    {entCandidates.map((a) => (
                      <button key={a} onClick={() => setAuthEnt(a)}
                        className={`text-[11px] font-mono px-3 py-1.5 rounded-full border transition-colors ${
                          a.toLowerCase() === authEntNorm
                            ? 'bg-cyan-50 border-cyan-200 text-cyan-700'
                            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}>
                        {shortAddr(a)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5">
              <label className="block text-xs font-medium text-slate-500 mb-3">授权时效</label>
              <div className="space-y-2.5">
                <label className={`flex items-center gap-3 p-3.5 rounded-2xl cursor-pointer transition-all ${
                  authMode === 'forever' ? 'bg-cyan-50/70 ring-2 ring-cyan-500' : 'bg-slate-50 hover:ring-2 hover:ring-cyan-300'
                }`}>
                  <input type="radio" name="authMode" checked={authMode === 'forever'} onChange={() => setAuthMode('forever')} className="w-4 h-4 accent-cyan-600" />
                  <span className="text-sm font-medium text-slate-900">永久有效</span>
                  <span className="ml-auto text-xs text-slate-500">直到你主动撤销</span>
                </label>
                <label className={`flex items-center gap-3 p-3.5 rounded-2xl cursor-pointer transition-all ${
                  authMode === 'days' ? 'bg-cyan-50/70 ring-2 ring-cyan-500' : 'bg-slate-50 hover:ring-2 hover:ring-cyan-300'
                }`}>
                  <input type="radio" name="authMode" checked={authMode === 'days'} onChange={() => setAuthMode('days')} className="w-4 h-4 accent-cyan-600" />
                  <span className="text-sm font-medium text-slate-900">指定天数</span>
                  <input type="number" min="1" value={authDays} onChange={(e) => setAuthDays(Math.max(1, Number(e.target.value) || 1))}
                    disabled={authMode !== 'days'}
                    className="ml-auto w-20 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs text-right disabled:opacity-40 focus:outline-none focus:border-cyan-500" />
                  <span className="text-xs text-slate-400">天</span>
                </label>
              </div>
            </div>

            <div className="mt-5">
              <label className="block text-xs font-medium text-slate-500 mb-3">调用次数上限</label>
              <div className="space-y-2.5">
                <label className={`flex items-center gap-3 p-3.5 rounded-2xl cursor-pointer transition-all ${
                  callMode === 'unlimited' ? 'bg-cyan-50/70 ring-2 ring-cyan-500' : 'bg-slate-50 hover:ring-2 hover:ring-cyan-300'
                }`}>
                  <input type="radio" name="callMode" checked={callMode === 'unlimited'} onChange={() => setCallMode('unlimited')} className="w-4 h-4 accent-cyan-600" />
                  <span className="text-sm font-medium text-slate-900">不限次数</span>
                </label>
                <label className={`flex items-center gap-3 p-3.5 rounded-2xl cursor-pointer transition-all ${
                  callMode === 'limited' ? 'bg-cyan-50/70 ring-2 ring-cyan-500' : 'bg-slate-50 hover:ring-2 hover:ring-cyan-300'
                }`}>
                  <input type="radio" name="callMode" checked={callMode === 'limited'} onChange={() => setCallMode('limited')} className="w-4 h-4 accent-cyan-600" />
                  <span className="text-sm font-medium text-slate-900">限定次数</span>
                  <input type="number" min="1" value={authMaxCalls} onChange={(e) => setAuthMaxCalls(Math.max(1, Number(e.target.value) || 1))}
                    disabled={callMode !== 'limited'}
                    className="ml-auto w-20 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs text-right disabled:opacity-40 focus:outline-none focus:border-cyan-500" />
                  <span className="text-xs text-slate-400">次</span>
                </label>
              </div>
            </div>

            <p className="mt-4 text-[11px] text-slate-400 flex items-center">
              授权后可随时撤销，撤销立即生效
              <Hint title="关于撤销">
                撤销后该企业无法再调用该字段，后续调用会被合约拦截并留痕；
                已发生的调用与已进入托管的收益不受影响。授权与撤销都会写入区块链，可审计、不可篡改。
              </Hint>
            </p>

            {/* ★ AI 合规提示：授权前的风险告知（对应个人信息保护法的"告知—同意 + 最小必要"） */}
            <div className="mt-4 px-4 py-3.5 rounded-2xl bg-cyan-50/50 border border-cyan-100">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-cyan-600" />
                <span className="text-[11px] font-bold text-cyan-800">AI 合规提示</span>
              </div>
              <ul className="space-y-1.5">
                {authorizationTips({
                  fieldName: authModal.field.name,
                  enterprise: authEnt,
                  mode: authMode,
                  days: authDays,
                  maxCalls: callMode === 'unlimited' ? 'unlimited' : authMaxCalls,
                  known: Number(authModal.field.callCount) > 0,
                }).map((t, i) => (
                  <li key={i} className="text-[11px] text-slate-600 leading-relaxed flex gap-1.5">
                    <span className="text-cyan-500 shrink-0">·</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 flex gap-3">
              <button onClick={() => setAuthModal(null)} disabled={pending !== ''}
                className="flex-1 px-5 py-3 rounded-2xl bg-white border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 disabled:opacity-60 transition-colors">
                取消
              </button>
              <button onClick={confirmAuth} disabled={pending !== '' || !authEntValid || authEntRole !== 'enterprise'}
                className="flex-1 px-5 py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold transition-all hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed">
                {pending === 'grant' ? '交易确认中...' : (authPendingReq ? '同意并授权' : '确认授权')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 撤销授权二次确认 */}
      {revokeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setRevokeModal(null)} />
          <div className="relative w-full max-w-sm bg-white shadow-xl rounded-3xl p-8 animate-fade-in">
            <h3 className="text-xl font-bold text-slate-900">撤销授权？</h3>
            <p className="mt-3 text-sm text-slate-500 leading-relaxed">
              字段「{revokeModal.field.name}」现已授权给 <code className="font-mono text-xs">{shortAddr(entAddr)}</code>。
              撤销后该企业<strong>无法再调用</strong>，已发生的调用与托管收益不受影响。
            </p>
            <div className="mt-8 flex gap-3">
              <button onClick={() => setRevokeModal(null)} disabled={pending !== ''}
                className="flex-1 px-5 py-3 rounded-2xl bg-white border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 disabled:opacity-60 transition-colors">
                保持授权
              </button>
              <button onClick={confirmRevoke} disabled={pending !== ''}
                className="flex-1 px-5 py-3 rounded-2xl bg-red-500 text-white text-sm font-bold hover:bg-red-600 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors">
                {pending === 'revoke' ? '处理中...' : '确认撤销'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ★ 上链存证详情抽屉 */}
      {proofRow && (
        <ProofDrawer row={proofRow} contract={contract} viewer="user" onClose={() => setProofRow(null)} />
      )}

      {/* ★ 设置弹窗（侧边栏底部入口） */}
      {settingsOpen && (
        <SettingsModal web3={web3} blockNumber={blockNumber} onClose={() => setSettingsOpen(false)} />
      )}

      {/* ★ 使用说明 / 疑问处 */}
      {helpOpen && (
        <HelpModal role="user" onClose={() => setHelpOpen(false)} />
      )}

      {/* 授权申请详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setDetail(null)} />
          <div className="relative w-full max-w-sm bg-white shadow-xl rounded-3xl p-8 animate-fade-in">
            <h3 className="text-xl font-bold text-slate-900">授权申请详情</h3>
            <div className="mt-6 space-y-3 text-sm">
              <Row label="数据字段" value={`「${detail.fieldName}」`} />
              <Row label="申请企业" value={<code className="text-xs font-mono bg-slate-100 px-2 py-0.5 rounded-md">{shortAddr(detail.enterprise)}</code>} />
              <Row label="调用周期" value={`${detail.periodType === 0 ? '按次' : '按天'} × ${detail.units}`} />
              <Row label="单价" value={<span className="text-slate-700">{fmtEth(detail.unitPrice)} ETH</span>} />
              <Row label="总计" value={<span className="text-emerald-600 font-bold">{fmtEth(detail.totalPrice)} ETH</span>} />
              <Row label="状态" value={detail.resolved ? '已处理' : '待审批'} />
            </div>
            {!detail.resolved && (
              <div className="mt-8 flex gap-3">
                <button onClick={() => handleDeny(detail)} disabled={pending !== ''}
                  className="flex-1 px-5 py-3 rounded-2xl bg-white border border-red-200 text-red-500 text-sm font-bold hover:bg-red-50 disabled:opacity-60 transition-colors">
                  {pending === 'deny' ? '交易确认中...' : '拒绝'}
                </button>
                <button onClick={() => handleApprove(detail)} disabled={pending !== ''}
                  className="flex-1 px-5 py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold transition-all hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed">
                  {pending === 'approve' ? '交易确认中...' : '同意'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// 字段列表：显示剩余次数 / 有效期 / 链上标准价
function FieldList({ fields, perms, pending, onToggle, stdPrice, entAddr, onNotice }) {
  return (
    <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] border border-slate-50 overflow-hidden">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-slate-400 to-slate-600 flex items-center justify-center text-white shadow-lg">
            <DatabaseIcon className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-slate-800">我的数据字段</h3>
        </div>
        <span className="text-xs text-slate-400">{fields.length} 个字段</span>
      </div>
      
      {/* ★ 横向滚动层：窄视口（如 MetaMask 侧栏挤压）下锁定最小列宽，出滚动条可左右滑动查看全部列 */}
      <div className="overflow-x-auto">
      <div className="min-w-[640px]">
      <div className="flex items-center px-4 py-3 text-xs text-slate-400 border-b border-slate-100 bg-slate-50/50 rounded-t-2xl">
        <div className="flex-1 pl-2">字段名称</div>
        <div className="w-20 text-center">fieldId</div>
        <div className="w-20 text-center">调用次数</div>
        <div className="w-44 text-center">授权状态</div>
        <div className="w-32 text-center">链上标准价</div>
        <div className="w-20 text-center">授权开关</div>
      </div>
      <div className="divide-y divide-slate-100">
        {fields.map((f) => {
          const displayName = f.name.includes('·') ? f.name.split('·').slice(1).join('·') : f.name;
          const category = f.name.includes('·') ? f.name.split('·')[0] : '';
          const perm = perms[f.id] || {};

          // 授权状态文案
          let statusText = '未授权';
          let statusColor = 'bg-slate-100 text-slate-400';
          if (perm.active) {
            const parts = [];
            if (perm.maxCalls > 0) {
              const remain = Math.max(0, perm.maxCalls - perm.usedCalls);
              parts.push(`剩余 ${remain}/${perm.maxCalls} 次`);
            } else {
              parts.push('不限次数');
            }
            if (perm.expiry > 0) {
              const d = new Date(perm.expiry * 1000);
              const expired = Date.now() >= perm.expiry * 1000;
              const mm = String(d.getMonth() + 1).padStart(2, '0');
              const dd = String(d.getDate()).padStart(2, '0');
              parts.push(expired ? '已过期' : `有效期至 ${mm}/${dd}`);
            } else {
              parts.push('永久有效');
            }
            statusText = parts.join(' · ');
            statusColor = 'bg-emerald-50 text-emerald-600';
          }

          return (
            <div key={f.id} className="flex items-center px-4 py-5 hover:bg-slate-50 transition-colors">
              <div className="flex-1 pl-2 min-w-0">
                <div className="text-sm font-bold text-slate-800 truncate">{displayName}</div>
                {category && <div className="mt-1 text-xs text-slate-400 font-medium">分类：{category}</div>}
              </div>
              <div className="w-20 text-center text-xs text-slate-500 font-mono">#{f.id}</div>
              <div className="w-20 text-center text-xs text-slate-500 font-medium">{f.callCount} 次</div>

              <div className="w-44 text-center">
                <span className={`text-xs font-bold px-3 py-1 rounded-full ${statusColor}`}>
                  {statusText}
                </span>
                {perm.active && (
                  <div className="mt-1 text-[10px] text-slate-400 font-mono">授权给 {shortAddr(entAddr)}</div>
                )}
              </div>
              <StandardPriceCell stdPrice={stdPrice} />
              <div className="w-20 flex justify-center">
                <button onClick={() => onToggle(f, perm.active)} disabled={pending !== ''}
                  title={perm.active ? '点击撤销授权' : '点击设置授权范围'}
                  className={`relative w-11 h-6 rounded-full transition-all duration-300 disabled:opacity-60 ${perm.active ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-300 ${perm.active ? 'left-[22px]' : 'left-1'}`} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      </div>
      </div>
    </div>
  );
}

// ★ 链上标准价单元格：价格是合约里的公开常量，只读展示（证明价格来自链上、不可被任何人私自篡改）
function StandardPriceCell({ stdPrice }) {
  return (
    <div
      className="w-32 flex flex-col items-center justify-center gap-0.5"
      title="单价由智能合约常量决定，企业无法传入自定义价格，从机制上防止乱定价"
    >
      <span className="text-[11px] font-bold text-slate-700">{stdPrice.call} <span className="font-normal text-slate-400">/ 次</span></span>
      <span className="text-[11px] font-bold text-slate-700">{stdPrice.day} <span className="font-normal text-slate-400">/ 天</span></span>
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

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-900 font-medium">{value}</span>
    </div>
  );
}