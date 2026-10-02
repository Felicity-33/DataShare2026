// ============================================================
// useWeb3.js —— 钱包连接 + 合约实例化 + 链上事件监听 Hook
// ------------------------------------------------------------
// 职责：
//   1. 使用 Ethers.js v6 的 BrowserProvider 连接 MetaMask 小狐狸
//   2. 自动切换 / 添加 Ganache 网络（ChainID 1337）
//   3. 处理：用户拒绝连接、账户切换、网络切换等异常
//   4. 实例化 DataShare 合约（读写模式）
//   5. 链上事件监听：收益到账 / 授权申请 / 审批结果 / 裁决申诉与结果（v4.5）
//   6. 角色自助注册（用户 / 企业 / 监管）
// ============================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import { DataShareABI, CONTRACT_ADDRESS, GANACHE_CHAIN_ID, GANACHE_RPC_URL, EXPECTED_CONTRACT_VERSION, emitGlobalError } from '../config.js';

/**
 * 全局 Web3 Hook
 * @param {Object} callbacks 事件回调
 *   - onRevenue:    用户端收益到账时触发（绿色 Toast）
 *   - onAuthRequest:用户端收到新的授权申请时触发
 *   - onAuthResult: 企业端收到审批结果时触发
 *   - onDisputeRaised: 企业对托管单发起申诉时触发（仅企业本人收到）
 *   - onDisputeResolved: 监管裁决落链时触发（按托管单归属分发给用户/企业）
 */
export function useWeb3({ onRevenue, onAuthRequest, onAuthResult, onDisputeRaised, onDisputeResolved } = {}) {
  const [provider, setProvider] = useState(null);   // BrowserProvider 实例
  const [signer, setSigner] = useState(null);       // 签名者
  const [contract, setContract] = useState(null);   // 合约实例
  const [account, setAccount] = useState(null);     // 当前钱包地址
  const [role, setRole] = useState('none');         // 链上角色
  const [networkOk, setNetworkOk] = useState(false); // 是否处于 Ganache 网络
  const [connecting, setConnecting] = useState(false); // 连接中
  const [connected, setConnected] = useState(false);   // 是否已连接
  const [eventsVersion, setEventsVersion] = useState(0); // 链上事件版本号（任何事件触发 +1）
  // ★ 合约版本校验：链上 CONTRACT_VERSION 与前端期望值不一致时置 false，
  //   避免「链上合约与本地 ABI 不匹配导致返回值被静默错解」这类隐蔽故障
  const [contractVersion, setContractVersion] = useState('');
  const [versionOk, setVersionOk] = useState(true);

  // 用 ref 保存最新回调，避免监听器闭包过期
  const cbRef = useRef({ onRevenue, onAuthRequest, onAuthResult, onDisputeRaised, onDisputeResolved });
  cbRef.current = { onRevenue, onAuthRequest, onAuthResult, onDisputeRaised, onDisputeResolved };
  // 记录是否已连接，供 chainChanged 事件判断
  const connectedRef = useRef(false);
  connectedRef.current = connected;

  // 查询某地址的链上角色
  const getRole = useCallback(async (addr, c) => {
    if (!c || !addr) return 'none';
    try {
      return await c.roleOf(addr);
    } catch {
      return 'none';
    }
  }, []);

  // 确保 MetaMask 已切换到 Ganache 网络（自动切换/添加 + 合约可达性校验）
  const ensureGanache = useCallback(async () => {
    if (!window.ethereum) throw new Error('未检测到 MetaMask，请先安装并开启小狐狸插件');
    // 尝试切换到 Ganache（chainId 0x539 = 1337）
    const trySwitch = () => window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x539' }]
    });
    // 添加本项目的 Ganache 网络定义（RPC 127.0.0.1:7545）
    const tryAdd = () => window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: '0x539',
        chainName: 'Ganache 本地测试网',
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: [GANACHE_RPC_URL]
      }]
    });
    try {
      await trySwitch();
    } catch (err) {
      // 4902：目标网络尚未添加，则先添加再切换
      if (err && err.code === 4902) {
        await tryAdd();
        await trySwitch();
      } else if (err && err.code === 4001) {
        throw new Error('您拒绝了网络切换请求，请在 MetaMask 中手动切到「Ganache 本地测试网」后重试');
      } else {
        throw err;
      }
    }
    // ★ 关键校验（真实踩坑）：ChainID 相同 ≠ 网络正确 ——
    //   MetaMask 自带「Localhost 8545」与本项目 Ganache(7545) 的 ChainID 都是 1337，
    //   上面的 switch 会因「已在 0x539」被静默跳过，钱包实际仍挂在连不上链的 8545 上，
    //   后续所有读写全部失败，表现为连接卡死 / 数据全空。
    //   这里用钱包当前网络试读链上合约，读不到就给出可操作的中文指引，
    //   绝不让用户静默进入一个坏掉的工作台。
    try {
      const probe = new ethers.Contract(
        CONTRACT_ADDRESS,
        ['function CONTRACT_VERSION() view returns (string)'],
        new ethers.BrowserProvider(window.ethereum)
      );
      await probe.CONTRACT_VERSION();
    } catch {
      throw new Error(
        '钱包当前网络读不到链上合约。两种可能：' +
        '① 钱包挂在 ChainID 同为 1337 但 RPC 不是 http://127.0.0.1:7545 的网络（如 MetaMask 自带的 Localhost 8545），' +
        '请在 MetaMask 网络列表手动切换到「Ganache 本地测试网」后重新连接；' +
        '② Ganache 被重置导致合约不存在，请重新执行 npm run deploy 并更新 frontend/src/config.js 的合约地址。'
      );
    }
  }, []);

  // 初始化：创建 provider / signer / contract，并读取角色与网络状态
  const init = useCallback(async () => {
    const prov = new ethers.BrowserProvider(window.ethereum); // Ethers v6 语法（替代 v5 Web3Provider）
    prov.pollingInterval = 1500;                              // 加快事件轮询，演示更灵敏
    const s = await prov.getSigner();
    const addr = await s.getAddress();
    const c = new ethers.Contract(CONTRACT_ADDRESS, DataShareABI, s);
    const net = await prov.getNetwork();
    const ok = net.chainId === BigInt(GANACHE_CHAIN_ID);

    setProvider(prov);
    setSigner(s);
    setContract(c);
    setAccount(addr);
    setNetworkOk(ok);

    // ★ 合约版本校验：读链上 CONTRACT_VERSION 与本地期望值比对
    let onChainVer = '';
    try {
      onChainVer = await c.CONTRACT_VERSION();
    } catch {
      onChainVer = '未知（旧版合约）';
    }
    setContractVersion(onChainVer);
    setVersionOk(onChainVer === EXPECTED_CONTRACT_VERSION);

    setRole(await getRole(addr, c));
    setConnected(true);
    return { account: addr };
  }, [getRole]);

  // 连接 MetaMask 钱包
  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      if (!window.ethereum) throw new Error('未检测到 MetaMask，请先安装小狐狸插件后刷新页面');
      // 1. 确保切换到 Ganache 网络
      await ensureGanache();
      // 2. 请求连接账户
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      // 3. 初始化 provider / 合约
      await init();
    } catch (err) {
      // 用户拒绝连接（MetaMask 错误码 4001）
      if (err && err.code === 4001) {
        throw new Error('您拒绝了连接请求，请点击"连接钱包"后再次确认');
      }
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [ensureGanache, init]);

  // 刷新当前账户角色（角色自助注册后调用）
  const refreshRole = useCallback(async () => {
    if (!contract || !account) return;
    setRole(await getRole(account, contract));
  }, [contract, account, getRole]);

  // 角色自助注册：注册后自动刷新角色
  const registerRole = useCallback(async (kind) => {
    if (!contract) throw new Error('请先连接钱包');
    const fn = kind === 'user' ? 'registerAsUser'
      : kind === 'enterprise' ? 'registerAsEnterprise'
      : 'registerAsRegulator';
    const tx = await contract[fn]();
    await tx.wait();
    await refreshRole();
    return role; // 返回旧角色，调用方再读取新角色
  }, [contract, refreshRole]);

  // 拉取全部链上事件并归一化为结构化数据（供各端图表 / 统计聚合）
  // 事件：分账 / 充值 / 字段上链 / 授权 / 撤销 / 非法拦截 / 授权申请 / 审批通过 / 审批拒绝
  const fetchAllEvents = useCallback(async () => {
    const empty = {
      revenues: [], deposits: [], fields: [], grants: [], revokes: [],
      blocked: [], authReqs: [], authApps: [], authDenies: []
    };
    if (!contract || !provider) return empty;
    try {
      // 本地 Ganache 区块较少，从 0 号区块拉到最新即可
      const [rev, dep, fld, gran, revo, blk, req, app, deny] = await Promise.all([
        contract.queryFilter('RevenueDistributed', 0, 'latest'),
        contract.queryFilter('DepositMade', 0, 'latest'),
        contract.queryFilter('FieldRegistered', 0, 'latest'),
        contract.queryFilter('PermissionGranted', 0, 'latest'),
        contract.queryFilter('PermissionRevoked', 0, 'latest'),
        contract.queryFilter('AccessAttemptBlocked', 0, 'latest'),
        contract.queryFilter('AuthorizationRequested', 0, 'latest'),
        contract.queryFilter('AuthorizationApproved', 0, 'latest'),
        contract.queryFilter('AuthorizationDenied', 0, 'latest')
      ]);
      // 区块时间戳缓存，避免对同一区块重复请求
      const tsCache = {};
      const getTs = async (bn) => {
        if (!tsCache[bn]) tsCache[bn] = (await provider.getBlock(bn)).timestamp;
        return tsCache[bn];
      };
      // 归一化：每条记录统一携带 ts / txHash / blockNumber 等公共字段
      const base = (ev, ts, extra) => ({ ts, txHash: ev.transactionHash, blockNumber: ev.blockNumber, ...extra });
      const mapAll = (evs, mapFn) => Promise.all(evs.map(async (ev) => mapFn(ev, await getTs(ev.blockNumber))));
      return {
        revenues: await mapAll(rev, (ev, ts) => base(ev, ts, {
          fieldId: Number(ev.args.fieldId), user: ev.args.user, enterprise: ev.args.enterprise, amount: ev.args.amount.toString()
        })),
        deposits: await mapAll(dep, (ev, ts) => base(ev, ts, {
          enterprise: ev.args.enterprise, amount: ev.args.amount.toString(), balance: ev.args.balance.toString()
        })),
        fields: await mapAll(fld, (ev, ts) => base(ev, ts, {
          fieldId: Number(ev.args.fieldId), owner: ev.args.owner, name: ev.args.name
        })),
        grants: await mapAll(gran, (ev, ts) => base(ev, ts, {
          fieldId: Number(ev.args.fieldId), user: ev.args.user, enterprise: ev.args.enterprise
        })),
        revokes: await mapAll(revo, (ev, ts) => base(ev, ts, {
          fieldId: Number(ev.args.fieldId), user: ev.args.user, enterprise: ev.args.enterprise
        })),
        blocked: await mapAll(blk, (ev, ts) => base(ev, ts, {
          fieldId: Number(ev.args.fieldId), enterprise: ev.args.enterprise, reason: ev.args.reason
        })),
        authReqs: await mapAll(req, (ev, ts) => base(ev, ts, {
          requestId: Number(ev.args.requestId), fieldId: Number(ev.args.fieldId), user: ev.args.user, enterprise: ev.args.enterprise, price: ev.args.price.toString()
        })),
        authApps: await mapAll(app, (ev, ts) => base(ev, ts, {
          requestId: Number(ev.args.requestId), fieldId: Number(ev.args.fieldId), user: ev.args.user, enterprise: ev.args.enterprise, price: ev.args.price.toString()
        })),
        authDenies: await mapAll(deny, (ev, ts) => base(ev, ts, {
          requestId: Number(ev.args.requestId), fieldId: Number(ev.args.fieldId), user: ev.args.user, enterprise: ev.args.enterprise, price: ev.args.price.toString()
        }))
      };
    } catch (e) {
      console.error('拉取链上事件失败', e);
      // ★ 静默失败会让用户误以为"数据没上链"——同步失败必须进入全局异常通道给出排查指引
      emitGlobalError('链上数据同步失败：请确认 Ganache 正在 7545 端口运行，且 MetaMask 网络指向 7545（ChainID 1337），然后刷新页面');
      return empty;
    }
  }, [contract, provider]);

  // 切换 MetaMask 账号：先撤销 DApp 授权，再重新发起请求以强制弹出账号选择框
  // （成功后整页刷新，保证角色 / 合约状态与新账号完全一致）
  const switchAccount = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
    } catch (e) {
      console.warn('撤销钱包授权失败', e);
    }
    try {
      await window.ethereum.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
      window.location.reload();
    } catch (e) {
      console.error('切换账号失败', e);
    }
  }, []);

  // 断开连接：清理状态
  const disconnect = useCallback(() => {
    setProvider(null);
    setSigner(null);
    setContract(null);
    setAccount(null);
    setRole('none');
    setNetworkOk(false);
    setConnected(false);
  }, []);

  // 监听 MetaMask 账户切换 / 网络切换
  useEffect(() => {
    if (!window.ethereum) return;
    // 账户切换：重新初始化（角色会随之变化）
    const onAccountsChanged = async (accounts) => {
      if (!accounts || accounts.length === 0) {
        disconnect();
        return;
      }
      try { await init(); } catch { /* 忽略异常 */ }
    };
    // 网络切换：仅在已连接时刷新状态，避免首次连接时的刷新竞态
    const onChainChanged = async () => {
      if (connectedRef.current) {
        try { await init(); } catch { /* 忽略异常 */ }
      }
    };
    window.ethereum.on('accountsChanged', onAccountsChanged);
    window.ethereum.on('chainChanged', onChainChanged);
    return () => {
      window.ethereum.removeListener('accountsChanged', onAccountsChanged);
      window.ethereum.removeListener('chainChanged', onChainChanged);
    };
  }, [init, disconnect]);

  // 链上事件监听：收益到账 / 授权申请 / 审批结果
  useEffect(() => {
    if (!contract || !account) return;
    const me = account.toLowerCase();

    // 收益到账：分账给当前用户的收益触发（绿色 Toast）
    const onRevenue = (fieldId, user, enterprise, amount) => {
      if (user.toLowerCase() === me) {
        cbRef.current.onRevenue?.({ fieldId: Number(fieldId), enterprise, amount: amount.toString() });
      }
    };
    // 授权申请：发给当前用户的申请触发（通知铃铛）
    const onAuthRequest = (requestId, fieldId, user, enterprise, price) => {
      if (user.toLowerCase() === me) {
        cbRef.current.onAuthRequest?.({ requestId: Number(requestId), fieldId: Number(fieldId), enterprise, price: price.toString() });
      }
    };
    // 审批结果：当前企业发起的申请被处理时触发
    const onAuthApproved = (requestId, fieldId, user, enterprise, price) => {
      if (enterprise.toLowerCase() === me) {
        cbRef.current.onAuthResult?.({ requestId: Number(requestId), approved: true });
      }
    };
    const onAuthDenied = (requestId, fieldId, user, enterprise, price) => {
      if (enterprise.toLowerCase() === me) {
        cbRef.current.onAuthResult?.({ requestId: Number(requestId), approved: false });
      }
    };
    // ★ 裁决事件（v4.5）：申诉提交 —— 事件参数带 enterprise，可直接过滤出发起申诉的企业本人
    const onDisputeRaisedEv = (escrowId, enterprise, fieldId, reason) => {
      if (enterprise.toLowerCase() === me) {
        cbRef.current.onDisputeRaised?.({ escrowId: Number(escrowId), fieldId: Number(fieldId), reason });
      }
    };
    // ★ 裁决事件（v4.5）：裁决结果 —— 事件参数不带 user/enterprise，
    //   需回读托管单归属后再按参与者分发（用户：放款到账；企业：退款/驳回结果）
    const onDisputeResolvedEv = async (escrowId, refundedToEnterprise, regulator, amount) => {
      try {
        const e = await contract.escrows(Number(escrowId));
        const isUser = (e.user || '').toLowerCase() === me;
        const isEnt = (e.enterprise || '').toLowerCase() === me;
        if (isUser || isEnt) {
          cbRef.current.onDisputeResolved?.({
            escrowId: Number(escrowId),
            refunded: refundedToEnterprise,
            amount: amount.toString(),
            myRole: isUser ? 'user' : 'enterprise',
          });
        }
      } catch { /* 托管单回读失败时忽略，各工作台数据同步兜底 */ }
    };

    contract.on('RevenueDistributed', onRevenue);
    contract.on('AuthorizationRequested', onAuthRequest);
    contract.on('AuthorizationApproved', onAuthApproved);
    contract.on('AuthorizationDenied', onAuthDenied);
    contract.on('DisputeRaised', onDisputeRaisedEv);
    contract.on('DisputeResolved', onDisputeResolvedEv);

    return () => {
      contract.off('RevenueDistributed', onRevenue);
      contract.off('AuthorizationRequested', onAuthRequest);
      contract.off('AuthorizationApproved', onAuthApproved);
      contract.off('AuthorizationDenied', onAuthDenied);
      contract.off('DisputeRaised', onDisputeRaisedEv);
      contract.off('DisputeResolved', onDisputeResolvedEv);
    };
  }, [contract, account]);

  // 链上事件自动刷新机制：监听全部 DataShare 事件，任何事件触发都令 eventsVersion +1，
  // 各工作台的 useEffect 依赖 eventsVersion，从而在数据变化后自动重新拉取图表数据（无需手动刷新）
  useEffect(() => {
    if (!contract) return;
    const names = ['RevenueDistributed', 'DepositMade', 'FieldRegistered', 'PermissionGranted',
      'PermissionRevoked', 'AccessAttemptBlocked', 'AuthorizationRequested', 'AuthorizationApproved', 'AuthorizationDenied',
      // ★ 托管结算闭环新增事件：托管创建 / 提前结算 / 争议 / 裁决 / 提现 / 失信
      'EscrowCreated', 'DeliveryConfirmed', 'DisputeRaised', 'DisputeResolved', 'RevenueWithdrawn',
      'EnterpriseFlagged'];
    const bump = () => setEventsVersion((v) => v + 1);
    names.forEach((n) => contract.on(n, bump));
    return () => names.forEach((n) => contract.off(n, bump));
  }, [contract]);

  return {
    provider, signer, contract, account, role,
    connected, connecting, networkOk, eventsVersion,
    contractVersion, versionOk,
    connect, disconnect, switchAccount, refreshRole, registerRole, getRole, fetchAllEvents
  };
}

// ============================================================
// 链上实时状态 Hook：轮询最新区块高度
// ------------------------------------------------------------
// 用于在界面上体现「区块链正在出块」这一动态特性：
// 首页 / 顶栏 / 侧边栏均可展示实时区块高度，区块变化时轻微高亮。
// Ganache 默认即时出块，交易后高度会立即跳动。
// ============================================================
export function useBlockNumber(provider, intervalMs = 3000) {
  const [blockNumber, setBlockNumber] = useState(null);

  useEffect(() => {
    if (!provider) { setBlockNumber(null); return; }
    let alive = true;
    const tick = async () => {
      try {
        const n = await provider.getBlockNumber();
        if (alive) setBlockNumber(n);
      } catch { /* 网络抖动忽略 */ }
    };
    tick();
    const t = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [provider, intervalMs]);

  return blockNumber;
}

// ★ 链上时间基准（useChainNow）
// ------------------------------------------------------------
// 背景（实测踩坑，务必记住）：
//   合约判定时间条件（如托管挑战期是否结束）用的是 block.timestamp，
//   而 Ganache 在空闲时不出块 →「最新区块时间戳」会冻结在原地（实测落后真实时间 20+ 分钟）。
//   于是同一笔托管单会出现：
//        本地时钟     -> 已过解锁时间（可提现）
//        最新区块时间戳 -> 还未到（不可提现）
//   若前端用最新区块时间戳当倒计时基准，按钮会被永久锁住；
//   但若只信本地时钟，一旦本机时钟偏慢又会过早放行、导致交易 revert。
//
// 因此取「本地时间」与「最新区块时间戳」的**较大值**：
//   - 链上时间领先（本机时钟偏慢）→ 以链上为准，绝不过早放行；
//   - 链上时间落后（Ganache 空闲不出块）→ 以本地为准，因为下一笔交易出块时
//     Ganache 使用的是真实系统时间，本地时间才是「即将被打包的那个时间戳」。
// 这样倒计时归零的时刻，与交易真正被打包时的判定时刻一致。
export function useChainNow(provider, blockNumber, intervalMs = 1000) {
  const [viaChain, setViaChain] = useState(0);              // 最新区块时间戳
  const [viaLocal, setViaLocal] = useState(Math.floor(Date.now() / 1000)); // 本地时钟

  useEffect(() => {
    if (!provider) { setViaChain(0); return; }
    let alive = true;
    (async () => {
      try {
        const b = await provider.getBlock('latest');
        if (alive && b) setViaChain(Number(b.timestamp));
      } catch { /* 网络抖动忽略 */ }
    })();
    return () => { alive = false; };
  }, [provider, blockNumber]);

  useEffect(() => {
    const t = setInterval(() => setViaLocal(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);

  return viaChain > viaLocal ? viaChain : viaLocal;
}

// ============================================================
// 以下为图表聚合工具函数（供三个工作台图表共用，追加实现，不改动上方已有代码）
// ------------------------------------------------------------
// 说明：
//   - fetchAllEvents(contract)：模块级独立函数，一次性拉取 5 类相关链上事件，
//     返回原始 Log 数组；与 hook 内部同名 fetchAllEvents（返回归一化数据）
//     是两套实现，互不影响。
//   - buildAllCharts(contract, account)：一次拉取并聚合出三个端共用的图表数据。
//     修复“图表全为 0”的根因：查表统一使用完整日期键（YYYY-MM-DD），
//     横轴展示使用 label（MM-DD），不再出现键不匹配。
// ============================================================

// 拉取全部相关链上事件（分账 / 充值 / 字段上链 / 授权 / 拦截，返回原始 Log）
export async function fetchAllEvents(contract) {
  const provider = contract.runner.provider;
  const latest = await provider.getBlockNumber();
  const [revenue, deposit, fieldReg, permGranted, blocked] = await Promise.all([
    contract.queryFilter('RevenueDistributed', 0, latest),
    contract.queryFilter('DepositMade', 0, latest),
    contract.queryFilter('FieldRegistered', 0, latest),
    contract.queryFilter('PermissionGranted', 0, latest),
    contract.queryFilter('AccessAttemptBlocked', 0, latest),
  ]);
  return { revenue, deposit, fieldReg, permGranted, blocked };
}

// 区块号 -> 时间戳（带缓存，避免对同一区块重复请求）
const blockTimeCache = {};
export async function getBlockTime(provider, blockNumber) {
  if (blockTimeCache[blockNumber] !== undefined) return blockTimeCache[blockNumber];
  const block = await provider.getBlock(blockNumber);
  blockTimeCache[blockNumber] = block.timestamp;
  return block.timestamp;
}

// 生成最近 7 天的日期数组（key 为完整日期 YYYY-MM-DD 用于查表，label 为 MM-DD 用于横轴）
export function last7Days() {
  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ key, label: key.slice(5) });
  }
  return days;
}

// 时间戳 -> YYYY-MM-DD（与 last7Days 的 key 保持一致，用于按天聚合查表）
export function dayKeyFromTs(ts) {
  const d = new Date(Number(ts) * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 全局图表数据聚合：一次拉取，返回三个端都能用的数据
export async function buildAllCharts(contract, account) {
  const provider = contract.runner.provider;
  const events = await fetchAllEvents(contract);
  const days = last7Days();
  const me = (account || '').toLowerCase();

  // 缓存所有事件的区块时间（按区块号去重，避免重复 RPC 请求）
  const allEvents = [...events.revenue, ...events.deposit, ...events.fieldReg, ...events.permGranted, ...events.blocked];
  const tsMap = {};
  for (const e of allEvents) {
    if (tsMap[e.blockNumber] === undefined) {
      tsMap[e.blockNumber] = await getBlockTime(provider, e.blockNumber);
    }
  }

  // 1. 用户端折线图：按天聚合属于当前用户的分账金额（单位 ETH）
  const userDaily = {};
  for (const e of events.revenue) {
    if (e.args.user.toLowerCase() !== me) continue;
    const k = dayKeyFromTs(tsMap[e.blockNumber]);
    userDaily[k] = (userDaily[k] || 0) + Number(ethers.formatEther(e.args.amount));
  }
  const userRevenueData = days.map(({ key, label }) => ({ date: label, 收益: userDaily[key] || 0 }));

  // 2. 用户端饼图：按字段名聚合当前用户各字段被调用次数
  const fieldCounter = {};
  for (const e of events.revenue) {
    if (e.args.user.toLowerCase() !== me) continue;
    const fid = e.args.fieldId.toString();
    const f = await contract.fields(fid); // 从链上读取字段名
    fieldCounter[f.name] = (fieldCounter[f.name] || 0) + 1;
  }
  const userPieData = Object.entries(fieldCounter).map(([name, value]) => ({ name, value }));

  // 3. 企业端柱状图：按天聚合属于当前企业的充值（DepositMade）与消耗（RevenueDistributed）
  const entDaily = {};
  for (const e of events.deposit) {
    if (e.args.enterprise.toLowerCase() !== me) continue;
    const k = dayKeyFromTs(tsMap[e.blockNumber]);
    entDaily[k] = entDaily[k] || { 充值: 0, 消耗: 0 };
    entDaily[k].充值 += Number(ethers.formatEther(e.args.amount));
  }
  for (const e of events.revenue) {
    if (e.args.enterprise.toLowerCase() !== me) continue;
    const k = dayKeyFromTs(tsMap[e.blockNumber]);
    entDaily[k] = entDaily[k] || { 充值: 0, 消耗: 0 };
    entDaily[k].消耗 += Number(ethers.formatEther(e.args.amount));
  }
  const enterpriseChart = days.map(({ key, label }) => ({
    date: label,
    充值: entDaily[key]?.充值 || 0,
    消耗: entDaily[key]?.消耗 || 0,
  }));

  // 4. 监管端面积图：全网所有相关事件按天计数（分账 + 充值 + 字段上链 + 授权 + 拦截）
  const allDaily = {};
  for (const e of allEvents) {
    const k = dayKeyFromTs(tsMap[e.blockNumber]);
    allDaily[k] = (allDaily[k] || 0) + 1;
  }
  const regulatorChart = days.map(({ key, label }) => ({ date: label, 交易量: allDaily[key] || 0 }));

  return { userRevenueData, userPieData, enterpriseChart, regulatorChart };
}

// 链上事件监听 Hook：任一相关事件触发时回调（供各工作台图表延迟刷新）
// 使用 ref 保存最新回调，避免回调变化导致重复订阅 / 解除订阅
export function useChainEvents(contract, onEvent) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    if (!contract) return;
    const names = ['RevenueDistributed', 'DepositMade', 'FieldRegistered', 'PermissionGranted',
      'PermissionRevoked', 'AccessAttemptBlocked', 'AuthorizationRequested', 'AuthorizationApproved', 'AuthorizationDenied',
      // ★ 托管结算闭环新增事件
      'EscrowCreated', 'DeliveryConfirmed', 'DisputeRaised', 'DisputeResolved', 'RevenueWithdrawn',
      'EnterpriseFlagged'];
    const handler = () => cb.current();
    names.forEach((n) => contract.on(n, handler));
    return () => names.forEach((n) => contract.off(n, handler));
  }, [contract]);
}
