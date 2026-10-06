// ============================================================
// Header.jsx —— 灵动岛组件
// ------------------------------------------------------------
// variant = 'home'      ：悬浮居中胶囊（仅首页 / 未注册角色时使用）
// variant = 'dashboard' ：工作台顶部导航栏（左标题 + 右灵动岛组件群，随内容排布不遮挡）
// notifyCount           ：兼容保留参数（铃铛改为读取通知中心，按账户自动统计未读）
// ★ 通知中心（v4.7 历史折叠区）：双区模型 —— 未读 = 当前通知区
//   （点击即流转入历史区），已读 = 历史折叠区（默认收起，按「核心
//   功能相关 / 用户相关 / 企业相关」三类分组归档，支持二次确认清空、
//   顶部下拉刷新与触底上拉加载更多）；点击通知直达对应功能页，
//   三端共用同一组件保证体验一致。
// ============================================================
import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, LogOut, Copy, Bell, RefreshCw, CheckCheck, ChevronRight, Check, Inbox, FlaskConical, Link2, User, Building2, Scale, LayoutDashboard } from 'lucide-react';
import { shortAddr, ACTIVE_NETWORK } from '../config.js';
import { SIM_IDENTITY_LABELS, SIM_IDENTITY_ORDER } from '../sim/mockChain.js';
import {
  CATEGORIES, getNotifications, getUnreadCount,
  markRead, markAllRead, clearHistory, onNotificationsChange,
  HISTORY_GROUPS, historyGroupOf,
} from '../notifications.js';

// 历史区分页步长（触底/点击加载更多，每次追加条数）
const HIST_PAGE = 8;
// 下拉刷新触发阈值（px，配合 0.4 阻尼模拟 iOS 橡皮筋手感）
const PULL_THRESHOLD = 48;

// 时间展示：当天显示 时:分，跨天显示 月-日 时:分（通知列表轻量化时间戳）
function notifTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return hm;
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm}`;
}

export default function Header({
  account, role, onOpenLogin, onLogout, onNavigate, onSwitchAccount,
  variant = 'home',
  title = '工作台', // 用于工作台顶部左侧的标题
  notifyCount = 0,  // 兼容保留：未读数由通知中心按账户自动统计
  blockNumber = null, // ★ 实时区块高度（体现区块链正在出块）
  // ★ 双模式（v4.6）：mode = 'sim'（模拟演示）| 'chain'（链上真实）
  //   onToggleMode：两种模式互切（工作台右上角分段控件 / 账号菜单共用）
  mode = 'chain',
  onToggleMode,
  className = ''
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef(null);
  // ★ 通知中心状态：面板开关 / 版本号（任何通知写入后 +1 触发重渲染）
  const [bellOpen, setBellOpen] = useState(false);
  const [notifVersion, setNotifVersion] = useState(0);
  const bellRef = useRef(null);
  // ★ 历史折叠区状态（v4.7）：展开开关 / 分页可见条数 / 清空二次确认 / 下拉刷新手势
  const [histOpen, setHistOpen] = useState(false);
  const [histVisible, setHistVisible] = useState(HIST_PAGE);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(null);

  useEffect(() => {
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      // 点击面板外部时收起通知面板（面板本体在 bellRef 内部，不误伤）
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  // ★ 订阅通知中心变更：工作台推送新通知 / 标记已读后，面板与徽标自动刷新
  useEffect(() => onNotificationsChange(() => setNotifVersion((v) => v + 1)), []);

  // 切换账户时重置历史折叠区状态（收起 / 分页归零 / 退出确认与刷新手势）
  useEffect(() => {
    setHistOpen(false);
    setHistVisible(HIST_PAGE);
    setConfirmClear(false);
    setPullY(0);
    setRefreshing(false);
  }, [account]);

  const copyAddress = async () => {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const roleLabel = role === 'user' ? '用户'
    : role === 'enterprise' ? '企业'
    : role === 'regulator' ? '监管'
    : '';

  // ---------------- 双模式 UI 元素（v4.6） ----------------
  // 模式徽标：演示模式青色烧瓶 / 链上模式紫色链接，随模式切换即时变化
  const modeBadge = mode === 'sim' ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-600 text-[10px] font-bold shrink-0" title="模拟演示模式：免钱包，数据保存在浏览器本地">
      <FlaskConical className="w-3 h-3" /> 演示模式
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 text-violet-600 text-[10px] font-bold shrink-0" title={`链上真实模式：${ACTIVE_NETWORK.label}`}>
      <Link2 className="w-3 h-3" /> 链上
    </span>
  );
  // 模式切换菜单项：一键跳到另一模式（回首页重新进入）
  const modeToggleItem = onToggleMode && (
    <button onClick={() => { onToggleMode(); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
      {mode === 'sim'
        ? <><Link2 className="w-3.5 h-3.5" strokeWidth={2} /> 切换到链上模式</>
        : <><FlaskConical className="w-3.5 h-3.5" strokeWidth={2} /> 返回演示模式</>}
    </button>
  );
  // 当前身份说明：演示模式显示身份名（更易懂），链上模式显示当前网络
  const identityHint = mode === 'sim'
    ? (SIM_IDENTITY_LABELS[account] || '演示身份')
    : ACTIVE_NETWORK.label;

  // ★ 演示身份选择列表（v4.6）：三身份直接点选（当前身份高亮打勾），替代盲轮换。
  //   仅演示模式渲染；链上模式对应动作是「切换账号」（唤起 MetaMask）
  const IDENTITY_ICONS = [User, Building2, Scale]; // 与 SIM_IDENTITY_ORDER 顺序一一对应
  const identityPicker = mode === 'sim' && onSwitchAccount && (
    <div className="py-1 border-b border-slate-100">
      <div className="px-4 pt-1 pb-1 text-[10px] font-semibold text-slate-400 tracking-widest">切换演示身份</div>
      {SIM_IDENTITY_ORDER.map((addr, i) => {
        const isCur = addr.toLowerCase() === String(account || '').toLowerCase();
        const Icon = IDENTITY_ICONS[i] || User;
        return (
          <button
            key={addr}
            disabled={isCur}
            onClick={() => { onSwitchAccount(addr); setMenuOpen(false); }}
            className={`w-full flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
              isCur ? 'text-cyan-700 bg-cyan-50/60 font-medium cursor-default' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
            <span className="flex-1 text-left truncate">{(SIM_IDENTITY_LABELS[addr] || addr).split(' · ')[0]}</span>
            {isCur && <Check className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />}
          </button>
        );
      })}
    </div>
  );

  // ---------------- 通知中心数据（双区模型：未读当前区 / 已读历史区） ----------------
  // 列表已由通知中心按「优先级 → 时间」排好序，直接拆分渲染即可
  const notifData = useMemo(() => {
    void notifVersion; // 依赖版本号：任何写入后重算
    if (!account) return { list: [], history: [], unread: 0 };
    const all = getNotifications(account);
    return {
      list: all.filter((n) => !n.read),    // 当前通知区：仅未读
      history: all.filter((n) => n.read),  // 历史折叠区：已读归档
      unread: getUnreadCount(account),
    };
  }, [account, notifVersion]);

  // 历史区按三类分组（核心功能相关 → 用户相关 → 企业相关），组内时间倒序
  const histGroups = useMemo(() => (
    HISTORY_GROUPS
      .map((g) => ({
        ...g,
        items: notifData.history.slice(0, histVisible).filter((n) => historyGroupOf(n) === g.key),
      }))
      .filter((g) => g.items.length > 0)
  ), [notifData.history, histVisible]);

  // 点击新通知：标记已读 → 自动从当前通知区消失并进入历史折叠区 → 跳转功能页
  // （无 tabKey 的异常数据仅标记已读并收起面板兜底）
  const openNotification = (n) => {
    if (account && !n.read) markRead(account, n.id);
    setBellOpen(false);
    if (n.tabKey) onNavigate?.(n.tabKey);
  };

  // 点击历史通知：已是已读状态，直接跳回对应功能页复看
  const openHistoryNotification = (n) => {
    setBellOpen(false);
    if (n.tabKey) onNavigate?.(n.tabKey);
  };

  // 清空历史（二次确认后执行）：仅移除已读归档，未读保留在当前通知区
  const doClearHistory = () => {
    if (account) clearHistory(account);
    setConfirmClear(false);
    setHistOpen(false);
  };

  // 下拉刷新（触摸）：滚动容器顶部下拉 → 阻尼跟手 → 释放达到阈值触发刷新
  const onListTouchStart = (e) => {
    if (e.currentTarget.scrollTop <= 0) touchStartY.current = e.touches[0].clientY;
  };
  const onListTouchMove = (e) => {
    if (touchStartY.current == null || refreshing) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (dy > 0) setPullY(Math.min(dy * 0.4, 56)); // 0.4 阻尼模拟 iOS 橡皮筋
  };
  const onListTouchEnd = () => {
    touchStartY.current = null;
    if (pullY >= PULL_THRESHOLD) {
      setRefreshing(true);
      setPullY(0);
      // 轻量延迟还原真实刷新节奏（数据本身经 notifVersion 订阅实时同步）
      setTimeout(() => { setNotifVersion((v) => v + 1); setRefreshing(false); }, 450);
    } else {
      setPullY(0);
    }
  };

  // 上拉加载更多：历史区展开时滚动触底自动追加一页（分页渐进呈现）
  const onListScroll = (e) => {
    if (!histOpen) return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24 && histVisible < notifData.history.length) {
      setHistVisible((v) => v + HIST_PAGE);
    }
  };

  // 通知面板（仅工作台模式渲染）：当前通知区 + 历史折叠区（苹果简约双区布局）
  const bellPanel = bellOpen && (
    <div className="absolute right-0 top-full mt-3 w-[340px] max-w-[calc(100vw-2rem)] bg-white border border-slate-200 shadow-xl rounded-2xl z-50 overflow-hidden animate-fade-in">
      {/* 面板头：标题 + 全部已读（全部已读后当前区清空，未处理项整体转入历史区） */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <span className="text-sm font-bold text-slate-800">通知</span>
        <button
          onClick={() => account && markAllRead(account)}
          disabled={notifData.unread === 0}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-cyan-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <CheckCheck className="w-3.5 h-3.5" />
          全部已读
        </button>
      </div>

      {/* 单一滚动区：顶部下拉刷新 / 底部上拉加载，手势统一 */}
      <div
        className="max-h-[440px] overflow-y-auto overscroll-contain"
        onTouchStart={onListTouchStart}
        onTouchMove={onListTouchMove}
        onTouchEnd={onListTouchEnd}
        onTouchCancel={onListTouchEnd}
        onScroll={onListScroll}
      >
        {/* 下拉刷新指示条（仅触摸拉动或刷新中占据高度，平时零占位） */}
        <div
          className="flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
          style={{ height: refreshing ? 28 : Math.min(pullY, 56) }}
        >
          {refreshing ? (
            <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <RefreshCw className="w-3 h-3 animate-spin" />刷新中…
            </span>
          ) : pullY > 0 ? (
            <span className="text-[10px] text-slate-400">{pullY >= PULL_THRESHOLD ? '释放立即刷新' : '下拉刷新'}</span>
          ) : null}
        </div>

        {/* 当前通知区：仅未读（红色标识，点击后自动流转入历史折叠区） */}
        {notifData.list.length === 0 ? (
          notifData.history.length === 0 ? (
            // 双区皆空：居中空态
            <div className="flex flex-col items-center py-10 text-slate-300">
              <Inbox className="w-8 h-8 mb-2" strokeWidth={1.5} />
              <p className="text-xs text-slate-400">暂无通知</p>
            </div>
          ) : (
            // 仅有历史：轻量提示（保持面板安静）
            <div className="py-6 text-center text-[11px] text-slate-300">暂无新通知</div>
          )
        ) : notifData.list.map((n) => {
          const cat = CATEGORIES.find((c) => c.key === n.category) || CATEGORIES[4];
          return (
            <button
              key={n.id}
              onClick={() => openNotification(n)}
              className="w-full text-left px-4 py-3 border-b border-slate-50 transition-colors bg-red-50/70 hover:bg-red-100/70 border-l-2 border-red-500"
            >
              {/* 第一行：模块徽标 + 标题 + 时间 + 未读红点 */}
              <div className="flex items-center gap-2">
                <span className={`shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${cat.chip}`}>{cat.label}</span>
                <span className="flex-1 text-xs truncate text-slate-900 font-bold">{n.title}</span>
                <span className="shrink-0 text-[10px] text-slate-300 font-mono">{notifTime(n.ts)}</span>
                <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-red-500" />
              </div>
              {/* 第二行：一句话摘要 */}
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400 line-clamp-1">{n.summary}</p>
            </button>
          );
        })}

        {/* 历史折叠区顶栏（吸顶）：展开/收起开关 + 清空历史（带二次确认） */}
        {notifData.history.length > 0 && (
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2.5 border-y border-slate-100 bg-white/95 backdrop-blur-sm">
            {confirmClear ? (
              // 二次确认态：确认 / 取消，防止误清历史记录
              <>
                <span className="text-[11px] text-slate-500">确认清空全部历史通知？</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={doClearHistory}
                    className="px-2.5 py-1 rounded-full bg-red-500 text-white text-[10px] font-medium hover:bg-red-600 transition-colors"
                  >
                    清空
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-500 text-[10px] hover:bg-slate-200 transition-colors"
                  >
                    取消
                  </button>
                </div>
              </>
            ) : (
              <>
                <button
                  onClick={() => { setHistOpen((v) => !v); setConfirmClear(false); }}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-700 transition-colors"
                >
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-300 ease-out ${histOpen ? 'rotate-90' : ''}`} />
                  历史通知
                  <span className="px-1.5 py-px rounded-full bg-slate-100 text-[10px] text-slate-400">{notifData.history.length}</span>
                </button>
                <button
                  onClick={() => setConfirmClear(true)}
                  className="text-[11px] text-slate-400 hover:text-red-500 transition-colors"
                >
                  清空历史
                </button>
              </>
            )}
          </div>
        )}

        {/* 历史折叠内容：grid-rows 0fr→1fr 平滑展开（iOS 手风琴手感）+ 淡入 */}
        {notifData.history.length > 0 && (
          <div className={`grid transition-all duration-300 ease-out ${histOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
            <div className="min-h-0 overflow-hidden">
              <div className="px-4 pt-1 pb-3">
                {histGroups.map((g) => (
                  <div key={g.key} className="mt-2.5 first:mt-1.5">
                    {/* 分组标题：核心功能相关 / 用户相关 / 企业相关 */}
                    <div className="flex items-center gap-1.5 py-1">
                      <span className="text-[10px] font-semibold text-slate-400 tracking-widest">{g.label}</span>
                      <span className="text-[10px] text-slate-300">{g.items.length}</span>
                    </div>
                    {/* 历史条目：已读视觉区分（灰色弱化 + 对勾标记，无红色元素） */}
                    {g.items.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => openHistoryNotification(n)}
                        className="w-full flex items-start gap-2 text-left py-1.5 border-b border-slate-50 last:border-0 group"
                      >
                        <Check className="w-3 h-3 mt-0.5 shrink-0 text-slate-300 group-hover:text-slate-400 transition-colors" strokeWidth={2.5} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[11px] text-slate-400 truncate group-hover:text-slate-600 transition-colors">{n.title}</span>
                          <span className="block text-[10px] text-slate-300 truncate">{n.summary}</span>
                        </span>
                        <span className="shrink-0 text-[9px] text-slate-300 font-mono mt-0.5">{notifTime(n.ts)}</span>
                      </button>
                    ))}
                  </div>
                ))}
                {/* 上拉加载更多：触底自动追加，也可点击（桌面端可见入口） */}
                {notifData.history.length > histVisible ? (
                  <button
                    onClick={() => setHistVisible((v) => v + HIST_PAGE)}
                    className="w-full pt-2.5 text-center text-[10px] text-slate-400 hover:text-cyan-600 transition-colors"
                  >
                    ↑ 上拉或点击加载更多
                  </button>
                ) : (
                  <div className="pt-2.5 text-center text-[10px] text-slate-300">已加载全部 {notifData.history.length} 条</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // 首页模式：居中悬浮胶囊
  if (variant === 'home') {
    const positionClass = className || 'fixed top-5 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-3rem)] max-w-xl transition-all duration-700 ease-in-out';
    return (
      <div className={positionClass}>
        <div className="flex items-center justify-between gap-6 px-6 py-2.5 rounded-full bg-white/80 backdrop-blur-2xl border border-white/60 shadow-[0_8px_32px_-8px_rgba(15,23,42,0.15)]">
          <button onClick={() => onNavigate('home')} className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-slate-900 to-slate-700 flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z" />
              </svg>
            </div>
            <span className="text-sm font-semibold tracking-tight text-slate-900">链承共予 · DataShare</span>
          </button>

          <div className="relative shrink-0" ref={menuRef}>
            {!account ? (
              // 登录入口：打开连接弹窗（弹窗内含「一键进入演示模式」兜底，模式选择收在登录流程里）
              <button onClick={onOpenLogin} className="px-5 py-1.5 rounded-full bg-slate-900 text-white text-xs font-medium transition-all hover:bg-slate-800">
                登录 / 注册
              </button>
            ) : (
              <>
                <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200/80 bg-white/70 hover:border-cyan-400 transition-all">
                  {modeBadge}
                  <span className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center text-white text-[9px] font-bold">
                    {roleLabel?.[0] || 'U'}
                  </span>
                  <span className="text-xs text-slate-700 font-medium" title={identityHint}>{shortAddr(account)}</span>
                  <ChevronDown className="w-3 h-3 text-slate-400" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-3 w-52 bg-white border border-slate-200 shadow-xl rounded-2xl py-1.5 z-50">
                    <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500 truncate" title={identityHint}>{identityHint}</span>
                      {modeBadge}
                    </div>
                    <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                      <span className="text-xs text-slate-500">当前角色</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-600 font-medium">{roleLabel || '未注册'}</span>
                    </div>
                    {/* ★ 进入工作台（仅首页菜单提供）：已连接用户回首页后的直达主行动 */}
                    <button onClick={() => { onNavigate?.('workbench'); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-4 py-2 text-sm font-medium text-cyan-700 hover:bg-cyan-50/60">
                      <LayoutDashboard className="w-3.5 h-3.5" strokeWidth={2} />
                      进入工作台
                    </button>
                    {/* 菜单顺序（v4.6 重排）：身份操作 → 模式操作 → 账号工具 → 退出 */}
                    {mode === 'sim' ? identityPicker : (
                      <button onClick={() => { onSwitchAccount?.(); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                        <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
                        切换账号
                      </button>
                    )}
                    {modeToggleItem}
                    <button onClick={copyAddress} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                      <Copy className="w-3.5 h-3.5" strokeWidth={2} />
                      <span>{copied ? '已复制' : '复制地址'}</span>
                    </button>
                    <div className="border-t border-slate-100 my-1" />
                    <button onClick={() => { onLogout?.(); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-50">
                      <LogOut className="w-3.5 h-3.5" strokeWidth={2} />
                      {mode === 'sim' ? '退出演示' : '断开连接'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 工作台模式：标准顶部导航栏（左侧标题，右侧灵动岛组件群，随内容排布、不遮挡）
  return (
    <header className={`h-20 px-8 flex items-center justify-between shrink-0 border-b border-slate-100/50 bg-white ${className}`}>
      {/* 左侧：页面标题 + 模式徽标（v4.6 双模式标识） */}
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-xl font-extrabold text-slate-800 tracking-tight shrink-0">{title}</h1>
        {modeBadge}
      </div>

      {/* 右侧：灵动岛组件群 */}
      <div className="flex items-center gap-3">
        {/* ★ 通知中心（v4.6）：铃铛点开极简通知面板，徽标 = 未读总数 */}
        <div className="relative shrink-0" ref={bellRef}>
          <button
            onClick={() => setBellOpen((v) => !v)}
            title="通知中心"
            className={`relative w-10 h-10 rounded-full flex items-center justify-center border transition-colors ${
              bellOpen
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-slate-50 text-slate-500 border-slate-100 hover:bg-slate-100'
            }`}
          >
            <Bell className="w-5 h-5" />
            {notifData.unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
                {notifData.unread > 99 ? '99+' : notifData.unread}
              </span>
            )}
          </button>
          {bellPanel}
        </div>

        {/* ★ 实时区块高度：体现链上正在持续出块
            响应式压缩：xl 以下优先收起（窄屏 / 钱包侧栏挤压时不遮挡账号与铃铛） */}
        <div
          title="当前链上区块高度（实时刷新）"
          className="hidden xl:flex items-center gap-2 h-10 px-4 rounded-full bg-slate-50 border border-slate-100"
        >
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-xs font-mono font-semibold text-slate-600">
            #{blockNumber ?? '—'}
          </span>
        </div>

        {/* 账号下拉 */}
        <div className="relative shrink-0" ref={menuRef}>
          {!account ? (
            <button onClick={onOpenLogin} className="px-5 py-2 rounded-full bg-slate-900 text-white text-sm font-medium transition-all hover:bg-slate-800">
              登录 / 注册
            </button>
          ) : (
            <>
              <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-50 border border-slate-100 hover:border-cyan-400 transition-all">
                {modeBadge}
                <span className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center text-white text-[10px] font-bold">
                  {roleLabel?.[0] || 'U'}
                </span>
                {/* 响应式压缩：md 以下只保留角色头像 + 箭头，地址悬浮 title 可见 */}
                <span className="hidden md:inline text-sm font-medium text-slate-700" title={identityHint}>{shortAddr(account)}</span>
                <ChevronDown className="w-4 h-4 text-slate-400" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-3 w-52 bg-white border border-slate-200 shadow-xl rounded-2xl py-1.5 z-50">
                  <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500 truncate" title={identityHint}>{identityHint}</span>
                    {modeBadge}
                  </div>
                  <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-500">当前角色</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-600 font-medium">{roleLabel || '未注册'}</span>
                  </div>
                  {/* 菜单顺序（v4.6 重排）：身份操作 → 模式操作 → 账号工具 → 退出 */}
                  {mode === 'sim' ? identityPicker : (
                    <button onClick={() => { onSwitchAccount?.(); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                      <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
                      切换账号
                    </button>
                  )}
                  {modeToggleItem}
                  <button onClick={copyAddress} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                    <Copy className="w-3.5 h-3.5" strokeWidth={2} />
                    <span>{copied ? '已复制' : '复制地址'}</span>
                  </button>
                  <div className="border-t border-slate-100 my-1" />
                  <button onClick={() => { onLogout?.(); setMenuOpen(false); }} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-500 hover:bg-red-50">
                    <LogOut className="w-3.5 h-3.5" strokeWidth={2} />
                    {mode === 'sim' ? '退出演示' : '断开连接'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </header>
  );
}
