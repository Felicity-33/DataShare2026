// ============================================================
// Vite 配置文件 —— React 前端开发服务器
// ------------------------------------------------------------
// 端口固定 5174，strictPort=true 表示端口被占用时直接报错
// （不再自动换端口，避免每次打开不同地址）
// ============================================================
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,        // 固定端口
    strictPort: true,  // 端口被占用时报错，不自动换端口
    host: true,        // 允许局域网访问（便于双屏演示）
    open: false        // 不自动打开浏览器
  }
});