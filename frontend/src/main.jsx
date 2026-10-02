// ============================================================
// React 入口文件
// ============================================================
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// 挂载 React 应用（不使用 StrictMode，避免开发环境重复挂载链上事件监听）
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
