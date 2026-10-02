// ============================================================
// HelpModal.jsx —— 系统使用说明 / 疑问处（三端共用，内容随角色变化）
// ------------------------------------------------------------
// 入口在左侧栏底部（设置上方）。包含两块：
//   ① 快速上手：按当前角色给出 3-4 步最短路径
//   ② 常见疑问：把实际使用中真正会卡住的问题写清楚（可逐条展开）
// 说明：这里只讲"怎么用、为什么这样设计"，不涉及任何链上写操作。
// ============================================================
import { useState } from 'react';
import {
  X, ChevronDown, Compass, HelpCircle, Wallet, Database as DatabaseIcon,
  ShieldCheck, Scale, Sparkles, AlertTriangle
} from 'lucide-react';

const ROLE_META = {
  user: {
    label: '数据所有者',
    color: 'from-indigo-500 to-violet-500',
    icon: DatabaseIcon,
    steps: [
      ['上链确权', '「我的数据」选字段分类 → 点【上链确权】。前端会在本地生成零知识证明，随字段名一起上链。'],
      ['授权', '两种方式任选：① 直接打开字段的授权开关（主动授权）；② 等企业在「授权申请」页提交申请后审批。授权时可设有效期与次数上限。'],
      ['查看收益', '「托管结算」看哪些钱已可提现 → 点【提现】到账；「收益流水」看历史明细。'],
      ['查看被谁取用', '「取用凭证」列出每一次调用：谁、什么时候、哪条字段、凭证哈希与结算状态。'],
    ],
  },
  enterprise: {
    label: '数据调用方',
    color: 'from-cyan-500 to-blue-500',
    icon: Wallet,
    steps: [
      ['充值押金', '「充值押金」先充入一笔押金池，调用费用都从这里扣。'],
      ['找数据', '「数据市场」可用一句话描述需求让 AI 解析，也可用精确筛选；命中的字段会显示匹配理由。'],
      ['申请或直接调用', '未授权的字段先【申请授权】（不扣款）；已授权的字段点【直接调用】，确认后立即扣款并进入合约托管。'],
      ['结算与申诉', '「托管结算」查看进度：挑战期满自动结算，你也可以【提前结算】加速放款，有异议则【申诉】。'],
    ],
  },
  regulator: {
    label: '监管节点',
    color: 'from-slate-600 to-slate-800',
    icon: Scale,
    steps: [
      ['掌握全局', '「全局概览」的 AI 审计摘要会把链上事件汇总成结论与关注点。'],
      ['逐笔核验', '「凭证审计」列出全部托管单与交付凭证，可下钻查看完整证据链（每一步都有区块号与交易哈希），也可一键导出审计报告。'],
      ['裁决争议', '「争议裁决」对争议中的托管单选【退款给企业】或【放款给用户】。'],
      ['监控异常', '「异常监控」查看由合约自动留痕的违规拦截，并管理企业信誉分与失信标记。'],
    ],
  },
};

const FAQ = [
  {
    q: '为什么不能确权同名字段？',
    a: '同一账户下重复确权同名资产会让列表出现两行一模一样的字段名，自己也分不清哪个是哪个，前端因此直接拦住。如果你确实要为同名数据建立新版本，只要在名称后加后缀即可，例如「消费偏好·2026Q3」——合约侧的字段唯一标识其实是 fieldId，不是名称。',
  },
  {
    q: '「提现」按钮是灰的，点不了怎么办？',
    a: '说明这笔托管还没到解锁时间。状态列会显示倒计时（挑战期为 600 秒，生产环境建议 24–72 小时）。到期后状态会自动变成「可提现」，按钮即可点击；若企业提前结算，则立即解锁。另注：本地 Ganache 空闲时不出块，最新区块的时间戳会停在最后一次出块时刻，因此点击提现时前端会先让本地链时钟追上真实时间，再发交易 —— 这一步是本地演示环境的补偿，真实链上不存在。',
  },
  {
    q: '为什么调用的次数 / 天数不能超过我当初申请的？',
    a: '这是合约的硬性约束：授权时已约定「次数上限」或「有效期」，调用时的用量会与已用量累加，超出即被拒绝并留下拦截记录。调用弹窗会直接显示剩余额度并在超出时禁用按钮，不让你白白发一笔注定失败的交易。',
  },
  {
    q: '用户、企业、监管各自能在「存证」里看到多少？',
    a: '三者分级披露：数据所有者看自己字段的聚合结果；企业只能看本次被授权字段的最小必要范围（不含个人明细）；监管可以看到最完整的凭证与流程（全部事件、哈希、结算状态），但看不到链下数据内容——详细的是「存证」，不是「个人数据」。监管的权力边界是：可裁决不可动钱，可审计不可窥探。',
  },
  {
    q: '什么叫「托管」？钱去哪了？',
    a: '企业调用时，费用先从押金池扣除并进入智能合约托管，并没有直接打给数据所有者。挑战期内企业可提前结算或提出申诉；挑战期满无人异议，合约自动结算给数据所有者，此时用户在「托管结算」页才能提现。这样双方都有救济路径。',
  },
  {
    q: '为什么会看到「与链上凭证不一致」？',
    a: '这通常出现在合约升级前产生的历史记录上：链上存的是旧版本的凭证格式，前端按新格式重算自然对不上。新产生的调用都会显示「一致」。如需完全干净的环境，可由管理员重新部署合约。',
  },
  {
    q: '提示「余额不足，请充值！」是什么意思？',
    a: '押金池余额小于本次调用金额。请到「充值押金」补充。注意这次被拒绝的调用会由合约自动写入链上拦截记录（监管可见），所以不要用大额数量反复试探。',
  },
  {
    q: '数据真的上链了吗？会不会泄露？',
    a: '原始个人数据不上链。链上只保存两样东西：数据摘要哈希（用于事后校验数据是否被篡改）与授权凭证。演示环境中的数据集全部是模拟数据，不含任何真实个人信息。',
  },
  {
    q: '数据本体存在哪里？可以自己加数据集吗？',
    a: '数据本体是链下的数据文件，位于 frontend/public/data/ 下，每个「字段分类」对应一个 JSON 文件（当前共 17 个分类：消费偏好、出行习惯、收入水平、金融理财……）。链上只保存它的标识（dataRef，即索引）与内容摘要（deliveryHash，即承诺）。确权时选择的「字段分类」就决定了绑定哪个文件。想加新数据集：把 JSON 放进该目录，再把分类名加入 config.js 的 DATA_REFS 与确权表单的分类选项即可，链上无需改动。',
  },
  {
    q: '监管能冻结或没收资金吗？',
    a: '不能。合约里根本不存在把托管资金转给监管或第三方的函数。监管能做的只有两件：对争议二选一裁决（退款企业 / 放款用户），以及标记企业失信（只影响其调用权限）。',
  },
  {
    q: 'AI 会不会自动帮我定价或做决策？',
    a: '不会。AI 只做三件事：理解自然语言需求、解释数据、提示风险。定价、扣款、拦截、放款与裁决全部由智能合约的确定性规则执行，AI 不参与、也无法影响链上结果；所有链上写操作都需要你在钱包里手动确认。',
  },
];

function FaqItem({ item, open, onToggle }) {
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button onClick={onToggle} className="w-full flex items-start justify-between gap-4 py-4 text-left group">
        <span className={`text-sm font-medium transition-colors ${open ? 'text-cyan-700' : 'text-slate-700 group-hover:text-slate-900'}`}>
          {item.q}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 mt-0.5 text-slate-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <p className="pb-4 -mt-1 text-xs text-slate-500 leading-relaxed pr-8">{item.a}</p>
      )}
    </div>
  );
}

export default function HelpModal({ role = 'user', onClose }) {
  const meta = ROLE_META[role] || ROLE_META.user;
  const [openIdx, setOpenIdx] = useState(0);
  const Icon = meta.icon;

  return (
    <div className="fixed inset-0 z-[66] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white shadow-2xl rounded-3xl animate-fade-in max-h-[88vh] flex flex-col">

        {/* 头部 */}
        <div className="px-8 pt-7 pb-5 border-b border-slate-100 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${meta.color} flex items-center justify-center shadow-lg`}>
                <Compass className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">使用说明</h3>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                  <Icon className="w-3 h-3" />
                  当前角色：{meta.label}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-8 py-6 overflow-y-auto space-y-8">

          {/* ① 快速上手 */}
          <section>
            <h4 className="text-sm font-bold text-slate-800 mb-4">① 快速上手（最短路径）</h4>
            <ol className="space-y-3">
              {meta.steps.map(([title, desc], i) => (
                <li key={title} className="flex gap-3">
                  <span className={`w-6 h-6 rounded-full bg-gradient-to-br ${meta.color} text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-800">{title}</div>
                    <div className="mt-0.5 text-xs text-slate-500 leading-relaxed">{desc}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ② 常见疑问 */}
          <section>
            <h4 className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-slate-400" />
              ② 常见疑问
            </h4>
            <p className="text-[11px] text-slate-400 mb-2">点击问题展开答案</p>
            <div className="rounded-2xl border border-slate-100 px-4">
              {FAQ.map((item, i) => (
                <FaqItem key={item.q} item={item} open={openIdx === i} onToggle={() => setOpenIdx(openIdx === i ? -1 : i)} />
              ))}
            </div>
          </section>

          {/* ③ 设计边界（给评委/演示者的口径） */}
          <section className="rounded-2xl bg-slate-50 border border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-bold text-slate-700">两条权力边界（本项目的主张）</span>
            </div>
            <ul className="space-y-1.5">
              <li className="text-[11px] text-slate-600 leading-relaxed flex gap-2">
                <span className="text-slate-400 shrink-0">·</span>
                <span><strong>监管：可裁决，不可动钱</strong> —— 合约内没有任何把托管资金转给监管或第三方的路径。</span>
              </li>
              <li className="text-[11px] text-slate-600 leading-relaxed flex gap-2">
                <span className="text-slate-400 shrink-0">·</span>
                <span><strong>监管：可审计，不可窥探</strong> —— 监管能核对全部凭证与流程，但看不到链下个人数据内容。</span>
              </li>
            </ul>
            <div className="mt-3 pt-3 border-t border-slate-200/70 flex items-start gap-2">
              <Sparkles className="w-3.5 h-3.5 text-cyan-600 mt-0.5 shrink-0" />
              <p className="text-[11px] text-slate-500 leading-relaxed">
                AI 仅用于理解需求、解释数据与提示风险；定价、扣款、拦截、放款与裁决均由智能合约的确定性规则执行，
                AI 不参与、也无法影响链上结果。
              </p>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-200/70 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-[11px] text-slate-500 leading-relaxed">
                本平台仅供技术学习与研究，演示数据均为模拟数据，不涉及任何真实个人信息；
                链上只存数据摘要哈希与授权凭证，原始个人数据不上链。
              </p>
            </div>
          </section>
        </div>

        <div className="px-8 py-4 border-t border-slate-100 shrink-0">
          <button onClick={onClose}
            className="w-full px-5 py-3 rounded-2xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 transition-colors">
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
