// ============================================================
// WelcomeBanner.jsx —— 概览页欢迎横幅（参考图风格）
// ------------------------------------------------------------
// 渐变横幅：左侧欢迎语 + 右侧「待办行动块」。
// 设计取舍：横幅右侧**不放统计指标**，只放"此刻待处理的事项"，
// 避免与下方 StatCard 出现同一组数字（收益 / 押金 / 分账）重复两遍。
// 待办数量为 0 时不显示箭头、不可点击，避免制造无意义的点击。
// ============================================================
import { ArrowRight } from 'lucide-react';

export default function WelcomeBanner({
  greeting = '欢迎回来',
  name = '',
  subtitle = '',
  action = null,        // { label, value, hint, onClick }  value 为 0 时自动降级为只读提示
  gradient = 'from-indigo-500 via-violet-500 to-purple-500',
  icon: Icon = null,
  delay = 0,
}) {
  const clickable = !!(action && action.onClick);

  return (
    <div
      className={`relative overflow-hidden rounded-[2rem] bg-gradient-to-br ${gradient} px-8 py-8 animate-fade-up`}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* 装饰：两枚柔光圆 */}
      <div className="absolute -right-10 -top-16 w-56 h-56 rounded-full bg-white/10" />
      <div className="absolute right-24 -bottom-20 w-40 h-40 rounded-full bg-white/5" />

      <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {Icon && (
              <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-white" strokeWidth={2} />
              </div>
            )}
            <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
              {greeting}{name ? `，${name}` : ''}
            </h2>
          </div>
          {subtitle && (
            <p className="mt-2.5 text-sm text-white/75 leading-relaxed max-w-xl">{subtitle}</p>
          )}
        </div>

        {action && (
          <div
            role={clickable ? 'button' : undefined}
            onClick={clickable ? action.onClick : undefined}
            title={action.hint}
            className={`shrink-0 rounded-2xl px-5 py-3.5 border border-white/15 bg-white/10 backdrop-blur text-right transition-all duration-300 ${
              clickable ? 'cursor-pointer hover:bg-white/20 hover:border-white/30' : ''
            }`}
          >
            <div className="text-[11px] text-white/60">{action.label}</div>
            <div className="mt-1 flex items-center justify-end gap-2">
              <span className="text-2xl font-bold text-white tabular-nums leading-none">{action.value}</span>
              {clickable && (
                <ArrowRight className="w-4 h-4 text-white/70 transition-transform duration-300 group-hover:translate-x-0.5" />
              )}
            </div>
            {action.hint && <div className="mt-1.5 text-[10px] text-white/50">{action.hint}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
