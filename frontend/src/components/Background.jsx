// ============================================================
// Background.jsx —— 首页背景（淡青渐变 + 柔和弧线 + 稀疏流动光点）
// ============================================================
import { useEffect } from 'react';

const BG_STYLE = `
/* 中央光雾呼吸 */
@keyframes haloBreath {
  0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.65; }
  50%      { transform: translate(-50%, -50%) scale(1.12); opacity: 0.9; }
}
.bg-halo { animation: haloBreath 12s ease-in-out infinite; }

/* 弧线缓慢漂移 */
@keyframes arcDrift {
  0%, 100% { transform: translateX(0); }
  50%      { transform: translateX(24px); }
}
.bg-arc { animation: arcDrift 16s ease-in-out infinite; }

/* 光点沿弧线流动 */
.bg-flow {
  filter: drop-shadow(0 0 8px rgba(6,182,212,0.95));
}

/* 稀疏漂浮光点 */
@keyframes dotFloat {
  0%, 100% { transform: translate(0, 0); opacity: 0.4; }
  50%      { transform: translate(12px, -14px); opacity: 0.85; }
}
.bg-dot { animation: dotFloat 12s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .bg-halo, .bg-arc, .bg-dot { animation: none; }
}
`;

// 稀疏漂浮光点（画面上散落的几个）
const FLOAT_DOTS = [
  { x: '16%', y: '28%', size: 5 },
  { x: '28%', y: '62%', size: 4 },
  { x: '40%', y: '22%', size: 3 },
  { x: '60%', y: '70%', size: 4 },
  { x: '74%', y: '30%', size: 5 },
  { x: '86%', y: '58%', size: 3 },
];

export default function Background() {
  return (
    <div
      className="fixed inset-0 -z-10 pointer-events-none overflow-hidden"
      style={{
        background: 'linear-gradient(160deg, #ECFEFF 0%, #D1FAE5 50%, #CFFAFE 100%)',
      }}
    >
      <style>{BG_STYLE}</style>

      {/* ===== 中央光雾 ===== */}
      <div
        className="bg-halo absolute"
        style={{
          left: '50%',
          top: '42%',
          width: '1000px',
          height: '620px',
          background: 'radial-gradient(ellipse, rgba(6,182,212,0.35) 0%, rgba(16,185,129,0.15) 45%, rgba(6,182,212,0) 70%)',
          filter: 'blur(80px)',
          borderRadius: '9999px',
        }}
      />

      {/* ===== 上弧线组（顶部 3 条柔弧 + 沿线光点） ===== */}
      <svg
        className="bg-arc absolute"
        style={{ top: 0, left: 0, width: '100%', height: '380px', opacity: 0.9 }}
        viewBox="0 0 1440 380"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="arcTopGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#06B6D4" stopOpacity="0" />
          </linearGradient>
          <path id="topArc1" d="M-100,140 Q 720,20 1540,140" />
          <path id="topArc2" d="M-100,200 Q 720,100 1540,200" />
          <path id="topArc3" d="M-100,270 Q 720,190 1540,270" />
        </defs>

        {/* 顶部柔光带 */}
        <path d="M-100,140 Q 720,20 1540,140 L1540,0 L-100,0 Z" fill="url(#arcTopGrad)" opacity="0.6" />

        {/* 3 条弧线 */}
        <use href="#topArc1" fill="none" stroke="#22D3EE" strokeWidth="1.2" strokeOpacity="0.5" />
        <use href="#topArc2" fill="none" stroke="#22D3EE" strokeWidth="1" strokeOpacity="0.35" />
        <use href="#topArc3" fill="none" stroke="#67E8F9" strokeWidth="0.8" strokeOpacity="0.25" />

        {/* 沿弧线流动的光点 */}
        <circle r="3.5" fill="#06B6D4" className="bg-flow">
          <animateMotion dur="9s" repeatCount="indefinite">
            <mpath href="#topArc1" />
          </animateMotion>
          <animate attributeName="opacity" values="0;1;1;0" dur="9s" repeatCount="indefinite" />
        </circle>
        <circle r="2.5" fill="#22D3EE" className="bg-flow">
          <animateMotion dur="12s" repeatCount="indefinite" begin="3s">
            <mpath href="#topArc2" />
          </animateMotion>
          <animate attributeName="opacity" values="0;1;1;0" dur="12s" repeatCount="indefinite" begin="3s" />
        </circle>
      </svg>

      {/* ===== 下弧线组（底部 3 条柔弧 + 沿线光点） ===== */}
      <svg
        className="bg-arc absolute"
        style={{ bottom: 0, left: 0, width: '100%', height: '380px', opacity: 0.9, animationDelay: '3s' }}
        viewBox="0 0 1440 380"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="arcBottomGrad" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#10B981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
          </linearGradient>
          <path id="botArc1" d="M-100,240 Q 720,360 1540,240" />
          <path id="botArc2" d="M-100,180 Q 720,280 1540,180" />
          <path id="botArc3" d="M-100,110 Q 720,210 1540,110" />
        </defs>

        {/* 底部柔光带 */}
        <path d="M-100,240 Q 720,360 1540,240 L1540,380 L-100,380 Z" fill="url(#arcBottomGrad)" opacity="0.6" />

        {/* 3 条弧线 */}
        <use href="#botArc1" fill="none" stroke="#34D399" strokeWidth="1.2" strokeOpacity="0.5" />
        <use href="#botArc2" fill="none" stroke="#34D399" strokeWidth="1" strokeOpacity="0.35" />
        <use href="#botArc3" fill="none" stroke="#6EE7B7" strokeWidth="0.8" strokeOpacity="0.25" />

        {/* 沿弧线流动的光点 */}
        <circle r="3.5" fill="#10B981" className="bg-flow">
          <animateMotion dur="10s" repeatCount="indefinite">
            <mpath href="#botArc1" />
          </animateMotion>
          <animate attributeName="opacity" values="0;1;1;0" dur="10s" repeatCount="indefinite" />
        </circle>
        <circle r="2.5" fill="#34D399" className="bg-flow">
          <animateMotion dur="13s" repeatCount="indefinite" begin="4s">
            <mpath href="#botArc2" />
          </animateMotion>
          <animate attributeName="opacity" values="0;1;1;0" dur="13s" repeatCount="indefinite" begin="4s" />
        </circle>
      </svg>

      {/* ===== 稀疏漂浮光点 ===== */}
      {FLOAT_DOTS.map((d, i) => (
        <div
          key={i}
          className="bg-dot absolute hidden md:block"
          style={{
            left: d.x,
            top: d.y,
            width: d.size,
            height: d.size,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #22D3EE 0%, rgba(34,211,238,0) 70%)',
            boxShadow: '0 0 14px rgba(34,211,238,0.9)',
            animationDelay: `${i * 1.5}s`,
          }}
        />
      ))}
    </div>
  );
}