// ============================================================
// ModalLogin.jsx —— 连接钱包模态框
// ------------------------------------------------------------
// 使用 Ethers.js v6 的 BrowserProvider 连接 MetaMask 小狐狸：
//   - 自动切换 / 添加 Ganache 网络（ChainID 1337）
//   - 处理：用户拒绝连接、未安装 MetaMask、网络错误
// 样式：遮罩 bg-slate-900/30 backdrop-blur-sm（z-50），
//       弹窗本体 bg-white shadow-xl rounded-2xl
// ============================================================
import { useState } from 'react';

export default function ModalLogin({ web3, onClose, onConnected }) {
  const [busy, setBusy] = useState(false); // 连接中
  const [err, setErr] = useState('');      // 错误信息（红字展示，不用 alert）

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
            <p className="mt-1 text-sm text-slate-500">使用 MetaMask 小狐狸连接本地 Ganache 网络</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="关闭">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 连接前步骤说明 */}
        <ol className="mt-6 space-y-2.5 text-sm text-slate-500">
          <li className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-semibold">1</span>
            <span>安装并开启 MetaMask 小狐狸插件</span>
          </li>
          <li className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-semibold">2</span>
            <span>点击下方按钮自动添加并切换 Ganache 网络（http://127.0.0.1:7545，ChainID 1337）</span>
          </li>
          <li className="flex gap-3 items-start">
            <span className="shrink-0 w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-xs font-semibold">3</span>
            <span>确认账户后进入工作台，并按提示完成角色注册</span>
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
          演示网络为本地 Ganache 模拟数据，不会产生任何真实资金
        </p>
        {/* ★ 实用提示：MetaMask 确认弹窗有时不会自动弹出（或被其他窗口遮挡），
            请求会一直挂起、按钮停在"连接中..." —— 提示用户主动去工具栏查看 */}
        <p className="mt-1 text-center text-xs text-slate-400">
          若长时间停在"连接中..."，请点击浏览器右上角的小狐狸图标，查看是否有待确认的请求
        </p>
      </div>
    </div>
  );
}
