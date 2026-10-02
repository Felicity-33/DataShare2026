// ============================================================
// Sidebar.jsx —— 深色贴边悬浮胶囊侧边栏（v5.1 完全手动控制）
// ------------------------------------------------------------
// 结构：Logo + 收缩按钮 / 导航项 / 底部（说明 + 设置 + 链上状态 + 账号卡片）
// 说明：设置入口统一放在侧边栏底部（顶栏不再放齿轮），
//       并展示实时区块高度，体现「链上正在持续出块」。
//
// ★ v5.1 交互调整（替代 v5.0 自动收缩）：
//   - 侧栏完全由用户手动控制：点击按钮在「展开 256px ⇄ 收起 64px」间切换，
//     不做悬停展开 / 离开自动收起 / 窄屏挂载收起，杜绝"自动乱动"；
//   - 收起态保留核心功能可达性：导航 / 说明 / 设置为图标 + title 悬浮提示，
//     链上状态卡缩为呼吸灯（悬浮可见区块 / 合约版本 / ChainID）；
//   - 中央工作区随侧栏展开自动收窄（ml-72 ⇄ ml-20），由各工作台 main 实现。
// ============================================================
import { PanelLeftClose, PanelLeftOpen, LogOut, Settings, BookOpen } from 'lucide-react';

export default function Sidebar({
  title = '工作台', items = [], activeKey, onChange, collapsed, onToggle,
  userAddress = '',
  userName = '',
  onLogout,
  onOpenSettings,      // ★ 打开设置弹窗
  onOpenHelp,          // ★ 打开使用说明 / 疑问处
  blockNumber = null,  // ★ 实时区块高度（体现区块链特性）
  chainId = 1337,
  contractVersion = '',  // ★ 链上合约版本
  versionOk = true       // ★ 版本校验结果
}) {
  return (
    <aside
      className={`fixed left-4 top-4 bottom-4 z-30 flex flex-col overflow-hidden
                  bg-[#111827] rounded-[2rem]
                  shadow-[0_8px_32px_-8px_rgba(15,23,42,0.5)]
                  transition-[width] duration-300 ease-in-out
                  ${collapsed ? 'w-16' : 'w-64'}`}
    >
      {/* 顶部：Logo + 收缩按钮（完全手动：点击切换展开 / 收起） */}
      <div className="h-16 flex items-center justify-between px-5 shrink-0">
        {!collapsed && (
          <div className="flex items-center gap-3 whitespace-nowrap">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinejoin="round">
                <path d="M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z" />
              </svg>
            </div>
            <span className="text-sm font-bold text-white tracking-tight">链承共予 · DataShare</span>
          </div>
        )}
        <button
          onClick={() => onToggle?.(!collapsed)}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          className={`text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-all shrink-0 ${collapsed ? 'mx-auto' : ''}`}
        >
          {collapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
      </div>

      {/* 导航项：收起态保留图标 + title 提示，核心导航功能完全可达 */}
      <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto overflow-x-hidden">
        {items.map((n) => {
          const Icon = n.icon;
          const active = activeKey === n.key;
          return (
            <button
              key={n.key}
              onClick={() => onChange(n.key)}
              title={collapsed ? n.label : ''}
              className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-4 py-3 rounded-2xl text-sm font-medium whitespace-nowrap transition-all duration-300 ${
                active
                  ? 'bg-white text-slate-900 shadow-xl'
                  : 'text-slate-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" strokeWidth={2} />
              {!collapsed && <span>{n.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* 底部：说明 + 设置 + 链上状态 + 账号 */}
      <div className="px-3 pb-4 pt-3 border-t border-white/10 shrink-0 space-y-1.5">

        {/* ★ 使用说明 / 疑问处（把操作与设计边界集中讲清楚，避免误操作） */}
        <button
          onClick={onOpenHelp}
          title={collapsed ? '使用说明' : ''}
          className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-4 py-3 rounded-2xl text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white transition-all duration-300 whitespace-nowrap`}
        >
          <BookOpen className="w-5 h-5 shrink-0" strokeWidth={2} />
          {!collapsed && <span>使用说明</span>}
        </button>

        {/* ★ 设置入口（原来顶栏那个没用的齿轮，挪到这里并赋予真实功能） */}
        <button
          onClick={onOpenSettings}
          title={collapsed ? '设置' : ''}
          className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-4 py-3 rounded-2xl text-sm font-medium text-slate-400 hover:bg-white/5 hover:text-white transition-all duration-300 whitespace-nowrap`}
        >
          <Settings className="w-5 h-5 shrink-0" strokeWidth={2} />
          {!collapsed && <span>设置</span>}
        </button>

        {/* ★ 链上状态卡：连接状态 + 实时区块高度 + 合约版本
            收起态仅保留呼吸灯（悬浮可见完整状态提示，核心信息不丢失） */}
        <div
          className={`px-3.5 py-3 rounded-2xl bg-white/[0.04] border border-white/[0.06] ${collapsed ? 'flex justify-center' : ''}`}
          title={collapsed
            ? `已连接 Ganache · 区块 #${blockNumber ?? '—'} · 合约 v${contractVersion || '—'} · ChainID ${chainId}`
            : `已连接 Ganache · ChainID ${chainId} · 合约 v${contractVersion || '—'}`}
        >
          <div className={`flex items-center ${collapsed ? '' : 'gap-2'} `}>
            <span className="relative flex w-2 h-2 shrink-0">
              <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-400" />
            </span>
            {!collapsed && <span className="text-[10px] font-medium text-emerald-300/90 whitespace-nowrap">链上已连接</span>}
          </div>
          {!collapsed && (
            <>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] text-slate-500">区块高度</span>
                <span className="text-[10px] font-mono text-slate-300 tabular-nums">#{blockNumber ?? '—'}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] text-slate-500">合约版本</span>
                <span className={`text-[10px] font-mono ${versionOk ? 'text-slate-300' : 'text-amber-400'}`}>
                  v{contractVersion || '—'}{versionOk ? '' : ' ⚠'}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] text-slate-500">ChainID</span>
                <span className="text-[10px] font-mono text-slate-300">{chainId}</span>
              </div>
            </>
          )}
        </div>

        {/* 账号卡片：收起态缩为头像（悬浮可见账号名），展开态显示名称/地址/登出 */}
        <div
          title={collapsed ? userName : ''}
          className={`group flex items-center ${collapsed ? 'justify-center' : 'gap-3'} p-2 rounded-2xl hover:bg-white/5 transition-colors relative`}
        >
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-400 to-emerald-400 flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-md">
            {(userName || 'U').slice(0, 2).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white truncate">{userName}</div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">{userAddress}</div>
            </div>
          )}
          {!collapsed && (
            <button
              onClick={(e) => { e.stopPropagation(); onLogout && onLogout(); }}
              className="p-1.5 rounded-lg text-slate-400 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition-all shrink-0"
              title="断开连接"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
