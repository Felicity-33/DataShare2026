// ============================================================
// DataShare 前端全局配置
// ------------------------------------------------------------
// 1. CONTRACT_ADDRESS：部署合约后请把 scripts/deploy.js 输出的
//    合约地址粘贴到这里（合约与前端通过该地址交互）
// 2. DataShareABI：**由 scripts/gen-abi.cjs 从编译产物自动生成**，
//    不要手工维护 —— 手写 ABI 与链上合约不一致时 ethers 会静默错解返回值。
//    合约改动后执行：npm run compile && node scripts/gen-abi.cjs
// 3. EXPECTED_CONTRACT_VERSION：期望的链上合约版本，用于启动自检
// 4. 辅助函数：地址缩略 / ETH 格式化 / 时间格式化 / 报错解析
//    + 链下数据文件读取与摘要 / 倒计时格式化 / 本地链时钟同步
// ============================================================
import { ethers } from 'ethers';

// ---------------- 链与合约配置（双网络参数化） ----------------
// ★ 本项目支持两种链上部署目标，通过环境变量 VITE_CHAIN_TARGET 切换：
//   - ganache（默认）：本地开发 / 现场演示，连接 127.0.0.1:7545；
//   - sepolia：线上评审场景，合约部署在 Sepolia 测试网（地址见 VITE_SEPOLIA_CONTRACT_ADDRESS）。
// 切换方式：frontend/.env 里写入 VITE_CHAIN_TARGET=sepolia 后重新构建。
export const NETWORKS = {
  ganache: {
    key: 'ganache',
    label: 'Ganache 本地测试网',
    chainId: 1337,
    hexChainId: '0x539',
    rpcUrl: 'http://127.0.0.1:7545',
    // v4.4「争议窗口 600 秒」版，部署时间 2026-09-23；本地重新部署后需同步更新
    contractAddress: '0xFDE792d0837298Df423Bc7a0cb8cC596804c253B',
  },
  sepolia: {
    key: 'sepolia',
    label: 'Sepolia 测试网',
    chainId: 11155111,
    hexChainId: '0xaa36a7',
    rpcUrl: '', // Sepolia 使用钱包内置公共 RPC，无需手动指定
    // 阶段二部署后填写 .env 的 VITE_SEPOLIA_CONTRACT_ADDRESS
    contractAddress: import.meta.env.VITE_SEPOLIA_CONTRACT_ADDRESS || '',
  },
};

// 当前生效的链上网络（构建期决定；非法值回退 ganache，保证本地开发永不中断）
const _target = import.meta.env.VITE_CHAIN_TARGET || 'ganache';
export const ACTIVE_NETWORK = NETWORKS[_target] || NETWORKS.ganache;

// ---- 以下三个常量保留原名导出（历史代码引用点较多），取值统一由 ACTIVE_NETWORK 派生 ----
export const GANACHE_CHAIN_ID = NETWORKS.ganache.chainId;               // 兼容旧引用：本地 ChainID
export const GANACHE_RPC_URL = NETWORKS.ganache.rpcUrl;                 // 兼容旧引用：本地 RPC 地址
// 当前网络的合约地址（链上模式下前端与合约交互的唯一入口，单一来源）
export const CONTRACT_ADDRESS = ACTIVE_NETWORK.contractAddress;

/// 让本地开发链的时钟追上真实时间（仅用于本地 Ganache；其他网络静默跳过）。
///
/// 为什么需要（真实事故，务必看）：
///   Ganache 空闲时不出块 —— **最新区块的时间戳会冻在最后一次出块时刻**
///   （实测可落后真实时间 5 分钟以上）。而合约的时间闸门用的正是 block.timestamp，
///   于是出现两头都不对的矛盾：
///     ① `canWithdraw` 这类 view 按冻结时间算 → 明明早该解锁却返回 false；
///     ② 发交易前 ethers 会先 `eth_estimateGas`（同样按冻结时间算）→ 误判「仍在争议窗口内」，
///        交易**在发出之前就失败**，用户只看到一句「交易失败，请稍后重试」；
///        而真正被打包时，Ganache 用的是真实时间 —— 条件其实早已满足（实测：新区块时间戳 = 真实时间）。
///   产出一个时间戳等于真实时间的区块，就能让「链上口径」与「界面口径」重新一致。
///
/// @returns {Promise<boolean>} 是否成功（失败不影响主流程，调用方不必处理）
/// @dev 惰性创建的只读 provider（复用连接；声明必须在 syncChainClock 之前）
let _localRpc = null;

export async function syncChainClock() {
  // 仅本地 Ganache 需要（Sepolia 由验证者出块，时间戳永远新鲜）
  if (ACTIVE_NETWORK.key !== 'ganache') return false;
  try {
    if (!_localRpc) _localRpc = new ethers.JsonRpcProvider(NETWORKS.ganache.rpcUrl);
    await _localRpc.send('evm_mine', []);
    return true;
  } catch {
    return false;   // 非本地链 / 节点不支持 evm_mine —— 静默跳过
  }
}

// ★ 前端期望的合约版本号：与链上 CONTRACT_VERSION 比对，
//   不一致说明链上跑的是旧合约（或 ABI 未同步），界面会给出醒目提示。
//   修改合约结构后必须同时递增此处的期望版本与合约里的 CONTRACT_VERSION。
// v4.4：争议窗口 60 → 600 秒（修复企业申诉因窗口过短无法发起的问题）
export const EXPECTED_CONTRACT_VERSION = '4.4';

// 演示企业地址（Ganache 助记词派生的第 3 个账户，对应 scripts/deploy.js 中的 enterprise）
export const DEMO_ENTERPRISE_ADDRESS = '0x49f880A668C62C9390Ea0E1e36cC6637A50ba3F9';

// ---------------- 合约 ABI（与 DataShare.sol 对应） ----------------
export const DataShareABI = [
  // ★ 本 ABI 由编译产物 artifacts/contracts/DataShare.sol/DataShare.json 自动生成，
  //   请勿手工维护。手写 ABI 与链上合约不一致时，ethers 会静默错解返回值（界面正常但数据全错）。
  //   重新生成：npm run compile && node scripts/gen-abi.cjs
  // ---------- 函数（69 个）----------,
  {"inputs": [{"internalType": "uint256", "name": "requestId", "type": "uint256"}], "name": "approveAuthorization", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "name": "authRequests", "outputs": [{"internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"internalType": "address", "name": "user", "type": "address"}, {"internalType": "address", "name": "enterprise", "type": "address"}, {"internalType": "uint8", "name": "periodType", "type": "uint8"}, {"internalType": "uint256", "name": "units", "type": "uint256"}, {"internalType": "uint256", "name": "unitPrice", "type": "uint256"}, {"internalType": "uint256", "name": "totalPrice", "type": "uint256"}, {"internalType": "bool", "name": "resolved", "type": "bool"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "BASE_REPUTATION", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "name": "blockedAttempts", "outputs": [{"internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"internalType": "address", "name": "enterprise", "type": "address"}, {"internalType": "string", "name": "reason", "type": "string"}, {"internalType": "uint256", "name": "timestamp", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "blockedCount", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "BPS_DENOMINATOR", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"internalType": "uint8", "name": "periodType", "type": "uint8"}, {"internalType": "uint256", "name": "units", "type": "uint256"}, {"internalType": "bytes32", "name": "deliveryHash", "type": "bytes32"}], "name": "callData", "outputs": [{"internalType": "bool", "name": "ok", "type": "bool"}, {"internalType": "uint256", "name": "escrowId", "type": "uint256"}, {"internalType": "string", "name": "reason", "type": "string"}], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "escrowId", "type": "uint256"}], "name": "cancelOrder", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "escrowId", "type": "uint256"}], "name": "canWithdraw", "outputs": [{"internalType": "bool", "name": "ok", "type": "bool"}, {"internalType": "uint256", "name": "releaseAt", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "CHALLENGE_PERIOD", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "escrowId", "type": "uint256"}], "name": "confirmDelivery", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [], "name": "CONTRACT_VERSION", "outputs": [{"internalType": "string", "name": "", "type": "string"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "DEFAULT_ADMIN_ROLE", "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "requestId", "type": "uint256"}], "name": "denyAuthorization", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [], "name": "deposit", "outputs": [], "stateMutability": "payable", "type": "function"},
  {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "deposits", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "disputesLost", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "ENTERPRISE_ROLE", "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "name": "escrows", "outputs": [{"internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"internalType": "address", "name": "user", "type": "address"}, {"internalType": "address", "name": "enterprise", "type": "address"}, {"internalType": "uint256", "name": "amount", "type": "uint256"}, {"internalType": "bytes32", "name": "deliveryHash", "type": "bytes32"}, {"internalType": "uint256", "name": "createdAt", "type": "uint256"}, {"internalType": "uint256", "name": "confirmedAt", "type": "uint256"}, {"internalType": "bool", "name": "disputed", "type": "bool"}, {"internalType": "bool", "name": "settled", "type": "bool"}, {"internalType": "bool", "name": "refunded", "type": "bool"}, {"internalType": "string", "name": "disputeReason", "type": "string"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "name": "fields", "outputs": [{"internalType": "address", "name": "owner", "type": "address"}, {"internalType": "string", "name": "name", "type": "string"}, {"internalType": "uint256", "name": "callCount", "type": "uint256"}, {"internalType": "uint256", "name": "createdAt", "type": "uint256"}, {"internalType": "uint256", "name": "commitment", "type": "uint256"}, {"internalType": "string", "name": "dataRef", "type": "string"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "address", "name": "enterprise", "type": "address"}, {"internalType": "bool", "name": "flag", "type": "bool"}, {"internalType": "string", "name": "reason", "type": "string"}], "name": "flagEnterprise", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "flagged", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "flagReason", "outputs": [{"internalType": "string", "name": "", "type": "string"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "getAuthRequestsCount", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "getEscrowsCount", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "getFieldsCount", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"internalType": "address", "name": "enterprise", "type": "address"}], "name": "getPermission", "outputs": [{"internalType": "bool", "name": "active", "type": "bool"}, {"internalType": "uint256", "name": "expiry", "type": "uint256"}, {"internalType": "uint256", "name": "maxCalls", "type": "uint256"}, {"internalType": "uint256", "name": "usedCalls", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}], "name": "getRoleAdmin", "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"internalType": "address", "name": "enterprise", "type": "address"}], "name": "grantPermission", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"internalType": "address", "name": "enterprise", "type": "address"}, {"internalType": "uint256", "name": "expiry", "type": "uint256"}, {"internalType": "uint256", "name": "maxCalls", "type": "uint256"}], "name": "grantPermissionWithLimit", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}, {"internalType": "address", "name": "account", "type": "address"}], "name": "grantRole", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"internalType": "address", "name": "enterprise", "type": "address"}], "name": "hasPermission", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}, {"internalType": "address", "name": "account", "type": "address"}], "name": "hasRole", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "MAX_REPUTATION", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "MIN_REPUTATION", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "escrowId", "type": "uint256"}], "name": "orderStateOf", "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "", "type": "uint256"}, {"internalType": "address", "name": "", "type": "address"}], "name": "permissions", "outputs": [{"internalType": "bool", "name": "active", "type": "bool"}, {"internalType": "uint256", "name": "expiry", "type": "uint256"}, {"internalType": "uint256", "name": "maxCalls", "type": "uint256"}, {"internalType": "uint256", "name": "usedCalls", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "PLATFORM_FEE_BPS", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "amount", "type": "uint256"}], "name": "platformSplitOf", "outputs": [{"internalType": "uint256", "name": "toUser", "type": "uint256"}, {"internalType": "uint256", "name": "toPlatform", "type": "uint256"}], "stateMutability": "pure", "type": "function"},
  {"inputs": [], "name": "platformTreasury", "outputs": [{"internalType": "address", "name": "", "type": "address"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "escrowId", "type": "uint256"}, {"internalType": "string", "name": "reason", "type": "string"}], "name": "raiseDispute", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [], "name": "registerAsEnterprise", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [], "name": "registerAsRegulator", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [], "name": "registerAsUser", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "string", "name": "name", "type": "string"}, {"internalType": "string", "name": "dataRef", "type": "string"}, {"internalType": "uint256[2]", "name": "pA", "type": "uint256[2]"}, {"internalType": "uint256[2][2]", "name": "pB", "type": "uint256[2][2]"}, {"internalType": "uint256[2]", "name": "pC", "type": "uint256[2]"}, {"internalType": "uint256[2]", "name": "pubSignals", "type": "uint256[2]"}], "name": "registerField", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [], "name": "REGULATOR_ROLE", "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "escrowId", "type": "uint256"}], "name": "releaseAtOf", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}, {"internalType": "address", "name": "callerConfirmation", "type": "address"}], "name": "renounceRole", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "address", "name": "enterprise", "type": "address"}], "name": "reputationOf", "outputs": [{"internalType": "uint256", "name": "score", "type": "uint256"}, {"internalType": "uint256", "name": "success", "type": "uint256"}, {"internalType": "uint256", "name": "blocked", "type": "uint256"}, {"internalType": "uint256", "name": "lost", "type": "uint256"}, {"internalType": "bool", "name": "isFlagged", "type": "bool"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"internalType": "uint8", "name": "periodType", "type": "uint8"}, {"internalType": "uint256", "name": "units", "type": "uint256"}], "name": "requestAuthorization", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "escrowId", "type": "uint256"}, {"internalType": "bool", "name": "refundToEnterprise", "type": "bool"}], "name": "resolveDispute", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"internalType": "address", "name": "enterprise", "type": "address"}], "name": "revokePermission", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "bytes32", "name": "role", "type": "bytes32"}, {"internalType": "address", "name": "account", "type": "address"}], "name": "revokeRole", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "address", "name": "who", "type": "address"}], "name": "roleOf", "outputs": [{"internalType": "string", "name": "", "type": "string"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "address", "name": "newTreasury", "type": "address"}], "name": "setPlatformTreasury", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [{"internalType": "address", "name": "newVerifier", "type": "address"}], "name": "setZkVerifier", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [], "name": "STANDARD_PRICE_PER_CALL", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "STANDARD_PRICE_PER_DAY", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint8", "name": "periodType", "type": "uint8"}], "name": "standardPriceOf", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "pure", "type": "function"},
  {"inputs": [{"internalType": "address", "name": "", "type": "address"}], "name": "successCalls", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "bytes4", "name": "interfaceId", "type": "bytes4"}], "name": "supportsInterface", "outputs": [{"internalType": "bool", "name": "", "type": "bool"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "totalAuthorizations", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "totalDistributed", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "totalPlatformRevenue", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "totalRefunded", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "totalWithdrawn", "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}], "stateMutability": "view", "type": "function"},
  {"inputs": [], "name": "USER_ROLE", "outputs": [{"internalType": "bytes32", "name": "", "type": "bytes32"}], "stateMutability": "view", "type": "function"},
  {"inputs": [{"internalType": "uint256", "name": "escrowId", "type": "uint256"}], "name": "withdrawRevenue", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
  {"inputs": [], "name": "zkVerifier", "outputs": [{"internalType": "address", "name": "", "type": "address"}], "stateMutability": "view", "type": "function"},
  // ---------- 事件（22 个）----------,
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "address", "name": "enterprise", "type": "address"}, {"indexed": true, "internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"indexed": false, "internalType": "string", "name": "reason", "type": "string"}], "name": "AccessAttemptBlocked", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "requestId", "type": "uint256"}, {"indexed": true, "internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "user", "type": "address"}, {"indexed": false, "internalType": "address", "name": "enterprise", "type": "address"}, {"indexed": false, "internalType": "uint8", "name": "periodType", "type": "uint8"}, {"indexed": false, "internalType": "uint256", "name": "units", "type": "uint256"}, {"indexed": false, "internalType": "uint256", "name": "unitPrice", "type": "uint256"}, {"indexed": false, "internalType": "uint256", "name": "totalPrice", "type": "uint256"}], "name": "AuthorizationApproved", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "requestId", "type": "uint256"}, {"indexed": true, "internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "user", "type": "address"}, {"indexed": false, "internalType": "address", "name": "enterprise", "type": "address"}, {"indexed": false, "internalType": "uint8", "name": "periodType", "type": "uint8"}, {"indexed": false, "internalType": "uint256", "name": "units", "type": "uint256"}, {"indexed": false, "internalType": "uint256", "name": "unitPrice", "type": "uint256"}, {"indexed": false, "internalType": "uint256", "name": "totalPrice", "type": "uint256"}], "name": "AuthorizationDenied", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "requestId", "type": "uint256"}, {"indexed": true, "internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "user", "type": "address"}, {"indexed": false, "internalType": "address", "name": "enterprise", "type": "address"}, {"indexed": false, "internalType": "uint8", "name": "periodType", "type": "uint8"}, {"indexed": false, "internalType": "uint256", "name": "units", "type": "uint256"}, {"indexed": false, "internalType": "uint256", "name": "unitPrice", "type": "uint256"}, {"indexed": false, "internalType": "uint256", "name": "totalPrice", "type": "uint256"}], "name": "AuthorizationRequested", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "escrowId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "enterprise", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"indexed": false, "internalType": "bytes32", "name": "deliveryHash", "type": "bytes32"}], "name": "DeliveryConfirmed", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "address", "name": "enterprise", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}, {"indexed": false, "internalType": "uint256", "name": "balance", "type": "uint256"}], "name": "DepositMade", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "escrowId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "enterprise", "type": "address"}, {"indexed": true, "internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"indexed": false, "internalType": "string", "name": "reason", "type": "string"}], "name": "DisputeRaised", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "escrowId", "type": "uint256"}, {"indexed": false, "internalType": "bool", "name": "refundedToEnterprise", "type": "bool"}, {"indexed": false, "internalType": "address", "name": "regulator", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}], "name": "DisputeResolved", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "address", "name": "enterprise", "type": "address"}, {"indexed": false, "internalType": "bool", "name": "flagged", "type": "bool"}, {"indexed": false, "internalType": "string", "name": "reason", "type": "string"}], "name": "EnterpriseFlagged", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "escrowId", "type": "uint256"}, {"indexed": true, "internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "user", "type": "address"}, {"indexed": false, "internalType": "address", "name": "enterprise", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}, {"indexed": false, "internalType": "bytes32", "name": "deliveryHash", "type": "bytes32"}, {"indexed": false, "internalType": "uint256", "name": "releaseAt", "type": "uint256"}], "name": "EscrowCreated", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "owner", "type": "address"}, {"indexed": false, "internalType": "string", "name": "name", "type": "string"}], "name": "FieldRegistered", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "owner", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "commitment", "type": "uint256"}], "name": "FieldVerified", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "escrowId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "enterprise", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}], "name": "OrderCancelled", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "user", "type": "address"}, {"indexed": true, "internalType": "address", "name": "enterprise", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "expiry", "type": "uint256"}, {"indexed": false, "internalType": "uint256", "name": "maxCalls", "type": "uint256"}], "name": "PermissionGranted", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "user", "type": "address"}, {"indexed": true, "internalType": "address", "name": "enterprise", "type": "address"}], "name": "PermissionRevoked", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "escrowId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "platform", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}], "name": "PlatformRevenuePaid", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "address", "name": "oldTreasury", "type": "address"}, {"indexed": true, "internalType": "address", "name": "newTreasury", "type": "address"}], "name": "PlatformTreasuryUpdated", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "fieldId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "user", "type": "address"}, {"indexed": true, "internalType": "address", "name": "enterprise", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}], "name": "RevenueDistributed", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "uint256", "name": "escrowId", "type": "uint256"}, {"indexed": true, "internalType": "address", "name": "user", "type": "address"}, {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"}], "name": "RevenueWithdrawn", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "bytes32", "name": "role", "type": "bytes32"}, {"indexed": true, "internalType": "bytes32", "name": "previousAdminRole", "type": "bytes32"}, {"indexed": true, "internalType": "bytes32", "name": "newAdminRole", "type": "bytes32"}], "name": "RoleAdminChanged", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "bytes32", "name": "role", "type": "bytes32"}, {"indexed": true, "internalType": "address", "name": "account", "type": "address"}, {"indexed": true, "internalType": "address", "name": "sender", "type": "address"}], "name": "RoleGranted", "type": "event"},
  {"anonymous": false, "inputs": [{"indexed": true, "internalType": "bytes32", "name": "role", "type": "bytes32"}, {"indexed": true, "internalType": "address", "name": "account", "type": "address"}, {"indexed": true, "internalType": "address", "name": "sender", "type": "address"}], "name": "RoleRevoked", "type": "event"},
  // ---------- 其他（4 个）----------,
  {"inputs": [{"internalType": "address", "name": "_platformTreasury", "type": "address"}, {"internalType": "address", "name": "_zkVerifier", "type": "address"}], "stateMutability": "nonpayable", "type": "constructor"},
  {"inputs": [], "name": "AccessControlBadConfirmation", "type": "error"},
  {"inputs": [{"internalType": "address", "name": "account", "type": "address"}, {"internalType": "bytes32", "name": "neededRole", "type": "bytes32"}], "name": "AccessControlUnauthorizedAccount", "type": "error"},
  {"inputs": [], "name": "ReentrancyGuardReentrantCall", "type": "error"}
];

// ---------------- 通用辅助函数 ----------------

// 钱包地址统一显示为 0x12...34 格式
export const shortAddr = (addr) => {
  if (!addr) return '';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
};

// 哈希 / 凭证统一显示为 0x1234...abcd 格式
export const shortHash = (h) => {
  if (!h || h === ethers.ZeroHash) return '';
  return `${h.slice(0, 8)}...${h.slice(-6)}`;
};

// 将 wei（bigint 字符串）格式化为 ETH 展示值，最多保留 4 位小数并去除末尾 0
export const fmtEth = (wei) => {
  try {
    const n = Number(ethers.formatEther(BigInt(wei)));
    const s = n.toFixed(4).replace(/\.?0+$/, '');
    return s === '' || s === '-' ? '0' : s;
  } catch {
    return '0';
  }
};

// 时间戳格式化（本地时区，精确到秒）
export const fmtTime = (ts) => {
  return new Date(Number(ts) * 1000).toLocaleString('zh-CN', { hour12: false });
};

// ============================================================
// ★ 链下数据载荷与交付凭证（业务闭环的关键一环）
// ------------------------------------------------------------
// 设计要点：
//   1. 原始数据永远留在链下，链上只存「数据摘要哈希」；
//   2. 交付凭证 deliveryHash = keccak256(链下数据载荷的 JSON)，
//      **链上哈希即链下数据的摘要** —— 任何一方都能重算比对，
//      从而验证「企业拿到的数据」与「链上存证」是否一致、有没有被篡改；
//   3. 演示环境的载荷由字段 ID 确定性生成（纯函数，双方算出的结果一致），
//      全部为模拟数据，不含任何真实个人信息。
// ============================================================

// ---------------- 链下存储（数据文件） ----------------
// ★ 数据本体存放在**链下**：`frontend/public/data/<分类>.json`。
//   - 这些文件**不参与前端打包**（放在 public/ 下，运行时用 fetch 读取），
//     所以它们确实是"外部的数据"，而不是被打进 bundle 的代码常量；
//   - 链上只保存两样极小的东西：`dataRef`（数据在哪，即索引）与 `deliveryHash`（内容摘要，即承诺）。
//
// 摘要的计算方式（务必保持稳定）：
//   digest = keccak256(JSON.stringify(解析后的对象))
//   取"规范化 JSON"而不是原始字节，是为了不受缩进与换行符影响 ——
//   跨平台、经 git 检出后都不会误判；而**任何内容改动都会被检出**。
//
// ⚠️ 不要改成 `import data from './xxx.json'`：那会被打包进产物，就不再是"链下数据"了。

export const DATA_DIR = 'data';

// ★ 部署基路径：必须拼在链下数据文件地址之前。
//   生产构建若部署到 git 子目录（如 gh-pages 的 /DataShare2026/），
//   `import.meta.env.BASE_URL` 就是 '/DataShare2026/'；本地开发为 '/'。
//   若这里用绝对根路径 `/data/xxx.json`，子目录部署下 fetch 会打到站点根目录而全部 404，
//   进而数据缓存为空 → buildDeliveryHash 返回空 → 企业端【直接调用】在预检阶段就被判
//   「该字段未关联链下数据文件」，根本走不到合约。zk.js 的证明产物路径同理，两者保持一致。
const _BASE = import.meta.env.BASE_URL || '/';
const _BASE_DIR = _BASE.endsWith('/') ? _BASE : `${_BASE}/`;

/// 数据文件的访问地址（链下存储的定位符，用于打开原始文件）
export const dataFileUrl = (dataRef) => {
  const ref = String(dataRef || '').trim();
  return ref ? `${_BASE_DIR}${DATA_DIR}/${encodeURIComponent(ref)}.json` : '';
};

// 运行时缓存：预加载一次，之后同步读取（筛选 / AI 匹配 / 调用都是同步逻辑）
const _dataCache = new Map();
let _loading = null;

/// 计算链下数据的摘要（链上凭证即此值）
/// ★ 摘要只覆盖业务数据：原文件内置的「图表」节是展示性元数据（供在线查看
///   快速浏览，前端不展示、各端可再生），统一剔除后不参与摘要 ——
///   这样在原文件加入图表节前后，同一份数据算出的摘要完全一致，
///   链上既有的交付凭证依旧可以校验通过。
export const hashPayload = (payload) => {
  const core = (payload && typeof payload === 'object' && !Array.isArray(payload))
    ? Object.fromEntries(Object.entries(payload).filter(([k]) => k !== '图表'))
    : payload;
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(core)));
};

/// 同步读取某个数据文件的内容（需先 loadDataCache 完成）
export const getDataPayload = (dataRef) => {
  const ref = String(dataRef || '').trim();
  return ref ? (_dataCache.get(ref) || null) : null;
};

/// 异步读取某个数据文件（页面展示「打开数据文件」前可用它确认可达）
export const fetchDataPayload = async (dataRef) => {
  const ref = String(dataRef || '').trim();
  if (!ref) return null;
  if (_dataCache.has(ref)) return _dataCache.get(ref);
  try {
    const res = await fetch(dataFileUrl(ref), { cache: 'no-store' });
    if (!res.ok) return null;
    const obj = await res.json();
    _dataCache.set(ref, obj);
    return obj;
  } catch {
    return null;
  }
};

/// 生成交付凭证：链上存证 = 链下数据文件的摘要
export const buildDeliveryHash = (dataRef) => {
  const payload = getDataPayload(dataRef);
  return payload ? hashPayload(payload) : '';
};

// 预加载已知的数据集清单（与 public/data/ 下的文件一一对应）
export const DATA_REFS = [
  // 与 public/data/ 下的文件一一对应（新增数据集：先放 JSON 文件，再把分类名加到这里）
  '消费偏好', '出行习惯', '购物偏好', '运动健康', '兴趣娱乐', '阅读学习', '饮食口味',
  '收入水平', '教育背景', '职业信息', '社交活跃', '设备偏好',
  '金融理财', '保险健康', '母婴育儿', '宠物生活', '汽车出行',
];

/// 加载全部链下数据集（幂等）
export const loadAllData = () => {
  if (!_loading) {
    _loading = (async () => {
      await Promise.all(DATA_REFS.map(async (ref) => {
        try {
          const res = await fetch(dataFileUrl(ref), { cache: 'no-store' });
          if (res.ok) _dataCache.set(ref, await res.json());
        } catch { /* 忽略单个失败 */ }
      }));
    })();
  }
  return _loading;
};

// ★ 秒数 -> 倒计时文案（托管争议窗口用）
export const fmtCountdown = (seconds) => {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (s <= 0) return '可提现';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m} 分 ${String(r).padStart(2, '0')} 秒后可提现` : `${r} 秒后可提现`;
};

// 无法识别的英文报错关键字
const UNKNOWN_EN_KEYWORDS = [
  'insufficient',
  'missing revert data',
  'execution reverted',
  'transaction reverted',
  'call revert',
  'could not decode',
  'bad data',
  'unexpected token',
  'internal json-rpc error',
  'cannot estimate gas',
  'call exception',
  'vm exception'
];

// 判断报错文案是否为"无法识别的英文 raw error"
export const isRawEnglishError = (text) => {
  if (!text) return true;
  const t = String(text).toLowerCase();
  if (UNKNOWN_EN_KEYWORDS.some((k) => t.includes(k))) return true;
  // 本项目的合约 require 文案全部是中文；不含中文的"原因"基本都是底层英文样板文本
  // （如 "VM Exception while processing transaction: revert"），对用户没有意义 → 判为原始错误、走兜底文案
  return !/[一-鿿]/.test(String(text));
};

// 解析合约交易报错，提取可读的中文错误信息
export const parseTxError = (err, fallback = '交易失败，请稍后重试') => {
  if (!err) return fallback;
  if (err.code === 4001) return '您取消了交易签名';
  if (err.reason && typeof err.reason === 'string' && err.reason.trim() && !isRawEnglishError(err.reason)) {
    return err.reason.trim();
  }
  // ★ 本地抛出的普通 Error（如 ZK 证明生成失败的「证明库加载失败…」）：
  //   中文 message 直接展示 —— 不加这一步会被最后的兜底文案吞成"交易失败，请稍后重试"
  if (typeof err.message === 'string' && err.message.trim() && !isRawEnglishError(err.message)) {
    return err.message.trim();
  }
  const raw = err.shortMessage || err.message || '';

  // 在任意一段文本里找 revert 原因（合约的中文 require 文案）
  const pick = (text) => {
    if (typeof text !== 'string' || !text) return '';
    const m = text.match(/execution reverted[^:]*: (.+)/) || text.match(/reverted with reason string '(.+)'/);
    if (m && m[1].trim() && !isRawEnglishError(m[1])) return m[1].trim();
    return '';
  };

  const direct = pick(raw) || pick(err.reason);
  if (direct) return direct;

  // ★ 钱包在「预估 gas」阶段就拒绝时，真正的原因埋在这些嵌套字段里 ——
  //   不挖出来，用户只会看到一句含糊的"交易失败，请稍后重试"（这个坑踩过）。
  const nested = [
    err.info && err.info.error && err.info.error.message,
    err.data && (typeof err.data === 'string' ? err.data : err.data.message),
    err.error && err.error.message,
    err.info && err.info.payload && err.info.payload.params,
  ];
  for (const t of nested) {
    const text = typeof t === 'string'
      ? t
      : (t && t[0] && typeof t[0].data === 'string' ? t[0].data : '');
    const got = pick(text);
    if (got) return got;
  }

  // 预估失败却拿不到原因时，给一句能指导行动的话，而不是"请稍后重试"
  const all = [raw, ...nested.filter((x) => typeof x === 'string')].join(' ');
  if (/cannot estimate gas|gas estimation|gas required exceeds/i.test(all)) {
    return '合约预判这笔交易会被拒绝（条件尚未满足或额度不足），交易未发出';
  }

  // ★ 网络 / 环境类错误：按场景给出可操作的排查指引（统一异常处理流程的一部分）。
  //   文案按当前网络参数化：本地 Ganache 提示启动本地节点；Sepolia 提示检查钱包网络。
  if (/Failed to fetch|ECONNREFUSED|network error|fetch failed|Invalid JSON RPC response|onchainconnect/i.test(all)) {
    return ACTIVE_NETWORK.key === 'ganache'
      ? `无法连接区块链节点：请确认 Ganache 正在 7545 端口运行，且 MetaMask 网络指向 ${NETWORKS.ganache.rpcUrl}（ChainID ${NETWORKS.ganache.chainId}）`
      : `无法连接 ${ACTIVE_NETWORK.label}：请检查钱包网络是否已切换到 ${ACTIVE_NETWORK.label}（ChainID ${ACTIVE_NETWORK.chainId}），并确认浏览器可访问外网`;
  }
  if (/insufficient (funds|balance)/i.test(all)) {
    return ACTIVE_NETWORK.key === 'ganache'
      ? '账户 ETH 余额不足以支付 Gas：请在 Ganache 中向当前账户转入测试 ETH'
      : `账户测试 ETH 余额不足以支付 Gas：请通过 Sepolia 水龙头领取测试币后重试`;
  }
  if (/nonce|already known|replacement transaction underpriced/i.test(all)) {
    return '交易重复或顺序冲突：请稍候 2 秒再试（上一笔可能仍在处理中）';
  }
  if (/429|rate limit|too many requests/i.test(all)) {
    return '节点请求过于频繁被限流：请稍候重试';
  }
  return fallback;
};

// ★ 全局异常广播：任何底层模块（如链上数据同步）都能把错误送进 App 顶部的统一 Banner，
//   避免只 console.error 的"静默失败"让用户误以为数据没同步
export const emitGlobalError = (text) => {
  try { window.dispatchEvent(new CustomEvent('ds-global-error', { detail: String(text) })); }
  catch (e) { console.error('全局异常广播失败', e); }
};

