// ============================================================
// ErrorBoundary.jsx —— 全局错误边界
// ------------------------------------------------------------
// 定位：渲染期异常的全局兜底。若不拦截，异常会导致组件树整体卸载，
// 页面仅剩空白，用户无法获得任何报错信息。
// 引入错误边界后：渲染期异常被拦截并显示完整报错文字与恢复入口，
// 用户可直接截图定位问题。
// 注意：错误边界只能捕获渲染期异常，无法捕获事件回调 / 异步
// 任务中的异常（那类异常已通过 ds-global-error 通道转红横幅）。
// ============================================================
import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    // hasError：是否捕获到异常；error：异常对象（用于显示报错详情）
    this.state = { hasError: false, error: null };
  }

  // 渲染期抛出异常时触发：记录异常供界面展示
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  // 同时把异常打印到控制台，保留完整堆栈便于排查
  componentDidCatch(error, info) {
    console.error('页面渲染异常（错误边界捕获）', error, info);
  }

  render() {
    // 未发生异常：正常渲染子组件
    if (!this.state.hasError) return this.props.children;

    // 发生异常：显示报错卡片（红底白字 + 详情 + 刷新按钮），绝不白屏
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] px-6">
        <div className="w-full max-w-lg bg-white border border-red-200 shadow-sm rounded-2xl p-8">
          <h2 className="text-lg font-semibold text-red-600">页面渲染出现异常</h2>
          <p className="mt-2 text-sm text-slate-500">
            以下为具体报错信息，请截图反馈以便定位问题：
          </p>
          <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-red-300 whitespace-pre-wrap break-all">
            {String(this.state.error?.stack || this.state.error || '未知错误')}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            刷新页面
          </button>
        </div>
      </div>
    );
  }
}
