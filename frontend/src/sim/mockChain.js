// ============================================================
// mockChain.js —— 浏览器内模拟链（评估者免钱包的核心）
// ------------------------------------------------------------
// 设计定位：
//   与 contracts/DataShare.sol v4.4 逐函数对齐的「JS 版合约」，
//   对上层（各工作台 / ProofDrawer / SettingsModal）暴露与
//   ethers.Contract 完全同形的调用面，因此三个工作台零改动即可
//   在模拟链上运行：
//     1. view 方法返回「位置 + 命名」双访问结构（对齐 ethers Result）
//     2. 数值统一 BigInt（wei），与真实链一致，避免 0.05 ETH 超出
//        Number 安全整数导致精度丢失
//     3. 写方法返回 { wait: async () => receipt }，receipt 带
//        blockNumber / hash（confirmTx 直接消费）
//     4. queryFilter(name | filters.Xxx(...), from?, to?) + on/off
//        事件设施，filters 支持 null 通配的位置过滤（ProofDrawer 在用）
//     5. 写方法上挂 staticCall（企业端 callData 预演在用）
//   拦截留痕（AccessAttemptBlocked）、信誉扣减、平台 10% 分账、
//   600 秒争议窗口等合约机制在模拟层全部复现 —— 这是模拟模式相对
//   「前端假数据」的核心优势：业务规则不是画出来的，是真的。
// 持久化：localStorage（key 见 STORE_KEY），BigInt 以 {"__bi":"…"} 标记
//   序列化，刷新页面后演示数据仍在；「重置演示数据」清库重新播种。
// ============================================================
import { DEMO_ENTERPRISE_ADDRESS, buildDeliveryHash, loadAllData } from '../config.js';
import { commitmentOf } from '../zk.js';
import { clearNotifications } from '../notifications.js';
import { buildSeedState } from './seed.js';

// ---------------- 模拟合约与演示身份地址（固定值，保证多端一致） ----------------
// 模拟合约地址：仅供界面展示（ProofDrawer 读取 contract.target），非真实部署
export const SIM_CONTRACT_ADDRESS = '0x7dC6f40A3b1925e08F61b3C9a2D47e580Bc93a11';
// 演示用户身份
export const SIM_USER_ADDRESS = '0x8E2Ba5c9F31D4B7a06cE93f15A802b47d1Cc6f30';
// 演示企业身份：直接复用本地演示企业地址 —— 用户工作台的「企业地址」
// 输入框默认值即该地址（config.DEMO_ENTERPRISE_ADDRESS），天然对齐
export const SIM_ENTERPRISE_ADDRESS = DEMO_ENTERPRISE_ADDRESS;
// 演示监管身份
export const SIM_REGULATOR_ADDRESS = '0x41C7dF0a29B6E8351cA0b942D8f57e36A90b4d17';
// 演示平台服务费收款地址：对齐真实合约 platformTreasury（部署时指定，独立于业务地址）。
// 分账事件 PlatformRevenuePaid 的平台参数即此地址，与链上口径一致（不再是零地址 / 合约地址）
export const SIM_PLATFORM_TREASURY = '0x5B3f8a1C9d07E4b26Fa1c0839d2E7B45aC6f0912';
// 三个演示身份的展示名（账号菜单 / 设置面板使用）
export const SIM_IDENTITY_LABELS = {
  [SIM_USER_ADDRESS]: '演示用户 · 数据所有者',
  [SIM_ENTERPRISE_ADDRESS]: '演示企业 · 数据需求方',
  [SIM_REGULATOR_ADDRESS]: '演示监管 · 合规审计',
};
// 演示身份轮换顺序（switchAccount 按此循环）
export const SIM_IDENTITY_ORDER = [SIM_USER_ADDRESS, SIM_ENTERPRISE_ADDRESS, SIM_REGULATOR_ADDRESS];

// ---------------- 合约常量（与 DataShare.sol v4.4 完全一致） ----------------
export const SIM_CHAIN_ID = 6001;                       // 模拟链标识（仅展示用，不参与钱包交互）
export const SIM_CONTRACT_VERSION = '4.4';              // 与前端 EXPECTED_CONTRACT_VERSION 对齐
const CHALLENGE_PERIOD = 600n;                          // 争议窗口（秒）
const STANDARD_PRICE_PER_CALL = 50000000000000000n;     // 0.05 ETH（按次）
const STANDARD_PRICE_PER_DAY = 500000000000000000n;     // 0.5 ETH（按天）
const PLATFORM_FEE_BPS = 1000n;                         // 平台服务费 10%
const BPS_DENOMINATOR = 10000n;
const BASE_REPUTATION = 600n;                           // 信誉基线
const MIN_REPUTATION = 300n;                            // 信誉下限
const MAX_REPUTATION = 1000n;                           // 信誉上限

// ---------------- 事件签名表（位置顺序 = 合约事件定义顺序） ----------------
// on(name, cb) 触发时按此顺序展开位置参数（useWeb3 同款回调签名）；
// ev.args 同时提供命名访问（工作台/归一化逻辑在用）。
const EVENT_ABI = {
  FieldRegistered: ['fieldId', 'owner', 'name'],
  FieldVerified: ['fieldId', 'owner', 'commitment'],
  PermissionGranted: ['fieldId', 'user', 'enterprise', 'expiry', 'maxCalls'],
  PermissionRevoked: ['fieldId', 'user', 'enterprise'],
  DepositMade: ['enterprise', 'amount', 'balance'],
  RevenueDistributed: ['fieldId', 'user', 'enterprise', 'amount'],
  AccessAttemptBlocked: ['enterprise', 'fieldId', 'reason'],
  AuthorizationRequested: ['requestId', 'fieldId', 'user', 'enterprise', 'periodType', 'units', 'unitPrice', 'totalPrice'],
  AuthorizationApproved: ['requestId', 'fieldId', 'user', 'enterprise', 'periodType', 'units', 'unitPrice', 'totalPrice'],
  AuthorizationDenied: ['requestId', 'fieldId', 'user', 'enterprise', 'periodType', 'units', 'unitPrice', 'totalPrice'],
  EscrowCreated: ['escrowId', 'fieldId', 'user', 'enterprise', 'amount', 'deliveryHash', 'releaseAt'],
  DeliveryConfirmed: ['escrowId', 'enterprise', 'fieldId', 'deliveryHash'],
  DisputeRaised: ['escrowId', 'enterprise', 'fieldId', 'reason'],
  DisputeResolved: ['escrowId', 'refundedToEnterprise', 'regulator', 'amount'],
  RevenueWithdrawn: ['escrowId', 'user', 'amount'],
  EnterpriseFlagged: ['enterprise', 'flagged', 'reason'],
  OrderCancelled: ['escrowId', 'enterprise', 'amount'],
  PlatformRevenuePaid: ['escrowId', 'platform', 'amount'],
};

// ---------------- 持久化工具：BigInt 标记序列化 ----------------
// 演示链持久化 key（v5）：结构或播种数据有实质修正时递增 —— v1 旧数据缺新键（事件 ts /
// blocks / txs 等），新代码读取会抛错并弹出「数据同步失败」横幅；v3 作废的是
// 「占位交付凭证 + 区块号与时间不同序」的旧种子数据；v4 作废的是
// 「占位 commitment + 零地址平台分账」的旧种子数据（已按链上口径修复）；
// v5 作废的是「与当前链不对应的残留铃铛通知」——重播种时同步清空演示身份通知存档
// （见 ensureChain），否则旧通知会与新一轮播种的通知并存、且永不消失
const STORE_KEY = 'ds_sim_chain_v5';
const _big = (v) => ({ __bi: v.toString() });
const _repl = (_k, v) => (typeof v === 'bigint' ? _big(v) : v);
const _rev = (_k, v) => (v && typeof v === 'object' && v.__bi ? BigInt(v.__bi) : v);

const nowSec = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 随机 32 字节交易哈希 / 摘要（演示用）
const randHash = () => '0x' + Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

// 「位置 + 命名」双访问结构（对齐 ethers v6 的 Result：数组 + 命名属性）
function simStruct(values, names) {
  const arr = [...values];
  names.forEach((n, i) => { if (n) arr[n] = values[i]; });
  return arr;
}

// ---------------- 单例链状态 ----------------
// 新建一条空链（结构说明见各使用处；数组型容器与合约状态变量一一对应）
function freshState() {
  return {
    version: 5,               // 播种数据版本（结构 / 种子数据修正时递增触发重播种）
    blockNumber: 0,           // 当前块高
    blocks: {},               // blockNumber -> timestamp（秒）
    txs: {},                  // txHash -> { blockNumber }
    fields: [],               // DataField[]（含 id/owner/name/callCount/createdAt/commitment/dataRef）
    permissions: {},          // `${fieldId}:${addr}` -> {active,expiry,maxCalls,usedCalls}
    deposits: {},             // addr -> BigInt(wei)
    authRequests: [],         // AuthRequest[]
    escrows: [],              // Escrow[]
    blockedAttempts: [],      // BlockedAttempt[]
    roles: {},                // addr -> 'user'|'enterprise'|'regulator'
    successCalls: {},         // addr -> n（成功调用）
    blockedCount: {},         // addr -> n（被拦截）
    disputesLost: {},         // addr -> n（恶意申诉败诉）
    flagged: {},              // addr -> bool
    flagReason: {},           // addr -> string
    totalDistributed: 0n,
    totalWithdrawn: 0n,
    totalRefunded: 0n,
    totalAuthorizations: 0n,
    totalPlatformRevenue: 0n,
    events: [],               // {name, args(数组), blockNumber, transactionHash, ts}
  };
}

// 模块级单例（跨组件共享同一条链）
let chain = null;
// 当前「交易发起人」（msg.sender）——模拟模式下即当前演示身份
let actor = SIM_USER_ADDRESS;
// ★ staticCall 预演标志：预演期间不出块、不留事件通知、不持久化（配合全量快照回滚）。
//   若预演真实出块+发事件且回滚不完整，事件里会残留幽灵托管单，
//   工作台刷新即报「托管单不存在」→ 弹「数据同步失败」横幅
let simulating = false;
// 链变更订阅（useSimWeb3 的 eventsVersion 由此驱动）
const changeSubs = new Set();
// 事件监听（contract.on/off 的注册表）
const eventSubs = {};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw, _rev);
      // 版本 + 关键容器完整性双校验：结构残缺的数据一律重播种，
      // 保证流入运行时的数据字段完整
      const ok = parsed && parsed.version === 5
        && Array.isArray(parsed.fields) && Array.isArray(parsed.escrows)
        && Array.isArray(parsed.events) && Array.isArray(parsed.blockedAttempts)
        && parsed.permissions && parsed.deposits && parsed.roles
        && parsed.blocks && parsed.txs && parsed.successCalls && parsed.blockedCount;
      if (ok) return parsed;
    }
  } catch { /* 损坏则重播种 */ }
  return null;
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(chain, _repl)); } catch { /* 容量满等静默跳过 */ }
}

function notifyChange() {
  changeSubs.forEach((cb) => { try { cb(); } catch { /* 订阅方异常不扩散 */ } });
}

// 初始化单例（首次访问时加载 / 播种）
function ensureChain() {
  if (chain) return chain;
  const loaded = load();
  if (loaded) { chain = loaded; return chain; }
  // ★ 重新播种必须先清空铃铛通知存档（三个演示身份）：
  //   种子事件的时间戳以「当前时间」为基准（at(daysAgo)），每次重播种整体平移，
  //   而拦截留痕的通知 id 内嵌事件时间戳 —— 不清空则旧通知既不会消失、
  //   新一轮通知又与之并存，出现「链上 3 次拦截、铃铛 9 条」这种不同步现象。
  //   链上模式不存在重播种，故仅模拟端需要此对齐。
  chain = buildSeedState({ freshState, nowSec, randHash, commitmentOf, platformTreasury: SIM_PLATFORM_TREASURY });
  SIM_IDENTITY_ORDER.forEach((a) => { try { clearNotifications(a); } catch { /* 忽略 */ } });
  return chain;
}

// ---------------- 事件对象 / 交易回执 ----------------

// 构造 ethers 风格的事件日志对象：args 双访问 + getBlock + 区块号 / 交易哈希
function makeLog(ev, state) {
  const names = EVENT_ABI[ev.name] || [];
  return {
    blockNumber: ev.blockNumber,
    transactionHash: ev.transactionHash,
    ts: ev.ts,                                  // 归一化直接用（省一次 getBlock）
    args: simStruct(ev.args, names),
    getBlock: async () => ({
      number: ev.blockNumber,
      timestamp: state.blocks[ev.blockNumber] ?? ev.ts ?? Math.floor(Date.now() / 1000),
    }),
    removeListener: () => {},
  };
}

// 内部发事件：落账 + 通知 on 监听者（位置参数展开）+ 驱动 eventsVersion
function emit(name, argsObj) {
  const names = EVENT_ABI[name] || [];
  const ordered = names.map((n) => argsObj[n]);
  const ev = {
    name,
    args: ordered,
    blockNumber: chain.blockNumber,
    transactionHash: chain._lastTxHash,
    ts: chain.blocks[chain.blockNumber] ?? nowSec(),
  };
  chain.events.push(ev);
  // 预演期间不向监听者发通知（事件本体由外层快照回滚清除）
  if (simulating) return;
  const subs = eventSubs[name];
  if (subs) {
    const log = makeLog(ev, chain);
    subs.forEach((cb) => { try { cb(...ordered, log); } catch { /* 监听者异常不扩散 */ } });
  }
}

// 出块：块高 +1，记录时间戳，生成交易哈希（写操作的公共尾步骤）
function mineBlock() {
  chain.blockNumber += 1;
  chain.blocks[chain.blockNumber] = nowSec();
  const hash = randHash();
  chain.txs[hash] = { blockNumber: chain.blockNumber };
  chain._lastTxHash = hash;
  return hash;
}

// 构造「待打包交易」对象：模拟链在创建时即完成打包（内部已出块），
// wait() 只是补足 ethers 的异步形态并返回回执
function makeReceipt(hash) {
  return {
    hash,
    blockNumber: chain.txs[hash]?.blockNumber ?? chain.blockNumber,
    wait: async () => ({
      hash,
      blockNumber: chain.txs[hash]?.blockNumber ?? chain.blockNumber,
      status: 1,
      logs: [],
    }),
  };
}

// 写操作公共骨架：模拟出块延迟（让「交易确认中...」有真实节奏）→ 执行业务 → 持久化 → 通知
// 成功返回 { out, hash }：out 为业务返回值，hash 供挂载层组装 ethers 同形收据（tx.wait()）
// 预演模式（simulating=true）：同步执行业务、不出块、不持久化、不通知，状态由外层快照回滚
async function withTx(fn) {
  if (simulating) return { out: fn(-1), hash: null };
  await sleep(350 + Math.random() * 350);
  const hash = mineBlock();
  try {
    const out = fn(hash);
    save();
    notifyChange();
    return { out, hash };
  } catch (e) {
    save();          // callData 拦截留痕这类「部分写入」也要持久化
    notifyChange();
    throw e;
  }
}

// 抛出与真实合约 require 同文案的错误（parseTxError 优先读 err.reason）
function revert(msg) {
  const e = new Error(msg);
  e.reason = msg;
  throw e;
}

// ---------------- 信誉分（对齐合约 _score） ----------------
function scoreOf(addr) {
  if (chain.flagged[addr]) return 0n;
  let s = BASE_REPUTATION
    + BigInt(chain.successCalls[addr] || 0) * 8n
    - BigInt(chain.blockedCount[addr] || 0) * 60n
    - BigInt(chain.disputesLost[addr] || 0) * 150n;
  if (s < 0n) s = 0n;
  if (s > MAX_REPUTATION) s = MAX_REPUTATION;
  return s;
}

// ---------------- 授权读取 ----------------
function permOf(fieldId, addr) {
  return chain.permissions[`${fieldId}:${addr}`] || { active: false, expiry: 0, maxCalls: 0, usedCalls: 0 };
}

// ---------------- 模拟合约工厂 ----------------
// 返回与 ethers.Contract 同形调用面的对象（每页共享同一个单例）
export function createSimContract() {
  ensureChain();

  // --- 模拟 provider（useBlockNumber / useChainNow / 事件时间戳在用） ---
  const provider = {
    getBlockNumber: async () => ensureChain().blockNumber,
    getBlock: async (n) => {
      const st = ensureChain();
      const bn = n === 'latest' ? st.blockNumber : Number(n);
      return { number: bn, timestamp: st.blocks[bn] ?? nowSec() };
    },
    // 模拟链不出网：网络标识返回固定值（SettingsModal 显示用）
    getNetwork: async () => ({ chainId: BigInt(SIM_CHAIN_ID), name: 'sim-chain' }),
  };

  // --- 事件过滤条件（contract.filters.Xxx(a, b, null) 的返回值） ---
  const filters = {};
  Object.keys(EVENT_ABI).forEach((name) => {
    filters[name] = (...pos) => ({ __simFilter: { name, pos } });
  });

  // 位置过滤：null 通配；地址忽略大小写；数值/哈希按值比较
  function matchPos(args, pos) {
    if (!pos) return true;
    return pos.every((want, i) => {
      if (want === null || want === undefined) return true;
      const got = args[i];
      if (typeof want === 'string' && /^0x[0-9a-fA-F]{40}$/.test(want)) {
        return String(got).toLowerCase() === want.toLowerCase();
      }
      if (typeof want === 'boolean') return Boolean(got) === want;
      return String(got) === String(want);
    });
  }

  // --- 写方法（与 DataShare.sol 逐函数对齐） ---
  const writes = {
    // 角色注册（三端共用）
    async registerAsUser() { return withTx(() => { chain.roles[actor] = 'user'; }); },
    async registerAsEnterprise() { return withTx(() => { chain.roles[actor] = 'enterprise'; }); },
    async registerAsRegulator() { return withTx(() => { chain.roles[actor] = 'regulator'; }); },

    // 数据确权（模拟模式本地校验 name 与权属地址；snarkjs 证明由前端真实生成后传入）
    async registerField(name, dataRef, pA, pB, pC, pubSignals) {
      return withTx(() => {
        if (!name || !String(name).length) revert('字段名称不能为空');
        if (BigInt(pubSignals?.[1] ?? 0) !== BigInt(actor)) revert('证明中的权属地址与提交者不一致');
        const id = chain.fields.length;
        chain.fields.push({
          id, owner: actor, name: String(name), callCount: 0,
          createdAt: nowSec(), commitment: BigInt(pubSignals?.[0] ?? 0), dataRef: String(dataRef || ''),
        });
        emit('FieldRegistered', { fieldId: id, owner: actor, name: String(name) });
        emit('FieldVerified', { fieldId: id, owner: actor, commitment: BigInt(pubSignals?.[0] ?? 0) });
        return id;
      });
    },

    // 授权（带期限 / 次数）
    async grantPermissionWithLimit(fieldId, enterprise, expiry, maxCalls) {
      return withTx(() => {
        const f = chain.fields[Number(fieldId)];
        if (!f) revert('字段不存在');
        if (f.owner !== actor) revert('只能授权自己的数据');
        if (chain.roles[enterprise] !== 'enterprise') revert('对方不是企业角色');
        if (Number(expiry) !== 0 && Number(expiry) <= nowSec()) revert('有效期必须晚于当前时间');
        chain.permissions[`${Number(fieldId)}:${enterprise}`] = {
          active: true, expiry: Number(expiry), maxCalls: Number(maxCalls), usedCalls: 0,
        };
        chain.totalAuthorizations += 1n;
        emit('PermissionGranted', {
          fieldId: Number(fieldId), user: actor, enterprise,
          expiry: BigInt(expiry || 0), maxCalls: BigInt(maxCalls || 0),
        });
      });
    },

    // 授权（旧版兼容：永久不限次）
    async grantPermission(fieldId, enterprise) {
      return writes.grantPermissionWithLimit(fieldId, enterprise, 0, 0);
    },

    async revokePermission(fieldId, enterprise) {
      return withTx(() => {
        const f = chain.fields[Number(fieldId)];
        if (!f) revert('字段不存在');
        if (f.owner !== actor) revert('只能撤销自己的数据');
        chain.permissions[`${Number(fieldId)}:${enterprise}`] = { active: false, expiry: 0, maxCalls: 0, usedCalls: 0 };
        emit('PermissionRevoked', { fieldId: Number(fieldId), user: actor, enterprise });
      });
    },

    // 审批授权申请：同意（按周期生成带期限/次数的授权）
    async approveAuthorization(requestId) {
      return withTx(() => {
        const r = chain.authRequests[Number(requestId)];
        if (!r) revert('申请不存在');
        if (r.user !== actor) revert('只能审批自己的申请');
        if (r.resolved) revert('该申请已处理');
        r.resolved = true;
        let expiry = 0, maxCalls = 0;
        if (Number(r.periodType) === 0) maxCalls = Number(r.units);
        else expiry = nowSec() + Number(r.units) * 86400;
        chain.permissions[`${Number(r.fieldId)}:${r.enterprise}`] = { active: true, expiry, maxCalls, usedCalls: 0 };
        chain.totalAuthorizations += 1n;
        emit('AuthorizationApproved', { requestId: Number(requestId), ...r });
        emit('PermissionGranted', {
          fieldId: Number(r.fieldId), user: r.user, enterprise: r.enterprise,
          expiry: BigInt(expiry), maxCalls: BigInt(maxCalls),
        });
      });
    },

    // 审批授权申请：拒绝
    async denyAuthorization(requestId) {
      return withTx(() => {
        const r = chain.authRequests[Number(requestId)];
        if (!r) revert('申请不存在');
        if (r.user !== actor) revert('只能审批自己的申请');
        if (r.resolved) revert('该申请已处理');
        r.resolved = true;
        emit('AuthorizationDenied', { requestId: Number(requestId), ...r });
      });
    },

    // 押金充值（ethers 写法 contract.deposit({ value: X })）
    async deposit(overrides = {}) {
      return withTx(() => {
        if (chain.roles[actor] !== 'enterprise') revert('AccessControl: 账号缺少企业角色');
        const value = BigInt(overrides.value ?? 0);
        if (value <= 0n) revert('充值金额必须大于0');
        chain.deposits[actor] = (chain.deposits[actor] || 0n) + value;
        emit('DepositMade', { enterprise: actor, amount: value, balance: chain.deposits[actor] });
      });
    },

    // 发起授权申请（单价由「链上标准价」决定，企业不可传入）
    async requestAuthorization(fieldId, periodType, units) {
      return withTx(() => {
        // 合约 onlyRole(ENTERPRISE_ROLE)：非企业身份无法发起授权申请
        if (chain.roles[actor] !== 'enterprise') revert('AccessControl: 账号缺少企业角色');
        const f = chain.fields[Number(fieldId)];
        if (!f) revert('字段不存在');
        if (Number(periodType) !== 0 && Number(periodType) !== 1) revert('不支持的计费周期');
        if (Number(units) <= 0) revert('数量必须大于0');
        const unitPrice = Number(periodType) === 0 ? STANDARD_PRICE_PER_CALL : STANDARD_PRICE_PER_DAY;
        const totalPrice = unitPrice * BigInt(units);
        const id = chain.authRequests.length;
        const r = {
          requestId: id, fieldId: Number(fieldId), user: f.owner, enterprise: actor,
          periodType: Number(periodType), units: Number(units),
          unitPrice, totalPrice, resolved: false,
        };
        chain.authRequests.push(r);
        emit('AuthorizationRequested', { ...r });
        return id;
      });
    },

    // 调用前置校验（对齐合约 _checkCall）：通过返回 ''，否则返回合约判定的拦截原因
    _checkCall(fieldId, periodType, units) {
      const f = chain.fields[Number(fieldId)];
      if (!f) return '字段不存在';
      if (Number(periodType) !== 0 && Number(periodType) !== 1) return '不支持的计费周期';
      if (Number(units) <= 0) return '数量必须大于0';
      if (chain.flagged[actor]) return '该企业已被监管标记失信，暂停调用权限';
      if (scoreOf(actor) < MIN_REPUTATION) return '企业信誉分不足，暂停调用权限';
      const p = permOf(Number(fieldId), actor);
      if (!p.active) return '未获得授权，请先申请授权';
      if (p.expiry > 0 && nowSec() >= p.expiry) return '该授权已过期，请重新申请';
      if (p.maxCalls > 0 && p.usedCalls + Number(units) > p.maxCalls) return '该授权调用次数已用尽，请重新申请';
      const totalPrice = (Number(periodType) === 0 ? STANDARD_PRICE_PER_CALL : STANDARD_PRICE_PER_DAY) * BigInt(units);
      if ((chain.deposits[actor] || 0n) < totalPrice) return '余额不足，请充值！';
      return '';
    },

    // 记录一次被拦截的调用（合约自动留痕，企业无法伪造 / 选择性不上报）
    _recordBlocked(fieldId, reason) {
      chain.blockedAttempts.push({
        id: chain.blockedAttempts.length, fieldId: Number(fieldId),
        enterprise: actor, reason, timestamp: nowSec(),
      });
      chain.blockedCount[actor] = (chain.blockedCount[actor] || 0) + 1;
      emit('AccessAttemptBlocked', { enterprise: actor, fieldId: Number(fieldId), reason });
    },

    // 执行调用：扣押金 -> 记次数 -> 建托管单（费用进入托管而非直转）
    _executeCall(fieldId, units, unitPrice, deliveryHash) {
      const f = chain.fields[Number(fieldId)];
      const key = `${Number(fieldId)}:${actor}`;
      const p = chain.permissions[key];
      const totalPrice = unitPrice * BigInt(units);
      chain.deposits[actor] = (chain.deposits[actor] || 0n) - totalPrice;
      p.usedCalls += Number(units);
      f.callCount += Number(units);
      chain.successCalls[actor] = (chain.successCalls[actor] || 0) + 1;
      chain.totalDistributed += totalPrice;
      const id = chain.escrows.length;
      chain.escrows.push({
        id, fieldId: Number(fieldId), user: f.owner, enterprise: actor,
        amount: totalPrice, deliveryHash: String(deliveryHash),
        createdAt: nowSec(), confirmedAt: 0,
        disputed: false, settled: false, refunded: false, disputeReason: '',
      });
      emit('EscrowCreated', {
        escrowId: id, fieldId: Number(fieldId), user: f.owner, enterprise: actor,
        amount: totalPrice, deliveryHash: String(deliveryHash),
        releaseAt: BigInt(nowSec()) + CHALLENGE_PERIOD,
      });
      return id;
    },

    // ★ 调用数据唯一入口：校验失败 -> 留痕 -> 返回原因（不 revert，对齐合约设计）
    async callData(fieldId, periodType, units, deliveryHash) {
      return withTx(() => {
        if (chain.roles[actor] !== 'enterprise') revert('AccessControl: 账号缺少企业角色');
        const reason = writes._checkCall(fieldId, periodType, units);
        if (reason) {
          writes._recordBlocked(fieldId, reason);
          return { ok: false, escrowId: 0, reason };
        }
        const unitPrice = Number(periodType) === 0 ? STANDARD_PRICE_PER_CALL : STANDARD_PRICE_PER_DAY;
        const escrowId = writes._executeCall(fieldId, units, unitPrice, deliveryHash);
        return { ok: true, escrowId, reason: '' };
      });
    },

    // 企业确认收货：托管立即解锁，用户可马上提现
    async confirmDelivery(escrowId) {
      return withTx(() => {
        const e = chain.escrows[Number(escrowId)];
        if (!e) revert('托管单不存在');
        if (e.enterprise !== actor) revert('只能确认自己发起的调用');
        if (e.settled) revert('该笔调用已结算');
        if (e.disputed) revert('该笔调用处于争议中');
        if (e.confirmedAt !== 0) revert('该笔调用已确认过收货');
        e.confirmedAt = nowSec();
        emit('DeliveryConfirmed', {
          escrowId: Number(escrowId), enterprise: actor,
          fieldId: e.fieldId, deliveryHash: e.deliveryHash,
        });
      });
    },

    // 企业取消订单：托管资金原路退回押金池（仅限窗口内 / 未结算 / 未争议）
    async cancelOrder(escrowId) {
      return withTx(() => {
        const e = chain.escrows[Number(escrowId)];
        if (!e) revert('订单不存在');
        if (e.enterprise !== actor) revert('只能取消自己的订单');
        if (e.settled) revert('该订单已结算，无法取消');
        if (e.disputed) revert('该订单处于争议中，请等待监管裁决');
        if (nowSec() >= Number(writes.releaseAtOf(escrowId))) revert('已过可取消时间，资金将结算给数据所有者');
        e.settled = true;
        e.refunded = true;
        chain.deposits[e.enterprise] = (chain.deposits[e.enterprise] || 0n) + e.amount;
        chain.totalDistributed -= e.amount;
        chain.totalRefunded += e.amount;
        emit('OrderCancelled', { escrowId: Number(escrowId), enterprise: actor, amount: e.amount });
      });
    },

    // 企业发起申诉（窗口内 / 未确认收货）
    async raiseDispute(escrowId, reason) {
      return withTx(() => {
        const e = chain.escrows[Number(escrowId)];
        if (!e) revert('托管单不存在');
        if (!reason || !String(reason).length) revert('申诉理由不能为空');
        if (e.enterprise !== actor) revert('只能对自己的调用发起申诉');
        if (e.settled) revert('该笔调用已结算');
        if (e.disputed) revert('该笔调用已在争议中');
        if (nowSec() >= Number(writes.releaseAtOf(escrowId))) revert('争议窗口已结束，无法再发起申诉');
        e.disputed = true;
        e.disputeReason = String(reason);
        emit('DisputeRaised', { escrowId: Number(escrowId), enterprise: actor, fieldId: e.fieldId, reason: String(reason) });
      });
    },

    // 用户提现：按公开比例自动分账（用户 90% / 平台 10%）
    async withdrawRevenue(escrowId) {
      return withTx(() => {
        const e = chain.escrows[Number(escrowId)];
        if (!e) revert('托管单不存在');
        if (e.user !== actor) revert('只能提现属于自己的收益');
        if (e.settled) revert('该笔收益已结算');
        if (e.disputed) revert('该笔收益处于争议中，请等待监管裁决');
        if (nowSec() < Number(writes.releaseAtOf(escrowId))) revert('仍在争议窗口内，请等待窗口结束后提现');
        e.settled = true;
        const toPlatform = (e.amount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        const toUser = e.amount - toPlatform;
        chain.totalWithdrawn += toUser;
        chain.totalPlatformRevenue += toPlatform;
        if (toPlatform > 0n) emit('PlatformRevenuePaid', { escrowId: Number(escrowId), platform: SIM_PLATFORM_TREASURY, amount: toPlatform });
        emit('RevenueWithdrawn', { escrowId: Number(escrowId), user: e.user, amount: toUser });
        // 与真实合约一致：收益真正到账时才发出 RevenueDistributed（金额=用户实得）
        emit('RevenueDistributed', { fieldId: e.fieldId, user: e.user, enterprise: e.enterprise, amount: toUser });
      });
    },

    // 监管裁决：只能决定「退给企业」或「放给用户」
    async resolveDispute(escrowId, refundToEnterprise) {
      return withTx(() => {
        if (chain.roles[actor] !== 'regulator') revert('AccessControl: 账号缺少监管角色');
        const e = chain.escrows[Number(escrowId)];
        if (!e) revert('托管单不存在');
        if (!e.disputed) revert('该托管单不在争议中');
        if (e.settled) revert('该托管单已结算');
        e.settled = true;
        if (refundToEnterprise) {
          e.refunded = true;
          chain.deposits[e.enterprise] = (chain.deposits[e.enterprise] || 0n) + e.amount;
          chain.totalDistributed -= e.amount;
          chain.totalRefunded += e.amount;
        } else {
          chain.disputesLost[e.enterprise] = (chain.disputesLost[e.enterprise] || 0) + 1;
          const toPlatform = (e.amount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
          const toUser = e.amount - toPlatform;
          chain.totalWithdrawn += toUser;
          chain.totalPlatformRevenue += toPlatform;
          if (toPlatform > 0n) emit('PlatformRevenuePaid', { escrowId: Number(escrowId), platform: SIM_PLATFORM_TREASURY, amount: toPlatform });
          emit('RevenueDistributed', { fieldId: e.fieldId, user: e.user, enterprise: e.enterprise, amount: toUser });
        }
        emit('DisputeResolved', {
          escrowId: Number(escrowId), refundedToEnterprise: Boolean(refundToEnterprise),
          regulator: actor, amount: e.amount,
        });
      });
    },

    // 监管失信标记（只影响调用权限，不触碰资金）
    async flagEnterprise(enterprise, flag, reason) {
      return withTx(() => {
        if (chain.roles[actor] !== 'regulator') revert('AccessControl: 账号缺少监管角色');
        if (flag && chain.roles[enterprise] !== 'enterprise') revert('标记对象不是企业角色');
        chain.flagged[enterprise] = Boolean(flag);
        chain.flagReason[enterprise] = flag ? String(reason || '') : '';
        emit('EnterpriseFlagged', { enterprise, flagged: Boolean(flag), reason: String(reason || '') });
      });
    },

    // 托管单解锁时间点（确认收货立即解锁，否则窗口结束后解锁）
    releaseAtOf(escrowId) {
      const e = chain.escrows[Number(escrowId)];
      if (!e) return 0n;
      return BigInt(e.confirmedAt > 0 ? e.confirmedAt : e.createdAt + Number(CHALLENGE_PERIOD));
    },

    // 订单三态归一：0=托管中 1=已分账 2=已退款
    orderStateOf(escrowId) {
      const e = chain.escrows[Number(escrowId)];
      if (!e) revert('订单不存在');
      return e.refunded ? 2 : (e.settled ? 1 : 0);
    },

    // 分账预览（前端展示「用户实得 / 平台服务费」）
    platformSplitOf(amount) {
      const a = BigInt(amount);
      const toPlatform = (a * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
      return [a - toPlatform, toPlatform];
    },

    standardPriceOf(periodType) {
      if (Number(periodType) !== 0 && Number(periodType) !== 1) revert('不支持的计费周期');
      return Number(periodType) === 0 ? STANDARD_PRICE_PER_CALL : STANDARD_PRICE_PER_DAY;
    },
  };

  // --- view 方法（返回形状对齐 ethers：数值 BigInt、结构双访问、多返回值为数组） ---
  const views = {
    getFieldsCount: async () => BigInt(chain.fields.length),
    getEscrowsCount: async () => BigInt(chain.escrows.length),
    getAuthRequestsCount: async () => BigInt(chain.authRequests.length),
    fields: async (i) => {
      const f = chain.fields[Number(i)];
      if (!f) revert('字段不存在');
      return simStruct([f.owner, f.name, BigInt(f.callCount), BigInt(f.createdAt), f.commitment, f.dataRef],
        ['owner', 'name', 'callCount', 'createdAt', 'commitment', 'dataRef']);
    },
    permissions: async (fieldId, addr) => permOf(Number(fieldId), addr),
    getPermission: async (fieldId, addr) => {
      const p = permOf(Number(fieldId), addr);
      return simStruct([p.active, BigInt(p.expiry), BigInt(p.maxCalls), BigInt(p.usedCalls)],
        ['active', 'expiry', 'maxCalls', 'usedCalls']);
    },
    hasPermission: async (fieldId, addr) => {
      const p = permOf(Number(fieldId), addr);
      if (!p.active) return false;
      if (p.expiry > 0 && nowSec() >= p.expiry) return false;
      if (p.maxCalls > 0 && p.usedCalls >= p.maxCalls) return false;
      return true;
    },
    deposits: async (addr) => BigInt(chain.deposits[addr] || 0n),
    authRequests: async (i) => {
      const r = chain.authRequests[Number(i)];
      if (!r) revert('申请不存在');
      return simStruct(
        [BigInt(r.fieldId), r.user, r.enterprise, Number(r.periodType), BigInt(r.units), r.unitPrice, r.totalPrice, r.resolved],
        ['fieldId', 'user', 'enterprise', 'periodType', 'units', 'unitPrice', 'totalPrice', 'resolved']
      );
    },
    escrows: async (i) => {
      const e = chain.escrows[Number(i)];
      if (!e) revert('托管单不存在');
      return simStruct(
        [BigInt(e.fieldId), e.user, e.enterprise, e.amount, e.deliveryHash, BigInt(e.createdAt), BigInt(e.confirmedAt),
         e.disputed, e.settled, e.refunded, e.disputeReason],
        ['fieldId', 'user', 'enterprise', 'amount', 'deliveryHash', 'createdAt', 'confirmedAt',
         'disputed', 'settled', 'refunded', 'disputeReason']
      );
    },
    canWithdraw: async (escrowId) => {
      const e = chain.escrows[Number(escrowId)];
      if (!e) revert('托管单不存在');
      const releaseAt = writes.releaseAtOf(escrowId);
      const ok = !e.settled && !e.disputed && nowSec() >= Number(releaseAt);
      return [ok, releaseAt];
    },
    blockedAttempts: async (i) => {
      const b = chain.blockedAttempts[Number(i)];
      if (!b) revert('记录不存在');
      return simStruct([BigInt(b.fieldId), b.enterprise, b.reason, BigInt(b.timestamp)],
        ['fieldId', 'enterprise', 'reason', 'timestamp']);
    },
    blockedCount: async (addr) => BigInt(chain.blockedCount[addr] || 0),
    roleOf: async (addr) => chain.roles[addr] || 'none',
    flagReason: async (addr) => chain.flagReason[addr] || '',
    reputationOf: async (addr) => simStruct(
      [scoreOf(addr), BigInt(chain.successCalls[addr] || 0), BigInt(chain.blockedCount[addr] || 0),
       BigInt(chain.disputesLost[addr] || 0), Boolean(chain.flagged[addr])],
      ['score', 'success', 'blocked', 'lost', 'isFlagged']
    ),
    totalAuthorizations: async () => chain.totalAuthorizations,
    totalDistributed: async () => chain.totalDistributed,
    totalWithdrawn: async () => chain.totalWithdrawn,
    totalRefunded: async () => chain.totalRefunded,
    totalPlatformRevenue: async () => chain.totalPlatformRevenue,
    CHALLENGE_PERIOD: async () => CHALLENGE_PERIOD,
    // 平台服务费收款地址（对齐合约 public platformTreasury 只读 getter）
    platformTreasury: async () => SIM_PLATFORM_TREASURY,
    STANDARD_PRICE_PER_CALL: async () => STANDARD_PRICE_PER_CALL,
    STANDARD_PRICE_PER_DAY: async () => STANDARD_PRICE_PER_DAY,
    PLATFORM_FEE_BPS: async () => PLATFORM_FEE_BPS,
    BPS_DENOMINATOR: async () => BPS_DENOMINATOR,
    CONTRACT_VERSION: async () => SIM_CONTRACT_VERSION,
    releaseAtOf: async (escrowId) => writes.releaseAtOf(escrowId),
    orderStateOf: async (escrowId) => writes.orderStateOf(escrowId),
    platformSplitOf: async (amount) => writes.platformSplitOf(amount),
    standardPriceOf: async (periodType) => writes.standardPriceOf(periodType),
  };

  // --- 合约对象：view + 写方法（写方法挂 staticCall）+ 事件设施 ---
  const contract = {
    // ethers 合约的地址属性（ProofDrawer 展示合约地址用）
    target: SIM_CONTRACT_ADDRESS,
    address: SIM_CONTRACT_ADDRESS,
    runner: { provider },
    filters,
    queryFilter: async (nameOrFilter, fromBlock = 0, toBlock = 'latest') => {
      const st = ensureChain();
      const latest = st.blockNumber;
      const from = Number(fromBlock ?? 0);
      const to = toBlock === 'latest' ? latest : Number(toBlock);
      let name = null;
      let pos = null;
      if (typeof nameOrFilter === 'string') {
        name = nameOrFilter;
      } else if (nameOrFilter && nameOrFilter.__simFilter) {
        name = nameOrFilter.__simFilter.name;
        pos = nameOrFilter.__simFilter.pos;
      }
      return st.events
        .filter((ev) => (!name || ev.name === name)
          && ev.blockNumber >= from && ev.blockNumber <= to
          && matchPos(ev.args, pos))
        .map((ev) => makeLog(ev, st));
    },
    on: (name, cb) => {
      (eventSubs[name] = eventSubs[name] || new Set()).add(cb);
      return contract;
    },
    off: (name, cb) => {
      eventSubs[name]?.delete(cb);
      return contract;
    },
    removeListener: (name, cb) => eventSubs[name]?.delete(cb),
    ...views,
  };

  // 写方法包装：把 writes 里的实现挂到合约上，并同时提供 staticCall（企业端预演用）
  Object.entries(writes).forEach(([fn, impl]) => {
    if (fn.startsWith('_')) return;            // 内部工具不上对外接口
    if (['releaseAtOf', 'orderStateOf', 'platformSplitOf', 'standardPriceOf'].includes(fn)) {
      // 纯读函数在 views 已挂（async 版本），这里跳过
      return;
    }
    const call = (...args) => {
      if (chain.roles[actor] === undefined && fn !== 'registerAsUser'
        && fn !== 'registerAsEnterprise' && fn !== 'registerAsRegulator') {
        // 其余写方法在合约层要求对应角色，统一在实现内校验，这里不重复拦截
      }
      // ★ ethers 同形关键：写方法调用返回「待等待交易」对象（.wait() 出回执）。
      //   若直接返回裸业务值，工作台 confirmTx 调 tx.wait() 会抛 TypeError，
      //   被兜底文案吞成「交易失败，请稍后重试」—— 状态实际已写入却报失败
      return Promise.resolve(impl(...args)).then(({ out, hash }) => {
        const tx = makeReceipt(hash);   // { hash, blockNumber, wait }
        return {
          ...tx,
          result: out,                  // 业务返回值（如 callData 的 [ok, escrowId, reason]）
          wait: async () => ({ ...(await tx.wait()), result: out }),
        };
      });
    };
    // staticCall：只读预演，不出块不留痕，返回值/报错形态与真实交易一致。
    // ★ 全量深快照回滚（JSON 序列化，BigInt 走专用标记）：部分字段快照会遗漏
    //   events / blocks / txs，导致预演事件泄漏成「幽灵托管单」，必须全量快照
    call.staticCall = async (...args) => {
      const snap = JSON.stringify(chain, _repl);
      simulating = true;
      try {
        const r = await impl(...args);
        // 写实现经 withTx 返回 { out, hash }，预演只取业务值（兼容裸值形态）
        const out = (r && typeof r === 'object' && 'out' in r) ? r.out : r;
        return fn === 'callData' ? [out.ok, out.escrowId, out.reason] : out;
      } finally {
        simulating = false;
        const restored = JSON.parse(snap, _rev);
        Object.keys(restored).forEach((k) => { chain[k] = restored[k]; });
      }
    };
    contract[fn] = call;
  });

  return contract;
}

// ---------------- 链级操作 ----------------

// 切换当前交易发起人（演示身份切换时调用）
export function setSimActor(addr) {
  ensureChain();
  actor = addr;
  save();
  notifyChange();
}

export function getSimActor() {
  ensureChain();
  return actor;
}

// 订阅链变更（返回取消订阅函数）
export function subscribeSimChanges(cb) {
  changeSubs.add(cb);
  return () => changeSubs.delete(cb);
}

// ---------------- 交付凭证回填（模拟数据与真实链完全同口径） ----------------
// 为什么需要它：
//   链上交付凭证 deliveryHash = keccak256(链下数据文件的 JSON)，由企业端
//   callData 写入（见 config.buildDeliveryHash）。而播种发生在页面启动的同步阶段，
//   此时链下数据文件（public/data/*.json，运行时 fetch）尚未加载，种子只能写入
//   占位值 —— 存证抽屉「本地重算摘要」就会与链上凭证对不上，误报「旧版凭证格式」。
// 做法：等链下数据加载完成，按同一函数把每个托管单的凭证重算回填，
//   并同步修正 EscrowCreated / DeliveryConfirmed 事件里的凭证参数，
//   保证「托管单结构 + 事件证据链 + 导出审计报告」三处口径一致。
export async function hydrateSeedDeliveryHashes() {
  ensureChain();
  try { await loadAllData(); } catch { return; }   // 数据不可用时保持原值，不误改
  let changed = false;
  chain.escrows.forEach((e) => {
    const f = chain.fields[e.fieldId];
    const real = f ? buildDeliveryHash(f.dataRef) : '';
    if (!real || real === e.deliveryHash) return;
    e.deliveryHash = real;
    changed = true;
    // 事件参数下标与 EVENT_ABI 的位置顺序一致
    const argIdx = { EscrowCreated: 5, DeliveryConfirmed: 3 };
    chain.events.forEach((ev) => {
      const i = argIdx[ev.name];
      if (i === undefined) return;
      if (Number(ev.args[0]) === Number(e.id)) ev.args[i] = real;
    });
  });
  if (changed) { save(); notifyChange(); }
}

// 重置演示数据：清库重新播种（设置面板「重置演示数据」入口）
export async function resetSimChain() {
  try { localStorage.removeItem(STORE_KEY); } catch { /* 忽略 */ }
  chain = null;
  actor = SIM_USER_ADDRESS;
  ensureChain();
  await hydrateSeedDeliveryHashes();   // 重新播种后同样回填真实交付凭证
  save();
  notifyChange();
}
