// ============================================================
// App.jsx —— 主入口：路由 + 全局提示系统（Toast/Banner）+ 连接状态
// ------------------------------------------------------------
// 视图：home（首页）/ workbench（三端工作台）
// 提示系统：
//   - 错误 Banner：顶部滑下，红底白字，z-[70]，优先于绿色 Toast
//   - 成功 Toast：底部弹起，绿底白字，z-[60]
//   - 同一时间只保留一个最高优先级提示，3 秒自动消失
// 链上事件：收益到账 / 授权申请 / 审批结果（由 useWeb3 统一监听）
// ★ 双模式架构（v4.6）：
//   - 模拟演示模式（默认）：免钱包、免本地链，评委打开即用，
//     底层是 src/sim/mockChain.js 的浏览器内模拟合约（useSimWeb3）
//   - 链上真实模式：连接 MetaMask 与 ACTIVE_NETWORK（本地 Ganache /
//     Sepolia 测试网）交互，走 useWeb3 —— 两个 hook 无条件挂载后按
//     模式取用（Hooks 不能条件调用），切模式时工作台整体重挂载
// ============================================================
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useWeb3, useBlockNumber } from './hooks/useWeb3.js';
import { useSimWeb3 } from './hooks/useSimWeb3.js';
import { fmtEth, EXPECTED_CONTRACT_VERSION } from './config.js';
import Background from './components/Background.jsx';
import Header from './components/Header.jsx';
import Home from './components/Home.jsx';
import ModalLogin from './components/ModalLogin.jsx';
import UserDashboard from './components/UserDashboard.jsx';
import EnterpriseDashboard from './components/EnterpriseDashboard.jsx';
import RegulatorDashboard from './components/RegulatorDashboard.jsx';

// 模式持久化 key：'sim'（模拟演示）/ 'chain'（链上真实）
const MODE_KEY = 'ds_mode';

export default function App() {
  // ---------------- 视图与登录状态 ----------------
  const [view, setView] = useState('home');      // home | workbench | profile
  const [loginOpen, setLoginOpen] = useState(false);
  const [roleBusy, setRoleBusy] = useState('');  // 角色注册中的标识（显示“交易确认中...”）

  // ---------------- 全局提示系统（Toast / Banner） ----------------
  const [notice, setNotice] = useState(null);    // { type: 'success' | 'error', text }
  const noticeTimer = useRef(null);

  // ★ 链上确认条：每笔写操作成功后弹出「已上链 · 区块 #N · 交易哈希」
  //   这是最直观的区块链特性 —— 每次操作都看得见它被打包进了一个区块。
  const [txInfo, setTxInfo] = useState(null);
  const txTimer = useRef(null);
  const showTx = useCallback((info) => {
    if (!info || info.blockNumber === undefined || info.blockNumber === null) return;
    setTxInfo(info);
    clearTimeout(txTimer.current);
    txTimer.current = setTimeout(() => setTxInfo(null), 6000);
  }, []);

  // 展示提示：同一时间只弹一个最高优先级提示（后到的会覆盖先到的）
  // duration 可选：默认 3 秒；合约拦截留痕这类需要讲解的横幅给更长时间（见 onBlocked）
  const showNotice = useCallback((type, text, duration = 3000) => {
    setNotice({ type, text });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), duration);
  }, []);

  // ★ 统一异常入口：底层模块（useWeb3 同步失败等）通过 ds-global-error 事件上报，
  //   这里集中转成顶部红 Banner —— 所有模块的异常都走同一条用户可见通道
  useEffect(() => {
    const onGlobalError = (e) => showNotice('error', e.detail || '发生未知错误');
    window.addEventListener('ds-global-error', onGlobalError);
    return () => window.removeEventListener('ds-global-error', onGlobalError);
  }, [showNotice]);

  // ---------------- Web3 与链上事件监听（双模式） ----------------
  // liveTick：事件触发后 +1，通知各工作台刷新数据
  const [liveTick, setLiveTick] = useState(0);
  // 两种模式共用同一套事件回调（业务提示完全一致）
  const callbacks = useMemo(() => ({
    // 收益到账：用户端弹出绿色 Toast
    onRevenue: ({ amount }) => {
      showNotice('success', `企业调用您的数据，收益 +${fmtEth(amount)} ETH`);
      setLiveTick(t => t + 1);
    },
    // 收到新的授权申请：刷新通知铃铛
    onAuthRequest: () => {
      setLiveTick(t => t + 1);
    },
    // 审批结果：企业端提示
    onAuthResult: ({ approved }) => {
      showNotice(approved ? 'success' : 'error', approved ? '用户已同意您的授权申请' : '用户拒绝了您的授权申请');
      setLiveTick(t => t + 1);
    },
    // ★ 裁决申诉提交（v4.5）：仅发起申诉的企业本人收到，提示终局效力
    onDisputeRaised: () => {
      showNotice('success', '申诉已提交上链，等待监管裁决（裁决具有终局效力）');
      setLiveTick(t => t + 1);
    },
    // ★ 裁决结果（v4.5）：按托管单归属分发。放款路径用户端已有「收益到账」Toast，
    //   这里只在「申诉成立退款」时给用户端补一条提示；企业端结果由工作台快照对比提示，避免重复弹窗
    onDisputeResolved: ({ refunded, myRole }) => {
      setLiveTick(t => t + 1);
      if (myRole === 'user' && refunded) {
        showNotice('success', '监管裁决：申诉成立，托管费用已退回企业押金池');
      }
    }
  }), [showNotice]);

  // ★ 两个 hook 都无条件挂载（Hooks 规则），按当前模式取用其一：
  //   sim3 —— 模拟演示模式（默认，免钱包）；web3 —— 链上真实模式（MetaMask）
  const web3 = useWeb3(callbacks);
  const sim3 = useSimWeb3(callbacks);

  // 当前模式：'sim' 模拟演示 | 'chain' 链上真实（持久化到 localStorage，刷新后保持）
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) === 'chain' ? 'chain' : 'sim'; }
    catch { return 'sim'; }
  });
  const isSim = mode === 'sim';
  const active = isSim ? sim3 : web3;
  const { account, role, connected, contract, registerRole, refreshRole, versionOk, contractVersion } = active;

  // ★ 实时区块高度：从当前模式的 provider 轮询，用于顶栏 / 侧边栏 / 设置面板展示
  const blockNumber = useBlockNumber(active.provider);

  // ---------------- 模式切换与演示入口 ----------------
  // 切换模式：断开当前连接并回首页（工作台通过 key 重挂载，保证状态干净）
  const toggleMode = useCallback(() => {
    if (isSim) web3.disconnect(); else sim3.disconnect();
    const next = isSim ? 'chain' : 'sim';
    try { localStorage.setItem(MODE_KEY, next); } catch { /* 忽略 */ }
    setMode(next);
    setView('home');
  }, [isSim, web3, sim3]);

  // 一键进入演示模式（免钱包）：首页主入口 / 链上连接框兜底 / 角色页逃生通道共用
  // ★ 必须先落回 sim 模式：若当前是 chain 模式，active=web3 未连接，
  //   只切视图会出现「进入演示后页面空白」——入口必须保证模式与连接一致
  const enterDemo = useCallback(async () => {
    try { localStorage.setItem(MODE_KEY, 'sim'); } catch { /* 忽略 */ }
    setMode('sim');
    try { await sim3.connect(); } catch { /* 模拟连接不会失败，兜底静默 */ }
    setLoginOpen(false);
    setView('workbench');
  }, [sim3]);

  // ---------------- 统一导航映射 ----------------
  // home / profile 直接切视图；user / enterprise / regulator 一律进入工作台，
  // 具体渲染哪个工作台由链上角色决定
  const goView = useCallback((path) => {
    if (path === 'home') setView('home');
    else if (path) setView('workbench');
  }, []);

  // ---------------- 角色自助注册 ----------------
  const doRegisterRole = async (kind) => {
    setRoleBusy(kind);
    try {
      await registerRole(kind);
      await refreshRole();
      showNotice('success', '链上角色注册成功');
    } catch (e) {
      showNotice('error', e?.reason || e?.shortMessage || e?.message || '角色注册失败');
    } finally {
      setRoleBusy('');
    }
  };

  // 是否处于「已注册角色的工作台」：
  // 此时灵动岛已并入工作台自身的顶部导航栏（企业工作台那种形态），
  // 首页那枚悬浮居中灵动岛必须隐藏，否则会浮在顶部正中遮挡内容
  const inRoleWorkbench = view === 'workbench' && !!role && role !== 'none';

  // 未注册角色时的引导卡片
  const RoleSelectCard = () => (
    <div className="min-h-[calc(100vh-73px)] flex items-center justify-center px-6">
      <div className="w-full max-w-md bg-white border border-slate-200 shadow-sm rounded-2xl p-8 text-center animate-fade-in">
        <h2 className="text-xl font-semibold text-slate-900">选择你的链上角色</h2>
        <p className="mt-2 text-sm text-slate-500">
          角色由智能合约 AccessControl 管理，注册后写入链上，决定你进入哪个工作台
        </p>
        <div className="mt-6 space-y-3">
          {[
            ['user', '用户工作台', '管理我的数据，授权与收益'],
            ['enterprise', '企业工作台', '数据市场调用，押金充值'],
            ['regulator', '监管工作台', '全局审计与异常监控']
          ].map(([kind, label, desc]) => (
            <button
              key={kind}
              disabled={roleBusy !== ''}
              onClick={() => doRegisterRole(kind)}
              className="w-full flex items-center justify-between px-5 py-4 rounded-xl border border-slate-200 bg-white hover:border-blue-500 hover:shadow-sm disabled:opacity-60 disabled:cursor-not-allowed text-left transition-all"
            >
              <div>
                <div className="text-sm font-medium text-slate-900">{label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
              </div>
              <span className="shrink-0 text-xs px-4 py-2 rounded-full bg-blue-600 text-white disabled:bg-slate-300">
                {roleBusy === kind ? '交易确认中...' : '注册'}
              </span>
            </button>
          ))}
        </div>
        {/* 演示模式兜底：角色注册是链上动作，没有环境时给一条逃生通道 */}
        {mode === 'chain' && (
          <button
            onClick={enterDemo}
            className="mt-5 text-xs text-slate-400 hover:text-cyan-600 transition-colors"
          >
            没有钱包环境？一键进入演示模式（免钱包）
          </button>
        )}
      </div>
    </div>
  );

  // ---------------- 工作台渲染（按角色分发） ----------------
  // key={mode}：切换模式时强制重挂载工作台，杜绝两个数据源的状态串扰
  const renderWorkbench = () => {
    if (!connected) return null;
    if (role === 'none') return <RoleSelectCard />;
    const common = {
      web3: active, onNotice: showNotice, liveTick, onTx: showTx,
      // ★ 合约拦截专用通道（此前漏传，导致企业端「先存证再报错」的拦截原因无处显示）：
      //   拦截原因由合约判定（企业无法伪造），用 6 秒红横幅展示，与左下角「已上链确认 区块 #N / 交易哈希」配套，
      //   演示时可直接说明「错误自动留痕」。仅在链上留痕成功后触发，不影响正常调用。
      onBlocked: (reason) => showNotice('error', `合约拦截：${reason}`, 6000),
      mode, onToggleMode: toggleMode,   // 透传给工作台 Header：模式徽标 + 互切菜单项
      key: `${role}-${mode}`,
    };
    if (role === 'user') return <UserDashboard {...common} />;
    if (role === 'enterprise') return <EnterpriseDashboard {...common} />;
    if (role === 'regulator') return <RegulatorDashboard {...common} />;
    return null;
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      {/* 背景：交互线条版（z-index: -10，不遮挡内容） */}
      <Background />

      {/* 全局顶部灵动岛（z-30）
          首页 / 未注册角色时显示为悬浮居中胶囊；
          进入角色工作台后隐藏，改由工作台自身的顶部导航栏承载灵动岛组件 */}
      {!inRoleWorkbench && (
        <Header
          // ★ 未连接时传 null：模拟模式的 account 是内置演示身份（恒非空），
          //   若直接透传，首页未登录也会显示「已连接」胶囊，退出演示后无法回到登录态
          account={connected ? account : null}
          role={role}
          view={view}
          blockNumber={blockNumber}
          mode={mode}
          onToggleMode={toggleMode}
          onOpenLogin={() => setLoginOpen(true)}
          onLogout={() => { active.disconnect(); setView('home'); }}
          onSwitchAccount={active.switchAccount}
          onNavigate={goView}
        />
      )}

      {/* 主内容区（z-10） */}
      <main className="relative z-10">
        {view === 'home' && <Home />}
        {view === 'workbench' && renderWorkbench()}
      </main>

      {/* 连接钱包模态框（z-50）：仅链上模式入口（进入演示不弹窗） */}
      {loginOpen && (
        <ModalLogin
          web3={web3}
          onEnterDemo={enterDemo}
          onClose={() => setLoginOpen(false)}
          onConnected={() => setView('workbench')}
        />
      )}

      {/* 合约版本不匹配告警（z-[65]）：链上合约与本地 ABI 不一致时会静默错解返回值，
          界面看起来正常但数据是错的，因此必须显式提示。 */}
      {connected && !versionOk && (
        <div className="fixed top-0 left-0 right-0 z-[65] bg-amber-500 text-white text-center py-2.5 px-4 text-xs font-medium shadow-lg">
          合约版本不匹配：链上为「{contractVersion || '未知'}」，前端期望「{EXPECTED_CONTRACT_VERSION}」。
          请重新部署合约并把新地址填回 frontend/src/config.js，否则数据可能显示不正确。
        </div>
      )}

      {/* 错误 Banner：顶部滑下，z-[70]，优先于绿色 Toast */}
      {notice && notice.type === 'error' && (
        <div className="fixed top-0 left-0 right-0 z-[70] bg-red-500 text-white text-center py-3 text-sm font-medium animate-banner-in shadow-lg">
          {notice.text}
        </div>
      )}

      {/* ★ 链上确认条：左下角，展示区块号与交易哈希（z-[62]） */}
      {txInfo && (
        <div className="fixed bottom-8 left-8 z-[62] w-72 bg-slate-900/95 backdrop-blur rounded-2xl px-5 py-4 shadow-2xl animate-toast-in">
          <div className="flex items-center gap-2">
            <span className="relative flex w-1.5 h-1.5">
              <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-xs font-bold text-white">已上链确认</span>
            <span className="ml-auto text-[10px] font-mono text-slate-400">区块 #{txInfo.blockNumber}</span>
          </div>
          <div className="mt-2 text-[10px] font-mono text-slate-400 break-all leading-relaxed">
            {txInfo.hash}
          </div>
        </div>
      )}

      {/* 成功 Toast：底部弹起，z-[60] */}
      {notice && notice.type === 'success' && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[60] bg-emerald-500 text-white px-6 py-3 rounded-xl text-sm font-medium shadow-lg animate-toast-in">
          {notice.text}
        </div>
      )}
    </div>
  );
}
