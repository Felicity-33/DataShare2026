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
  X, Copy, Check, Wallet, Globe, Activity, RefreshCw, LogOut, ShieldCheck, Coins
} from 'lucide-react';
import { GANACHE_CHAIN_ID, GANACHE_RPC_URL, CONTRACT_ADDRESS, EXPECTED_CONTRACT_VERSION, fmtEth } from '../config.js';

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
                请重新执行 <code className="font-mono">npx hardhat run scripts/deploy.js --network ganache</code>，
                并把新地址填回 <code className="font-mono">frontend/src/config.js</code>。
                否则返回值可能被静默错解，界面看起来正常但数据是错的。
              </p>
            </div>
          )}

          {/* ---------- 1. 链上状态 ---------- */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Globe className="w-4 h-4 text-slate-400" />
              <h4 className="text-sm font-bold text-slate-800">链上状态</h4>
            </div>
            <div className="px-4 rounded-2xl bg-slate-50/70 border border-slate-100">
              <Row label="网络">
                <span className={networkOk ? 'text-emerald-600 font-medium' : 'text-red-500 font-medium'}>
                  {networkOk ? 'Ganache 本地测试网（已匹配）' : '网络不匹配，请切换到 ChainID 1337'}
                </span>
              </Row>
              <Row label="ChainID" mono>{GANACHE_CHAIN_ID}</Row>
              <Row label="RPC 地址" mono>{GANACHE_RPC_URL}</Row>
              <Row label="实时区块高度">
                <span className="inline-flex items-center gap-2">
                  <span className="relative flex w-1.5 h-1.5">
                    <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                    <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  </span>
                  <span className="font-mono font-bold text-slate-800">#{blockNumber ?? '—'}</span>
                </span>
              </Row>
            </div>
          </section>

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
                  <span className="font-mono text-[11px]">{CONTRACT_ADDRESS.slice(0, 12)}…{CONTRACT_ADDRESS.slice(-8)}</span>
                  <CopyBtn text={CONTRACT_ADDRESS} tag="addr" />
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
                <RefreshCw className="w-4 h-4" /> 切换账号
              </button>
              <button
                onClick={async () => {
                  try {
                    if (window.ethereum) {
                      await window.ethereum.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
                    }
                  } catch { /* 忽略 */ }
                  window.location.reload();
                }}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-white border border-red-200 text-red-500 text-sm font-bold hover:bg-red-50 transition-colors"
              >
                <LogOut className="w-4 h-4" /> 断开连接
              </button>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
