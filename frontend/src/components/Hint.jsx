// ============================================================
// Hint.jsx —— 小问号提示（把长段说明收进一个「?」后面）
// ------------------------------------------------------------
// 为什么要它：
//   页面上大量说明性文字会把界面塞满，而真正需要这些解释的人只是少数。
//   统一做法是：正文只留**操作反馈**（报错 / 校验 / 状态 / 合规声明），
//   解释性内容收进一个 16px 的小问号，点开才看；更完整的说明放「使用说明」。
//
// 实现要点：
//   * 弹层用 createPortal 挂到 document.body —— 卡片常有 overflow-hidden 与 transform 动画，
//     直接内联绝对定位会被裁切或错位，portal 可以彻底避免。
//   * 弹层相对按钮的 rect 定位；点空白处 / 滚动 / 缩放即关闭。
// ============================================================
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function Hint({ title, children, width = 280, className = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, below: true });
  const btnRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const el = btnRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const below = r.bottom + 200 < window.innerHeight;
      const left = Math.min(Math.max(12, r.left + r.width / 2 - width / 2), Math.max(12, window.innerWidth - width - 12));
      setPos({ top: below ? r.bottom + 8 : r.top - 8, left, below });
    }
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, width]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="查看说明"
        title="查看说明"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={`inline-flex items-center justify-center w-4 h-4 ml-1.5 rounded-full bg-slate-200 text-slate-500 text-[10px] font-bold leading-none align-middle hover:bg-slate-300 hover:text-slate-700 transition-colors shrink-0 ${className}`}>
        ?
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[80]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[81] rounded-2xl bg-slate-900/95 text-white text-[11px] leading-relaxed px-3.5 py-2.5 shadow-2xl backdrop-blur-sm"
            style={{
              top: pos.top,
              left: pos.left,
              width,
              transform: pos.below ? undefined : 'translateY(-100%)',
            }}>
            {title && <div className="font-bold mb-1">{title}</div>}
            <div className="text-white/85">{children}</div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
