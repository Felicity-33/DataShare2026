// ============================================================
// ModalLogin.jsx —— 链上模式连接钱包模态框（v4.6 双模式改造）
// ------------------------------------------------------------
// 入口变化：首页主入口已改为「进入演示」（免钱包、不弹窗），
//   本弹窗仅在「链上登录」时弹出，按 ACTIVE_NETWORK（构建期决定）
//   生成引导文案：本地 Ganache / Sepolia 测试网两套措辞。
// 兜底：底部提供「一键进入演示模式」逃生通道，任何访客都能进平台。
// 使用 Ethers.js v6 的 BrowserProvider 连接 MetaMask 小狐狸：
//   - 自动切换 / 添加目标网络（Ganache 1337 / Sepolia 11155111）
//   - 处理：用户拒绝连接、未安装 MetaMask、网络错误
// 样式：遮罩 bg-slate-900/30 backdrop-blur-sm（z-50），
//       弹窗本体 bg-white shadow-xl rounded-2xl
// ============================================================
import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { ACTIVE_NETWORK } from '../config.js';

export default function ModalLogin({ web3, onEnterDemo, onClose, onConnected }) {
  const [busy, setBusy] = useState(false); // 连接中
  const [err, setErr] = useState('');      // 错误信息（红字展示，不用 alert）

  // 当前目标网络的引导步骤（本地 Ganache 与 Sepolia 各有一套）
  const net = ACTIVE_NETWORK;
  const isLocal = net.key === 'ganache';
  const step2 = isLocal
    ? '点击下方按钮自动连接本地测试网'
    : `切换到 ${net.label}，并确保账户持有测试 ETH`;

  // 点击连接钱包：调用 useWeb3 的 connect()
  const handleConnect = async () => {
    setBusy(true);
    setErr('');
    try {
      await web3.connect();
      onConnected?.(); // 通知 App 跳转工作台
      onClose?.();
    } catch (e) {
      // 展示可读错误：拒绝连接 / 未安装 MetaMask / 网络错误
      setErr(e?.shortMessage || e?.message || '连接失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      {/* 弹窗本体 */}
      <div className="relative w-full max-w-md bg-white shadow-xl rounded-2xl p-8 animate-fade-in">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">连接钱包</h2>
            <p className="mt-1 text-sm text-slate-500">使用 MetaMask 连接{net.label}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="关闭">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 连接前步骤说明（按目标网络生成，一句话一步） */}
        <ol className="mt-6 space-y-2.5 text-sm text-slate-500">
          <li className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-semibold">1</span>
            <span>安装并登录 MetaMask</span>
          </li>
          <li className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-semibold">2</span>
            <span>{step2}</span>
          </li>
          <li className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-semibold">3</span>
            <span>连接后进入工作台，按提示注册角色</span>
          </li>
        </ol>

        {/* 未安装 MetaMask 提示 */}
        {!window.ethereum && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm">
            未检测到 MetaMask，请先安装浏览器插件后刷新页面
          </div>
        )}

        {/* 错误信息（红字） */}
        {err && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-red-50 text-red-600 text-sm">{err}</div>
        )}

        {/* 连接按钮：等待期间变灰并显示“连接中...” */}
        <button
          onClick={handleConnect}
          disabled={busy || !window.ethereum}
          className="mt-6 w-full px-6 py-3 rounded-full bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 active:scale-[0.98] disabled:bg-slate-300 disabled:cursor-not-allowed transition-all"
        >
          {busy ? '连接中...' : '连接钱包'}
        </button>
        <p className="mt-4 text-center text-xs text-slate-400">
          测试网演示数据，不产生真实资金；连接无响应时请点开右上角小狐狸查看待确认请求
        </p>

        {/* ★ 演示模式逃生通道（v4.6）：没有钱包 / 本地链环境的访客一键进入 */}
        {onEnterDemo && (
          <button
            onClick={onEnterDemo}
            className="mt-4 w-full flex items-center justify-center gap-2 px-6 py-3 rounded-full border border-cyan-200 bg-cyan-50/60 text-cyan-700 text-sm font-medium hover:bg-cyan-100 transition-all"
          >
            <FlaskConical className="w-4 h-4" />
            没有钱包？一键进入演示模式
          </button>
        )}
      </div>
    </div>
  );
}
