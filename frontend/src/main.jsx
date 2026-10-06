// ============================================================
// React 入口文件
// ============================================================
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './index.css';

// 挂载 React 应用（不使用 StrictMode，避免开发环境重复挂载链上事件监听）
// ★ 外层包错误边界：任何渲染期异常都会显示报错卡片，避免异常只表现为空白页面
ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
