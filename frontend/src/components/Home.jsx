// ============================================================
// Home.jsx —— 首页
// ------------------------------------------------------------
// 结构：
//   1. 背景层：<Background />
//   2. Hero 区：大标题（英文 DataShare，青绿渐变）+ Slogan
//   3. 三步闭环：确权 → 调用 → 分账（图标 + 大词 + 小字）
//   4. 信任标签：白色胶囊
//   5. 底部合规小字
// 入口：右上角「登录 / 注册」打开连接弹窗，弹窗内提供
//   「一键进入演示模式」（免钱包）与链上登录两种方式
// 视觉风格：现代 SaaS 极简 + 大留白 + 青绿渐变标题
// ============================================================
import Background from './Background';
import { ShieldCheck, Database, TrendingUp } from 'lucide-react';

// 三步闭环中的一步：图标 + 大词 + 小字
function Step({ icon: Icon, word, sub, delay = 0 }) {
  return (
    <div
      className="flex flex-col items-center text-center animate-fade-up group"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200/70 flex items-center justify-center mb-5
                      shadow-[0_2px_12px_-2px_rgba(15,23,42,0.06)]
                      transition-all duration-300
                      group-hover:shadow-[0_8px_30px_-6px_rgba(8,145,178,0.3)]
                      group-hover:-translate-y-1">
        <Icon className="w-7 h-7 text-cyan-600" strokeWidth={2} />
      </div>
      <div className="text-lg font-semibold text-slate-900 tracking-tight">{word}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  );
}

// 虚线箭头
function Arrow() {
  return (
    <svg width="60" height="10" viewBox="0 0 60 10" className="text-slate-300">
      <line x1="0" y1="5" x2="50" y2="5" stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" />
      <polyline points="46,1 52,5 46,9" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export default function Home() {
  return (
    <div className="relative min-h-screen">
      <Background />

      <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6">
        {/* Hero 区 —— 取适中字号，兼顾视觉冲击与排版平衡 */}
        <section className="flex flex-col items-center text-center animate-fade-up">
          <h1 className="text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight">
            <span className="text-slate-900">Data</span>
            <span className="bg-gradient-to-r from-cyan-600 via-emerald-500 to-cyan-500 bg-clip-text text-transparent">Share</span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-slate-500 max-w-xl leading-relaxed">
            让你的数据成为资产，每一次授权都有迹可循
          </p>
        </section>

        {/* 三步闭环 */}
        <section className="flex items-center justify-center gap-8 md:gap-16 mt-24">
          <Step icon={ShieldCheck} word="确权" sub="数据上链" delay={0} />
          <Arrow />
          <Step icon={Database} word="调用" sub="企业付费" delay={100} />
          <Arrow />
          <Step icon={TrendingUp} word="分账" sub="收益直达" delay={200} />
        </section>

        {/* 信任标签 */}
        <section className="flex flex-wrap items-center justify-center gap-3 mt-20">
          {['AccessControl', 'ReentrancyGuard', '字段级授权', 'ZKP 验证'].map((t) => (
            <span
              key={t}
              className="px-4 py-1.5 rounded-full bg-white/70 backdrop-blur-sm border border-slate-200/70 text-xs text-slate-500
                         transition-all duration-200
                         hover:border-cyan-300 hover:text-cyan-600 hover:bg-white"
            >
              {t}
            </span>
          ))}
        </section>
      </div>

      {/* 底部合规小字 */}
      <div className="fixed bottom-4 left-0 right-0 z-10 text-center text-xs text-slate-400 px-6">
        本平台仅供技术学习与研究，演示数据均为模拟数据，不涉及任何真实个人信息。
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-up { animation: fadeUp 600ms ease-out both; }
      `}</style>
    </div>
  );
}