// ============================================================
// ProofDrawer.jsx —— 上链存证详情抽屉（三端共用 · 按角色分级披露）
// ------------------------------------------------------------
// 点开任一托管结算单 / 取用凭证，展示：
//   ① 交付凭证校验：链下数据摘要 vs 链上存证哈希，验证是否被篡改
//   ② 完整证据链：字段上链 → 授权 → 押金充值 → 托管调用 → 提前结算/争议 → 放款
//      每一步都由链上事件自动组装，带区块号、交易哈希、时间
//   ③ 托管结算详情：双方地址、金额、解锁时间、争议理由
//
// ★ 权限分级（viewer 决定能看到多深）——「最小必要」原则同样约束监管：
//   user       数据所有者：可以看到自己字段的完整交付内容（这是他的数据）
//   enterprise 调用方：可以看到**本次被授权字段**的最小必要交付结果，看不到范围之外的数据
//   regulator  监管：只审计「凭证 + 流程 + 结算」，**不可查看个人数据内容**
//              —— 与「可裁决不可动钱」并列，形成完整的权力边界
// ============================================================
import { useState, useEffect } from 'react';
import { X, Copy, Check, Link2, ShieldCheck, Lock, ChevronDown } from 'lucide-react';
import { shortAddr, fmtEth, fmtTime, getDataPayload, dataFileUrl, hashPayload } from '../config.js';
import DataPayloadView from './DataPayloadView.jsx';

function Copyable({ text, copied, onCopy, className = '' }) {
  if (!text) return <span className="text-slate-300">—</span>;
  return (
    <span className={`inline-flex items-center gap-1 min-w-0 ${className}`}>
      <code className="font-mono text-[11px] break-all text-slate-700">{text}</code>
      <button
        onClick={() => onCopy(text)}
        className="p-1 rounded-md text-slate-400 hover:text-cyan-600 hover:bg-slate-100 transition-colors shrink-0"
        title="复制"
      >
        {copied === text ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </span>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500 shrink-0 pt-0.5">{label}</span>
      <span className="text-xs text-slate-800 text-right min-w-0">{children}</span>
    </div>
  );
}

// 证据链上的一个节点
function ChainStep({ index, label, note, tx, copied, onCopy, active }) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center shrink-0 pt-1">
        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
          tx ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-300'
        }`}>{index}</span>
        <span className="w-px flex-1 bg-slate-100 my-1" />
      </div>
      <div className="pb-4 min-w-0 flex-1">
        <div className={`text-xs font-bold ${tx ? 'text-slate-800' : 'text-slate-300'}`}>
          {label}
          {active && <span className="ml-2 text-[10px] font-normal text-amber-600">进行中</span>}
        </div>
        {note && <div className="mt-0.5 text-[11px] text-slate-400">{note}</div>}
        {tx ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
            <span className="font-mono">区块 #{tx.blockNumber}</span>
            <span>{fmtTime(tx.ts)}</span>
            <Copyable text={tx.hash} copied={copied} onCopy={onCopy} />
          </div>
        ) : (
          <div className="mt-1 text-[10px] text-slate-300">未发生</div>
        )}
      </div>
    </div>
  );
}

// 各角色的数据可见范围说明（放在抽屉顶部，方便评委一眼看清权限边界）
const VIEWER_META = {
  user: {
    tag: '数据所有者视角',
    desc: '你名下的数据与结算记录，可查看完整内容与全部凭证。',
  },
  enterprise: {
    tag: '数据调用方视角',
    desc: '仅显示本次授权范围内的最小必要结果。',
  },
  regulator: {
    tag: '监管视角',
    desc: '可审计全部凭证与流程，不可查看个人数据内容。',
  },
};

export default function ProofDrawer({ row, contract, viewer = 'user', onClose }) {
  const [copied, setCopied] = useState('');
  const [evidence, setEvidence] = useState(null);
  const [showData, setShowData] = useState(false);   // 交付数据默认折叠（先给"大概"，需要再看详情）

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(''), 1500);
    } catch { /* 忽略 */ }
  };

  // 从链上事件自动组装证据链
  useEffect(() => {
    if (!contract || !row) return;
    let alive = true;
    (async () => {
      const safe = async (fn) => { try { return await fn(); } catch { return []; } };
      const id = row.escrowId;
      const [registered, granted, deposits, created, confirmed, raised, resolved, withdrawn] = await Promise.all([
        safe(() => contract.queryFilter(contract.filters.FieldRegistered(row.fieldId))),
        safe(() => contract.queryFilter(contract.filters.PermissionGranted(row.fieldId, null, row.enterprise))),
        safe(() => contract.queryFilter(contract.filters.DepositMade(row.enterprise))),
        safe(() => contract.queryFilter(contract.filters.EscrowCreated(id))),
        safe(() => contract.queryFilter(contract.filters.DeliveryConfirmed(id))),
        safe(() => contract.queryFilter(contract.filters.DisputeRaised(id))),
        safe(() => contract.queryFilter(contract.filters.DisputeResolved(id))),
        safe(() => contract.queryFilter(contract.filters.RevenueWithdrawn(id))),
      ]);
      if (!alive) return;
      const pack = async (ev) => ({
        hash: ev.transactionHash,
        blockNumber: ev.blockNumber,
        ts: (await ev.getBlock()).timestamp,
      });
      const last = (arr) => (arr && arr.length ? arr[arr.length - 1] : null);
      const [reg, gra, dep, cre, con, rai, res, wit] = await Promise.all([
        last(registered), last(granted), last(deposits), last(created),
        last(confirmed), last(raised), last(resolved), last(withdrawn),
      ]);
      setEvidence({
        registered: reg ? await pack(reg) : null,
        granted: gra ? await pack(gra) : null,
        deposit: dep ? await pack(dep) : null,
        created: cre ? await pack(cre) : null,
        confirmed: con ? await pack(con) : null,
        disputeRaised: rai ? await pack(rai) : null,
        disputeResolved: res ? await pack(res) : null,
        withdrawn: wit ? await pack(wit) : null,
      });
    })();
    return () => { alive = false; };
  }, [contract, row]);

  if (!row) return null;

  const meta = VIEWER_META[viewer] || VIEWER_META.user;
  const canViewData = viewer !== 'regulator';

  const payload = getDataPayload(row.dataRef);
  const localDigest = payload ? hashPayload(payload) : '';
  const match = !!payload && localDigest === row.deliveryHash;

  const status = row.refunded ? '已退款（争议成立）'
    : row.settled ? '已结算（已放款给数据所有者）'
    : row.disputed ? '争议中 · 待监管裁决'
    : row.confirmedAt > 0 ? '企业已提前结算 · 待数据所有者提现'
    : '托管中 · 挑战期结束后自动结算';

  return (
    <div className="fixed inset-0 z-[65] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl h-full bg-white shadow-2xl overflow-y-auto animate-fade-in">

        {/* 头部 */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-8 py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">上链存证详情</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  托管单 #{row.escrowId} · 字段「{row.fieldName}」
                </p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 当前角色的可见范围 */}
          <div className="mt-4 flex items-start gap-2.5 rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
            <div className="text-[11px] leading-relaxed">
              <span className="font-bold text-slate-700">{meta.tag}</span>
              <span className="text-slate-500"> · {meta.desc.replace(/\*\*/g, '')}</span>
            </div>
          </div>
        </div>

        <div className="px-8 py-6 space-y-7">

          {/* ① 交付凭证与摘要校验 */}
          <section>
            <h4 className="text-sm font-bold text-slate-800 mb-3">① 交付凭证校验</h4>
            <div className={`p-4 rounded-2xl border ${match ? 'bg-emerald-50/60 border-emerald-100' : 'bg-slate-50 border-slate-200'}`}>
              <div className="text-xs font-bold">
                <span className={match ? 'text-emerald-700' : 'text-slate-600'}>
                  {match ? '✓ 链下数据与链上凭证一致' : '· 与链上凭证不一致'}
                </span>
                <span className="ml-2 text-[10px] font-normal text-slate-400">
                  {match ? '数据未被篡改' : '本合同升级前的历史记录（旧版凭证格式）'}
                </span>
              </div>
              <div className="mt-3 space-y-2 text-[10px]">
                <div className="text-slate-500">本地重算摘要 <span className="font-mono text-slate-700 break-all">{localDigest}</span></div>
                <div className="text-slate-500">链上存证凭证 <span className="font-mono text-slate-700 break-all">{row.deliveryHash}</span></div>
              </div>
            </div>

            {canViewData ? (
              <div className="mt-3 rounded-2xl border border-slate-100 overflow-hidden">
                <button
                  onClick={() => setShowData((v) => !v)}
                  className="w-full px-4 py-3 bg-slate-50 flex items-center justify-between gap-3 hover:bg-slate-100/70 transition-colors"
                >
                  <span className="text-xs font-bold text-slate-700">交付数据（链下 · 聚合脱敏）</span>
                  <span className="flex items-center gap-1.5 shrink-0 text-[10px] text-slate-400">
                    {showData ? '收起' : '展开查看链下数据文件'}
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${showData ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {showData && (
                  <div className="px-4 py-4">
                    <DataPayloadView payload={payload} fileUrl={dataFileUrl(row.dataRef)} />
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-5 flex items-start gap-3">
                <Lock className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <div className="text-[11px] leading-relaxed">
                  <div className="font-bold text-slate-700 mb-1">数据内容对监管不可见</div>
                  <div className="text-slate-500">
                    监管审计的是「授权是否成立、结算是否准确、流程是否留痕」，而非个人数据本身 ——
                    可校验上方摘要哈希与完整证据链，但读不到链下内容。
                  </div>
                  <div className="text-slate-400 mt-1.5">这就是「可审计不可窥探」。</div>
                </div>
              </div>
            )}

            {/* ★ 监管专属：审计维度的"更详细存证" —— 详细的是凭证与流程，不是个人数据 */}
            {!canViewData && (
              <div className="mt-3 rounded-2xl border border-slate-100 overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-700">
                  审计元数据（监管专属）
                </div>
                <div className="px-4 py-1">
                  <Row label="合约地址">
                    <Copyable text={contract?.target || contract?.address || ''} copied={copied} onCopy={copy} />
                  </Row>
                  <Row label="托管单 ID">#{row.escrowId}</Row>
                  <Row label="字段">「{row.fieldName}」/ ID {row.fieldId}</Row>
                  <Row label="交付凭证（完整）">
                    <Copyable text={row.deliveryHash} copied={copied} onCopy={copy} />
                  </Row>
                  <Row label="已上链事件节点">
                    {evidence ? `${Object.values(evidence).filter(Boolean).length} / 8 个` : '读取中…'}
                  </Row>
                </div>
                <div className="px-4 py-2.5 border-t border-slate-100 text-[10px] text-slate-400 leading-relaxed">
                  监管拿到最完整的<strong className="text-slate-500">凭证与流程</strong>信息，但不含链下数据内容。
                </div>
              </div>
            )}
          </section>

          {/* ② 完整证据链 */}
          <section>
            <h4 className="text-sm font-bold text-slate-800 mb-1">② 完整证据链（由链上事件自动组装）</h4>
            <p className="text-[11px] text-slate-400 mb-4">
              每个节点均可点开复制交易哈希，在链上逐笔核对
            </p>

            {!evidence ? (
              <div className="text-xs text-slate-400 py-6 text-center">正在从链上读取事件…</div>
            ) : (
              <div>
                <ChainStep index="1" label="数据字段上链确权" tx={evidence.registered} copied={copied} onCopy={copy}
                  note={`字段「${row.fieldName}」写入合约，所有者 ${shortAddr(row.user)}`} />
                <ChainStep index="2" label="数据所有者授权" tx={evidence.granted} copied={copied} onCopy={copy}
                  note={`授权给企业 ${shortAddr(row.enterprise)}`} />
                <ChainStep index="3" label="企业充值押金" tx={evidence.deposit} copied={copied} onCopy={copy}
                  note="调用费用从押金池扣除" />
                <ChainStep index="4" label="托管调用 + 交付凭证" tx={evidence.created} copied={copied} onCopy={copy}
                  note={`${fmtEth(row.amount)} ETH 进入合约托管，交付凭证已存证`} />
                <ChainStep index="5"
                  label={row.disputed ? '企业对交付提出争议' : '企业提前结算'}
                  tx={row.disputed ? evidence.disputeRaised : evidence.confirmed}
                  copied={copied} onCopy={copy}
                  note={row.disputed
                    ? `申诉理由：${row.disputeReason || '—'}（资金锁定等待裁决）`
                    : '挑战期内企业主动提前结算，立即解锁给数据所有者'}
                  active={!row.settled && !row.disputed && row.confirmedAt === 0} />
                <ChainStep index="6"
                  label={row.refunded ? '监管裁决：退款给企业' : '结算放款给数据所有者'}
                  tx={row.refunded ? evidence.disputeResolved : (evidence.withdrawn || evidence.disputeResolved)}
                  copied={copied} onCopy={copy}
                  note={row.refunded
                    ? '费用退回企业押金池，分账取消'
                    : row.settled ? '收益已实际转入数据所有者钱包' : '尚未结算'}
                  active={!row.settled} />
              </div>
            )}
          </section>

          {/* ③ 托管结算详情 */}
          <section>
            <h4 className="text-sm font-bold text-slate-800 mb-3">③ 托管结算详情</h4>
            <div className="px-4 rounded-2xl bg-slate-50/70 border border-slate-100">
              <Row label="结算状态"><span className="font-medium">{status}</span></Row>
              <Row label="托管金额"><span className="font-bold text-slate-900">{fmtEth(row.amount)} ETH</span></Row>
              <Row label="数据所有者">
                <Copyable text={row.user} copied={copied} onCopy={copy} />
              </Row>
              <Row label="调用企业">
                <Copyable text={row.enterprise} copied={copied} onCopy={copy} />
              </Row>
              <Row label="创建时间">{fmtTime(row.ts)}</Row>
              {row.confirmedAt > 0 && <Row label="提前结算时间">{fmtTime(row.confirmedAt)}</Row>}
              {row.disputeReason && <Row label="争议理由"><span className="text-rose-500">{row.disputeReason}</span></Row>}
              <Row label="交易哈希">
                <Copyable text={row.txHash} copied={copied} onCopy={copy} />
              </Row>
            </div>
          </section>

          <p className="text-[11px] text-slate-400 flex items-start gap-2">
            <Link2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            链上只存摘要哈希与凭证；用同一份链下数据重算摘要，与链上比对即可验证是否被篡改。
          </p>
        </div>
      </div>
    </div>
  );
}
