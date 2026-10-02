// ============================================================
// TailwindCSS 配置文件
// ============================================================
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,jsx}'
  ],
  theme: {
    extend: {
      // 主色：信任蓝 / 翠绿 / 鲜红（克制透明版视觉规范）
      colors: {
        brand: {
          blue: '#2563EB',
          emerald: '#10B981',
          red: '#EF4444'
        }
      }
    }
  },
  plugins: []
};
