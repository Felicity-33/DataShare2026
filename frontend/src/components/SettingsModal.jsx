// ============================================================
// SettingsModal.jsx —— 设置面板（侧边栏底部入口）
// ------------------------------------------------------------
// 让「设置」真正有用，共四块：
//   1. 链上状态：网络 / ChainID / 实时区块高度 / 合约版本校验
//   2. 合约信息：合约地址（可复制）、托管争议窗口、链上标准价
//   3. 界面偏好：减少动画（即时生效，写入 localStorage）
//   4. 钱包操作：复制地址、切换账号、断开连接
// 其中合约版本校验尤为关键：链上合约与本地 ABI 不匹配时会静默错解返回值，
// 这里直接给出醒目提示，避免「界面看着正常、其实数据是错的」。
// ============================================================
import { useState, useEffect } from 'react';
import {
  X, Copy, Check, Wallet, Globe, Activity, RefreshCw, LogOut, ShieldCheck, Coins,
  FlaskConical, RotateCcw, User, Building2, Scale
} from 'lucide-react';
import {
  shortAddr, CONTRACT_ADDRESS, EXPECTED_CONTRACT_VERSION, fmtEth,
  ACTIVE_NETWORK,
} from '../config.js';
import {
  SIM_CHAIN_ID, SIM_CONTRACT_ADDRESS, SIM_IDENTITY_LABELS, SIM_IDENTITY_ORDER,
  resetSimChain, SIM_USER_ADDRESS, SIM_ENTERPRISE_ADDRESS, SIM_REGULATOR_ADDRESS,
} from '../sim/mockChain.js';
import { clearNotifications } from '../notifications.js';

function Row({ label, children, mono = false }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className={`text-xs text-slate-800 text-right min-w-0 ${mono ? 'font-mono' : ''}`}>{children}</span>
    </div>
  );
}

export default function SettingsModal({ web3, blockNumber, onClose }) {
  const { account, role, contract, networkOk, contractVersion, versionOk, switchAccount } = web3;
  // 是否处于模拟演示模式（useSimWeb3 带 isSim 标识；链上模式的 useWeb3 无此字段）
  const isSim = Boolean(web3.isSim);
  // 演示模式 = ACTIVE_NETWORK（Ganache / Sepolia）两套网络信息
  const net = ACTIVE_NETWORK;

  const [copied, setCopied] = useState('');
  const [params, setParams] = useState({ challenge: null, call: null, day: null });
  const [reduceMotion, setReduceMotion] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('dv_reduce_motion') === '1'
  );

  const roleLabel = role === 'user' ? '数据所有者 · 用户'
    : role === 'enterprise' ? '数据需求方 · 企业'
    : role === 'regulator' ? '合规审计 · 监管'
    : '未注册';

  // 读取链上参数（争议窗口 / 标准价）
  useEffect(() => {
    if (!contract) return;
    let alive = true;
    (async () => {
      const safe = async (fn) => { try { return await fn(); } catch { return null; } };
      const [challenge, call, day] = await Promise.all([
        safe(() => contract.CHALLENGE_PERIOD()),
        safe(() => contract.STANDARD_PRICE_PER_CALL()),
        safe(() => contract.STANDARD_PRICE_PER_DAY()),
      ]);
      if (!alive) return;
      setParams({
        challenge: challenge === null ? null : Number(challenge),
        call: call === null ? null : fmtEth(call),
        day: day === null ? null : fmtEth(day),
      });
    })();
    return () => { alive = false; };
  }, [contract]);

  // 界面偏好：减少动画（即时套用到 <html>）
  useEffect(() => {
    document.documentElement.classList.toggle('dv-reduce-motion', reduceMotion);
    try { localStorage.setItem('dv_reduce_motion', reduceMotion ? '1' : '0'); } catch { /* 忽略 */ }
  }, [reduceMotion]);

  const copy = async (text, tag) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(''), 1500);
    } catch { /* 忽略 */ }
  };

  const CopyBtn = ({ text, tag }) => (
    <button
      onClick={() => copy(text, tag)}
      title="复制"
      className="p-1 rounded-md text-slate-400 hover:text-cyan-600 hover:bg-slate-100 transition-colors"
    >
      {copied === tag ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white shadow-xl rounded-3xl overflow-hidden animate-fade-in max-h-[88vh] flex flex-col">

        {/* 标题栏 */}
        <div className="flex items-center justify-between px-8 pt-7 pb-5 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">设置</h3>
            <p className="mt-1 text-xs text-slate-400">链上状态 · 合约信息 · 界面偏好 · 钱包</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-8 py-6 space-y-6 overflow-y-auto">

          {/* ---------- 合约版本不匹配的醒目提示 ---------- */}
          {!versionOk && (
            <div className="p-4 rounded-2xl bg-red-50 border border-red-100">
              <div className="flex items-center gap-2 text-sm font-bold text-red-600">
                <ShieldCheck className="w-4 h-4" /> 合约版本不匹配
              </div>
              <p className="mt-2 text-xs text-red-500 leading-relaxed">
                链上合约版本为 <code className="font-mono">{contractVersion || '未知'}</code>，
                前端期望 <code className="font-mono">{EXPECTED_CONTRACT_VERSION}</code>。
                {net.key === 'ganache'
                  ? <>请重新执行 <code className="font-mono">npx hardhat run scripts/deploy.js --network ganache</code>，并把新地址填回 <code className="font-mono">frontend/src/config.js</code>。</>
                  : <>请把 <code className="font-mono">VITE_SEPOLIA_CONTRACT_ADDRESS</code> 更新为最新部署地址并重新构建。</>}
                否则返回值可能被静默错解，界面看起来正常但数据是错的。
              </p>
            </div>
          )}

          {/* ---------- 1. 链上状态（模拟 / 链上两套展示） ---------- */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4 text-slate-400" />
              <h4 className="text-sm font-bold text-slate-800">{isSim ? '运行环境' : '链上状态'}</h4>
            </div>
            <div className="px-4 rounded-2xl bg-slate-50/70 border border-slate-100">
              {isSim ? (
                <>
                  <Row label="运行模式">
                    <span className="inline-flex items-center gap-1.5 text-cyan-600 font-medium">
                      <FlaskConical className="w-3.5 h-3.5" />
                      模拟演示模式（免钱包）
                    </span>
                  </Row>
                  <Row label="模拟链标识" mono>ChainID {SIM_CHAIN_ID}（仅展示）</Row>
                  <Row label="链环境" mono>浏览器内模拟链 · 数据不出网</Row>
                  <Row label="数据存储" mono>localStorage（刷新后保留）</Row>
                  <Row label="实时区块高度">
                    <span className="inline-flex items-center gap-2">
                      <span className="relative flex w-1.5 h-1.5">
                        <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                        <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      </span>
                      <span className="font-mono font-bold text-slate-800">#{blockNumber ?? '—'}</span>
                    </span>
                  </Row>
                </>
              ) : (
                <>
                  <Row label="目标网络">
                    <span className={networkOk ? 'text-emerald-600 font-medium' : 'text-red-500 font-medium'}>
                      {networkOk ? `${net.label}（已匹配）` : `网络不匹配，请切换到 ChainID ${net.chainId}`}
                    </span>
                  </Row>
                  <Row label="ChainID" mono>{net.chainId}</Row>
                  <Row label="RPC 地址" mono>{net.rpcUrl || '钱包内置公共 RPC'}</Row>
                  <Row label="实时区块高度">
                    <span className="inline-flex items-center gap-2">
                      <span className="relative flex w-1.5 h-1.5">
                        <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                        <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      </span>
                      <span className="font-mono font-bold text-slate-800">#{blockNumber ?? '—'}</span>
                    </span>
                  </Row>
                </>
              )}
            </div>
          </section>

          {/* ---------- 1.5 演示身份（仅模拟模式）：一键切换三端视角 ---------- */}
          {isSim && (
            <section>
              <div className="flex items-center gap-2 mb-2">
                <FlaskConical className="w-4 h-4 text-cyan-500" />
                <h4 className="text-sm font-bold text-slate-800">演示身份</h4>
              </div>
              <div className="space-y-2">
                {SIM_IDENTITY_ORDER.map((addr) => {
                  const cur = account?.toLowerCase() === addr.toLowerCase();
                  const Icon = addr === SIM_IDENTITY_ORDER[0] ? User
                    : addr === SIM_IDENTITY_ORDER[1] ? Building2 : Scale;
                  return (
                    <button
                      key={addr}
                      onClick={() => switchAccount(addr)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition-all ${
                        cur
                          ? 'border-cyan-400 bg-cyan-50/70 shadow-sm'
                          : 'border-slate-100 bg-slate-50/70 hover:border-cyan-200'
                      }`}
                    >
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        cur ? 'bg-cyan-500 text-white' : 'bg-white text-slate-400 border border-slate-200'
                      }`}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-bold text-slate-800">{SIM_IDENTITY_LABELS[addr]}</span>
                        <span className="block text-[10px] font-mono text-slate-400 mt-0.5">{shortAddr(addr)}</span>
                      </span>
                      {cur && <span className="shrink-0 text-[10px] font-bold text-cyan-600">当前</span>}
                    </button>
                  );
                })}
              </div>
              {/* 重置演示数据：清空 localStorage 模拟链并重新播种（整页刷新生效）；
                  同步清空三个演示身份的铃铛通知存档 —— 否则旧通知与新演示数据对不上，
                  看起来就像「通知不同步」 */}
              <button
                onClick={async () => {
                  [SIM_USER_ADDRESS, SIM_ENTERPRISE_ADDRESS, SIM_REGULATOR_ADDRESS]
                    .forEach((a) => clearNotifications(a));
                  await resetSimChain();
                  window.location.reload();
                }}
                className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-white border border-slate-200 text-slate-500 text-xs font-bold hover:bg-slate-50 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" /> 重置演示数据（恢复初始播种状态）
              </button>
            </section>
          )}

          {/* ---------- 2. 合约信息 ---------- */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-slate-400" />
              <h4 className="text-sm font-bold text-slate-800">合约信息</h4>
            </div>
            <div className="px-4 rounded-2xl bg-slate-50/70 border border-slate-100">
              <Row label="合约版本">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${versionOk ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <span className="font-mono">{contractVersion || '未知'}</span>
                  <span className={versionOk ? 'text-emerald-600' : 'text-red-500'}>
                    {versionOk ? '匹配' : `应为 ${EXPECTED_CONTRACT_VERSION}`}
                  </span>
                </span>
              </Row>
              <Row label="合约地址">
                <span className="inline-flex items-center gap-1">
                  <span className="font-mono text-[11px]">
                    {isSim
                      ? `${SIM_CONTRACT_ADDRESS.slice(0, 12)}…${SIM_CONTRACT_ADDRESS.slice(-8)}`
                      : (CONTRACT_ADDRESS ? `${CONTRACT_ADDRESS.slice(0, 12)}…${CONTRACT_ADDRESS.slice(-8)}` : '未配置')}
                  </span>
                  {(!isSim && CONTRACT_ADDRESS) && <CopyBtn text={CONTRACT_ADDRESS} tag="addr" />}
                </span>
              </Row>
              <Row label="托管争议窗口">
                {params.challenge === null
                  ? <span className="text-slate-300">—</span>
                  : <span className="font-mono">{params.challenge} 秒<span className="text-slate-400">（演示值）</span></span>}
              </Row>
              <Row label="链上标准价">
                {params.call === null
                  ? <span className="text-slate-300">—</span>
                  : (
                    <span className="inline-flex items-center gap-1 font-mono">
                      <Coins className="w-3.5 h-3.5 text-amber-500" />
                      {params.call} / 次 · {params.day} / 天
                    </span>
                  )}
              </Row>
            </div>
            <p className="mt-2 text-[11px] text-slate-400 px-1">
              争议窗口与标准价均为合约公开常量，前端只读展示。
            </p>
          </section>

          {/* ---------- 3. 界面偏好 ---------- */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <RefreshCw className="w-4 h-4 text-slate-400" />
              <h4 className="text-sm font-bold text-slate-800">界面偏好</h4>
            </div>
            <label className="flex items-center justify-between px-4 py-3.5 rounded-2xl bg-slate-50/70 border border-slate-100 cursor-pointer">
              <span>
                <span className="block text-xs font-medium text-slate-700">减少动画</span>
                <span className="block text-[11px] text-slate-400 mt-0.5">关闭过渡与循环动效，演示或低配设备更流畅</span>
              </span>
              <button
                type="button"
                onClick={() => setReduceMotion((v) => !v)}
                className={`relative w-11 h-6 rounded-full transition-all duration-300 shrink-0 ${reduceMotion ? 'bg-emerald-500' : 'bg-slate-200'}`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-300 ${reduceMotion ? 'left-[22px]' : 'left-1'}`} />
              </button>
            </label>
          </section>

          {/* ---------- 4. 钱包 ---------- */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-slate-400" />
              <h4 className="text-sm font-bold text-slate-800">钱包</h4>
            </div>
            <div className="px-4 rounded-2xl bg-slate-50/70 border border-slate-100">
              <Row label="当前角色">{roleLabel}</Row>
              <Row label="账户地址">
                <span className="inline-flex items-center gap-1">
                  <span className="font-mono text-[11px]">{account ? `${account.slice(0, 10)}…${account.slice(-8)}` : '未连接'}</span>
                  {account && <CopyBtn text={account} tag="acct" />}
                </span>
              </Row>
            </div>

            <div className="mt-3 flex gap-3">
              <button
                onClick={switchAccount}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-white border border-slate-200 text-slate-700 text-sm font-bold hover:bg-slate-50 transition-colors"
              >
                <RefreshCw className="w-4 h-4" /> {isSim ? '切换演示身份' : '切换账号'}
              </button>
              <button
                onClick={async () => {
                  // 模拟模式：无钱包授权可撤销，直接刷新重建界面状态
                  if (isSim) {
                    window.location.reload();
                    return;
                  }
                  try {
                    if (window.ethereum) {
                      await window.ethereum.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
                    }
                  } catch { /* 忽略 */ }
                  window.location.reload();
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-white border border-red-200 text-red-500 text-sm font-bold hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-4 h-4" /> {isSim ? '退出演示' : '断开连接'}
              </button>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
