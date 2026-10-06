// ============================================================
// useSimWeb3.js —— 模拟模式 Web3 Hook（与 useWeb3 完全同接口）
// ------------------------------------------------------------
// 定位：把 mockChain.js 的模拟合约包装成 useWeb3 同形返回值，
//   让 App.jsx / 三个工作台 / ProofDrawer / SettingsModal 零改动
//   即可在「免钱包演示模式」下运行。
// 与 useWeb3 的行为差异（其余一一对应）：
//   - connect() 不需要 MetaMask：直接进入演示身份（默认「演示用户」）
//   - switchAccount() 在三个演示身份间轮换（用户 → 企业 → 监管），
//     每次切换广播链变更 → eventsVersion +1 → 各工作台自动重拉数据
//   - networkOk / versionOk 恒为 true（模拟合约与前端 ABI 天然一致）
// 事件回调（onRevenue / onAuthRequest / onAuthResult / onDisputeRaised /
// onDisputeResolved）的触发时机与参数与 useWeb3 完全一致。
// ============================================================
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  createSimContract, setSimActor, getSimActor,
  subscribeSimChanges, hydrateSeedDeliveryHashes,
  SIM_IDENTITY_ORDER, SIM_CONTRACT_VERSION,
} from '../sim/mockChain.js';

export function useSimWeb3({
  onRevenue, onAuthRequest, onAuthResult, onDisputeRaised, onDisputeResolved,
} = {}) {
  // 模拟合约单例（同一页面共享一条链）
  const contract = useMemo(() => createSimContract(), []);
  const provider = contract.runner.provider;

  const [account, setAccount] = useState(() => getSimActor());
  const [role, setRole] = useState('none');
  const [connected, setConnected] = useState(false);
  const [eventsVersion, setEventsVersion] = useState(0);

  // 用 ref 保存最新回调，避免监听器闭包过期（与 useWeb3 同款做法）
  const cbRef = useRef({ onRevenue, onAuthRequest, onAuthResult, onDisputeRaised, onDisputeResolved });
  cbRef.current = { onRevenue, onAuthRequest, onAuthResult, onDisputeRaised, onDisputeResolved };

  // 读某地址角色
  const getRole = useCallback(async (addr) => {
    if (!addr) return 'none';
    try { return await contract.roleOf(addr); } catch { return 'none'; }
  }, [contract]);

  // 刷新当前身份角色
  const refreshRole = useCallback(async () => {
    setRole(await getRole(account));
  }, [getRole, account]);

  // 连接（免钱包）：进入当前演示身份
  const connect = useCallback(async () => {
    const addr = getSimActor();
    setAccount(addr);
    setRole(await getRole(addr));
    setConnected(true);
    return { account: addr };
  }, [getRole]);

  // 断开连接：退回首页态（保留演示数据，重进后继续）
  const disconnect = useCallback(() => {
    setConnected(false);
    setRole('none');
  }, []);

  // 演示身份切换：无参 = 按 用户 → 企业 → 监管 顺序轮换（Header 菜单）；
  // 传入目标地址 = 直达（设置面板的身份按钮）。setSimActor 内部广播链变更
  // → eventsVersion +1 → 各工作台自动重拉数据
  const switchAccount = useCallback((target) => {
    const cur = getSimActor();
    let next;
    if (target && SIM_IDENTITY_ORDER.includes(target) && target !== cur) {
      next = target;
    } else {
      const idx = SIM_IDENTITY_ORDER.indexOf(cur);
      next = SIM_IDENTITY_ORDER[(idx + 1) % SIM_IDENTITY_ORDER.length];
    }
    setSimActor(next);
    setAccount(next);
    getRole(next).then(setRole);
    return next;
  }, [getRole]);

  // 角色自助注册（演示身份均已预注册，此路径仅兜底）
  const registerRole = useCallback(async (kind) => {
    const fn = kind === 'user' ? 'registerAsUser'
      : kind === 'enterprise' ? 'registerAsEnterprise'
      : 'registerAsRegulator';
    const tx = await contract[fn]();
    await tx.wait();
    await refreshRole();
    return role;
  }, [contract, refreshRole, role]);

  // ---------------- 链变更 → eventsVersion（三端联动刷新的总开关） ----------------
  useEffect(() => subscribeSimChanges(() => setEventsVersion((v) => v + 1)), []);

  // 启动即回填种子托管单的真实交付凭证（链下数据摘要），
  // 与链上 callData 写入的口径完全一致，避免存证抽屉误报「旧版凭证格式」
  useEffect(() => { void hydrateSeedDeliveryHashes(); }, []);

  // 初始拉取角色（hook 挂载即就绪，配合 connect 显示）
  useEffect(() => { getRole(account).then(setRole); }, [account, getRole]);

  // ---------------- 面向当前用户的定向事件监听（与 useWeb3 行为一致） ----------------
  useEffect(() => {
    if (!connected || !account) return;
    const me = account.toLowerCase();

    // 收益到账（用户端绿色 Toast）
    const onRevenueEv = (fieldId, user, enterprise, amount) => {
      if (String(user).toLowerCase() === me) {
        cbRef.current.onRevenue?.({ fieldId: Number(fieldId), enterprise, amount: amount.toString() });
      }
    };
    // 新授权申请（用户端通知铃铛）
    const onAuthReqEv = (requestId, fieldId, user, enterprise) => {
      if (String(user).toLowerCase() === me) {
        cbRef.current.onAuthRequest?.({ requestId: Number(requestId), fieldId: Number(fieldId), enterprise });
      }
    };
    // 审批结果（企业端提示）
    const onAuthAppEv = (requestId, fieldId, user, enterprise) => {
      if (String(enterprise).toLowerCase() === me) {
        cbRef.current.onAuthResult?.({ requestId: Number(requestId), approved: true });
      }
    };
    const onAuthDenEv = (requestId, fieldId, user, enterprise) => {
      if (String(enterprise).toLowerCase() === me) {
        cbRef.current.onAuthResult?.({ requestId: Number(requestId), approved: false });
      }
    };
    // 申诉提交（企业本人）
    const onDisputeRaisedEv = (escrowId, enterprise, fieldId, reason) => {
      if (String(enterprise).toLowerCase() === me) {
        cbRef.current.onDisputeRaised?.({ escrowId: Number(escrowId), fieldId: Number(fieldId), reason });
      }
    };
    // 裁决结果：按托管单归属分发（用户放款 / 企业退款驳回）
    const onDisputeResolvedEv = async (escrowId, refundedToEnterprise, regulator, amount) => {
      try {
        const e = await contract.escrows(Number(escrowId));
        const isUser = String(e.user).toLowerCase() === me;
        const isEnt = String(e.enterprise).toLowerCase() === me;
        if (isUser || isEnt) {
          cbRef.current.onDisputeResolved?.({
            escrowId: Number(escrowId), refunded: refundedToEnterprise,
            amount: amount.toString(), myRole: isUser ? 'user' : 'enterprise',
          });
        }
      } catch { /* 托管单回读失败时忽略 */ }
    };

    contract.on('RevenueDistributed', onRevenueEv);
    contract.on('AuthorizationRequested', onAuthReqEv);
    contract.on('AuthorizationApproved', onAuthAppEv);
    contract.on('AuthorizationDenied', onAuthDenEv);
    contract.on('DisputeRaised', onDisputeRaisedEv);
    contract.on('DisputeResolved', onDisputeResolvedEv);
    return () => {
      contract.off('RevenueDistributed', onRevenueEv);
      contract.off('AuthorizationRequested', onAuthReqEv);
      contract.off('AuthorizationApproved', onAuthAppEv);
      contract.off('AuthorizationDenied', onAuthDenEv);
      contract.off('DisputeRaised', onDisputeRaisedEv);
      contract.off('DisputeResolved', onDisputeResolvedEv);
    };
  }, [contract, connected, account]);

  // ---------------- 全量事件归一化（形状与 useWeb3.fetchAllEvents 一致） ----------------
  const fetchAllEvents = useCallback(async () => {
    const base = (ev, ts, extra) => ({
      ts, txHash: ev.transactionHash, blockNumber: ev.blockNumber, ...extra,
    });
    try {
      const [rev, dep, fld, gran, revo, blk, req, app, deny] = await Promise.all([
        contract.queryFilter('RevenueDistributed', 0, 'latest'),
        contract.queryFilter('DepositMade', 0, 'latest'),
        contract.queryFilter('FieldRegistered', 0, 'latest'),
        contract.queryFilter('PermissionGranted', 0, 'latest'),
        contract.queryFilter('PermissionRevoked', 0, 'latest'),
        contract.queryFilter('AccessAttemptBlocked', 0, 'latest'),
        contract.queryFilter('AuthorizationRequested', 0, 'latest'),
        contract.queryFilter('AuthorizationApproved', 0, 'latest'),
        contract.queryFilter('AuthorizationDenied', 0, 'latest'),
      ]);
      const mapAll = (evs, mapFn) => evs.map((ev) => mapFn(ev, ev.ts ?? ev.args?.ts));
      return {
        revenues: mapAll(rev, (ev, ts) => base(ev, ts, {
          fieldId: Number(ev.args.fieldId), user: ev.args.user,
          enterprise: ev.args.enterprise, amount: ev.args.amount.toString(),
        })),
        deposits: mapAll(dep, (ev, ts) => base(ev, ts, {
          enterprise: ev.args.enterprise, amount: ev.args.amount.toString(), balance: ev.args.balance.toString(),
        })),
        fields: mapAll(fld, (ev, ts) => base(ev, ts, {
          fieldId: Number(ev.args.fieldId), owner: ev.args.owner, name: ev.args.name,
        })),
        grants: mapAll(gran, (ev, ts) => base(ev, ts, {
          fieldId: Number(ev.args.fieldId), user: ev.args.user, enterprise: ev.args.enterprise,
        })),
        revokes: mapAll(revo, (ev, ts) => base(ev, ts, {
          fieldId: Number(ev.args.fieldId), user: ev.args.user, enterprise: ev.args.enterprise,
        })),
        blocked: mapAll(blk, (ev, ts) => base(ev, ts, {
          fieldId: Number(ev.args.fieldId), enterprise: ev.args.enterprise, reason: ev.args.reason,
        })),
        authReqs: mapAll(req, (ev, ts) => base(ev, ts, {
          requestId: Number(ev.args.requestId), fieldId: Number(ev.args.fieldId),
          user: ev.args.user, enterprise: ev.args.enterprise, price: ev.args.unitPrice.toString(),
        })),
        authApps: mapAll(app, (ev, ts) => base(ev, ts, {
          requestId: Number(ev.args.requestId), fieldId: Number(ev.args.fieldId),
          user: ev.args.user, enterprise: ev.args.enterprise, price: ev.args.unitPrice.toString(),
        })),
        authDenies: mapAll(deny, (ev, ts) => base(ev, ts, {
          requestId: Number(ev.args.requestId), fieldId: Number(ev.args.fieldId),
          user: ev.args.user, enterprise: ev.args.enterprise, price: ev.args.unitPrice.toString(),
        })),
      };
    } catch (e) {
      console.error('拉取模拟链事件失败', e);
      return {
        revenues: [], deposits: [], fields: [], grants: [], revokes: [],
        blocked: [], authReqs: [], authApps: [], authDenies: [],
      };
    }
  }, [contract]);

  return {
    // 与 useWeb3 完全同形的返回接口
    provider,
    signer: { getAddress: async () => account },   // 模拟签名者（无真实签名语义）
    contract,
    account,
    role,
    connected,
    connecting: false,
    networkOk: true,               // 模拟链恒可用
    eventsVersion,
    contractVersion: SIM_CONTRACT_VERSION,
    versionOk: true,               // 模拟合约与前端版本天然一致
    connect, disconnect, switchAccount,
    refreshRole, registerRole, getRole, fetchAllEvents,
    // 模式标识（App 侧显示 / SettingsModal 区分展示用）
    isSim: true,
  };
}
