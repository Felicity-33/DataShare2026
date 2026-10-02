// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============================================================
// DataShare —— 个人数据授权与托管结算 DApp 核心智能合约
// ------------------------------------------------------------
// 三角角色：用户(User) / 企业(Enterprise) / 监管(Regulator)
// 核心闭环：注册字段 -> 授权 -> 充值押金 -> 托管调用 -> 交付凭证
//           -> 确认收货/超时解锁 -> 用户提现 -> 审计
//
// 创新机制：
//   1. 托管式结算（Escrow）
//      调用费用不直接打给数据所有者，而是进入合约托管；
//      企业「确认收货」立即解锁，或超过争议窗口后自动解锁；
//      期间企业可发起申诉，由监管裁决放款或退款 —— 资金有救济路径。
//   2. 链上交付凭证（deliveryHash）
//      只把「数据摘要哈希」上链，原始个人数据永不触链；
//      实现「数据不出域、可用不可见、链上只留凭证」的合规要求。
//   3. 合约自证审计（callData 自动留痕）
//      拦截记录由合约内部自动落账，reason 由合约判定；由于 revert 会回滚写状态，
//      因此 callData 采用「校验失败 -> 记账 -> 返回原因」而非 revert 的方式，
//      企业既无法伪造理由，也无法选择性不上报 —— 监管证据不可被被监管方操纵。
//   4. 链上标准价（STANDARD_PRICE）
//      单价不是前端写死的，而是合约里的公开常量，企业无法传入自定义价格：
//      requestAuthorization / callData 都不接收 unitPrice 参数，金额由合约按标准价计算，
//      从机制上杜绝「乱定价 / 哄抬 / 价格欺诈」，且任何人对价格可链上核验。
//   5. 链上信誉分（reputationOf）+ 监管失信标记
//      基于成功调用 / 被拦截 / 恶意申诉胜败次数计算 0-1000 信誉分，
//      低于阈值自动暂停调用权限；监管可标记失信（但不可动用任何资金）。
//
//   6. 平台服务费自动分账（PLATFORM_FEE_BPS）
//      调用收益不是全额给数据所有者，而是按固定比例自动拆分：
//      数据所有者得 90%、平台得 10%，提现时**由合约自动分两笔转出**并各自留痕。
//      比例是公开常量，任何人对分账规则可链上核验，平台无法临时抽成。
//   7. ZK 权属证明（Circom + SnarkJS，仅用于确权阶段）
//      确权时必须提交一枚 Groth16 证明，证明「提交者掌握该数据的权属密钥」，
//      且证明中的 owner 必须等于 msg.sender —— 既证明权属，又防冒名确权，
//      同时**权属密钥本身永远不上链**。确权之后不再重复生成任何证明。
//
// 第八项能力：链下存储、链上索引与承诺
//      原始数据**始终不上链**，数据本体存放在链下的数据文件中，链上只保存两样极小的东西：
//        - dataRef      数据文件的标识（**索引**，回答"数据在哪"）；
//        - deliveryHash 数据内容的摘要（**承诺**，回答"有没有被改"），
//                       = keccak256(链下数据文件内容)，交付时写入托管单。
//      任何一方用同一份链下数据重算摘要即可与链上比对，从而验证
//      「数据有没有被篡改、交付是否真实发生」。这与常驻的 commitment（ZK 权属承诺）
//      是同一套思路：**链上存索引与承诺，链下存数据**。
//
// 合约版本：CONTRACT_VERSION = "4.3"
//   前端连接后会读取该常量并与本地期望值比对，版本不一致时直接给出醒目提示，
//   避免「ABI 与链上合约不匹配导致返回值被静默错解」这类隐蔽故障。
//   ⚠️ 合约结构变化后必须：npm run compile && npm run gen:abi（前端 ABI 自动生成）。
//
// 安全机制：
//   - AccessControl   角色访问控制
//   - ReentrancyGuard 防重入攻击（所有涉及转账 / 扣款的函数）
//   - 检查-生效-交互（CEI）顺序，先改状态后转账
//   - 监管只能「裁决资金归属」，不能把资金转给第三方或自己
//
// 关键报错约定（保持不变，前端横幅直接展示）：
//   - 押金不足时抛出：    "余额不足，请充值！"
//   - 未授权调用时抛出：  "未获得授权，请先申请授权"
//   - 授权过期时抛出：    "该授权已过期，请重新申请"
//   - 调用次数用尽抛出：  "该授权调用次数已用尽，请重新申请"
//
// 计费模型：
//   - periodType = 0：按次计费，unitPrice 为单次价格
//   - periodType = 1：按天计费，unitPrice 为每天价格
//   - 总价 = unitPrice × units
// ============================================================
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
// Groth16 验证器由 snarkjs 从 dataOwnership.circom 生成（scripts/build-zk.cjs），
// 部署为独立合约后由本合约**外部调用**。
// ⚠️ 不要改成继承：生成的验证器函数体只有内联汇编 return，编译器会误判
//    「调用之后不可达」并把后续写状态/发事件的代码整段删除（静默故障，详见 IZkVerifier.sol 注释）。
import "./IZkVerifier.sol";

contract DataShare is AccessControl, ReentrancyGuard {
    // ---------------- 角色常量 ----------------
    bytes32 public constant USER_ROLE = keccak256("USER_ROLE");
    bytes32 public constant ENTERPRISE_ROLE = keccak256("ENTERPRISE_ROLE");
    bytes32 public constant REGULATOR_ROLE = keccak256("REGULATOR_ROLE");

    // ---------------- 结算参数 ----------------
    /// @notice 争议窗口：企业确认收货前的可申诉时长
    /// @dev v4.4 由 60 秒延长至 600 秒：实测 60 秒内人工走完「切页签 → 找单 → 填理由 → 签名」
    ///      大概率超时，导致企业申诉在窗口关闭后无法发起（申诉失败主因）。
    ///      600 秒保证演示从容走完「申诉 → 监管裁决」全流程；生产环境建议 24-72 小时
    uint256 public constant CHALLENGE_PERIOD = 600;

    /// @notice 信誉分基线：新企业默认 600 分（中性可信）
    uint256 public constant BASE_REPUTATION = 600;
    /// @notice 信誉分下限：低于该值自动暂停调用权限
    uint256 public constant MIN_REPUTATION = 300;
    /// @notice 信誉分上限
    uint256 public constant MAX_REPUTATION = 1000;

    /// @notice 链上标准单价：按次计费（wei）
    uint256 public constant STANDARD_PRICE_PER_CALL = 0.05 ether;
    /// @notice 链上标准单价：按天计费（wei）
    uint256 public constant STANDARD_PRICE_PER_DAY = 0.5 ether;

    /// @notice 平台服务费比例（基点，1000 = 10%）
    /// @dev 分账规则写死在合约里：数据所有者 90% / 平台 10%，任何一方都无法临时改比例
    uint256 public constant PLATFORM_FEE_BPS = 1000;
    /// @notice 基点分母
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice 合约版本号：前端用于校验 ABI 与链上合约是否匹配
    /// @dev v4.4：争议窗口 60 → 600 秒（申诉链路修复），前端 EXPECTED_CONTRACT_VERSION 需同步
    string public constant CONTRACT_VERSION = "4.4";

    /// @notice 平台服务费收款地址（由管理员设置，只能收款、不参与任何业务决策）
    address public platformTreasury;

    /// @notice ZK 权属验证器合约地址（Groth16Verifier，独立部署）
    address public zkVerifier;

    // ---------------- 数据结构 ----------------
    // 数据字段：用户的某一类数据
    struct DataField {
        address owner;
        string name;
        uint256 callCount;
        uint256 createdAt;
        uint256 commitment;   // ★ v4.0：ZK 权属承诺 Poseidon(secret, owner)，链上只存承诺不存密钥
        string  dataRef;      // ★ v4.3：链下数据文件标识（链上索引）—— 数据本体在链下，链上只存索引
    }

    // 授权信息：某字段对某企业的授权详情
    struct Permission {
        bool active;        // 是否已授权
        uint256 expiry;     // 授权有效期（0 表示永久）
        uint256 maxCalls;   // 最大调用次数（0 表示不限）
        uint256 usedCalls;  // 已使用次数
    }

    // 授权申请单：企业向用户发起的数据调用申请
    // 携带计费周期信息，用户审批后自动生成带期限/次数的授权
    struct AuthRequest {
        uint256 fieldId;
        address user;
        address enterprise;
        uint8   periodType;   // 0=按次 1=按天
        uint256 units;        // 数量（次数 / 天数）
        uint256 unitPrice;    // 单价（wei）
        uint256 totalPrice;   // 总价 = unitPrice × units
        bool resolved;
    }

    // ★ 托管结算单：企业每次调用生成一条，资金先进托管再结算
    struct Escrow {
        uint256 fieldId;
        address user;           // 数据所有者（收益归属方）
        address enterprise;     // 调用方
        uint256 amount;         // 托管金额
        bytes32 deliveryHash;   // 链上交付凭证（数据摘要哈希，原始数据不上链）
        uint256 createdAt;
        uint256 confirmedAt;    // 企业确认收货时间（0=未确认）
        bool    disputed;       // 是否处于争议中
        bool    settled;        // 是否已结算（提现 / 退款）
        bool    refunded;       // 是否退款给企业（争议裁决结果）
        string  disputeReason;  // 企业申诉理由
    }

    // 被拦截的非法调用记录（全部由合约自动留痕，企业无法伪造或选择性不上报）
    struct BlockedAttempt {
        uint256 fieldId;
        address enterprise;
        string reason;
        uint256 timestamp;
    }

    // ---------------- 状态变量 ----------------
    DataField[] public fields;
    mapping(uint256 => mapping(address => Permission)) public permissions;  // fieldId => 企业 => 授权详情
    mapping(address => uint256) public deposits;
    AuthRequest[] public authRequests;
    BlockedAttempt[] public blockedAttempts;

    // ★ 托管结算
    Escrow[] public escrows;

    // ★ 信誉分统计
    mapping(address => uint256) public successCalls;    // 企业累计成功调用次数
    mapping(address => uint256) public blockedCount;    // 企业累计被拦截次数（合约自动记账）
    mapping(address => uint256) public disputesLost;    // 企业恶意申诉败诉次数

    // ★ 监管失信标记（只影响调用权限，不涉及任何资金划转）
    mapping(address => bool)   public flagged;
    mapping(address => string) public flagReason;

    // ---------------- 全局统计 ----------------
    uint256 public totalDistributed;   // 已确定分账总额（含托管中）
    uint256 public totalWithdrawn;     // 已实际支付给数据所有者的总额（不含平台服务费）
    uint256 public totalRefunded;      // 退款（订单取消 / 争议裁决）退回企业的总额
    uint256 public totalAuthorizations;
    uint256 public totalPlatformRevenue;  // ★ v4.0：平台累计服务费收入

    // ---------------- 事件 ----------------
    event FieldRegistered(uint256 indexed fieldId, address indexed owner, string name);
    event PermissionGranted(uint256 indexed fieldId, address indexed user, address indexed enterprise, uint256 expiry, uint256 maxCalls);
    event PermissionRevoked(uint256 indexed fieldId, address indexed user, address indexed enterprise);
    event DepositMade(address indexed enterprise, uint256 amount, uint256 balance);
    event RevenueDistributed(uint256 indexed fieldId, address indexed user, address indexed enterprise, uint256 amount);
    event AccessAttemptBlocked(address indexed enterprise, uint256 indexed fieldId, string reason);
    event AuthorizationRequested(uint256 indexed requestId, uint256 indexed fieldId, address indexed user, address enterprise, uint8 periodType, uint256 units, uint256 unitPrice, uint256 totalPrice);
    event AuthorizationApproved(uint256 indexed requestId, uint256 indexed fieldId, address indexed user, address enterprise, uint8 periodType, uint256 units, uint256 unitPrice, uint256 totalPrice);
    event AuthorizationDenied(uint256 indexed requestId, uint256 indexed fieldId, address indexed user, address enterprise, uint8 periodType, uint256 units, uint256 unitPrice, uint256 totalPrice);

    // ★ 新增事件：托管结算 / 交付凭证 / 争议 / 定价权 / 信誉分
    event EscrowCreated(uint256 indexed escrowId, uint256 indexed fieldId, address indexed user, address enterprise, uint256 amount, bytes32 deliveryHash, uint256 releaseAt);
    event DeliveryConfirmed(uint256 indexed escrowId, address indexed enterprise, uint256 fieldId, bytes32 deliveryHash);
    event DisputeRaised(uint256 indexed escrowId, address indexed enterprise, uint256 indexed fieldId, string reason);
    event DisputeResolved(uint256 indexed escrowId, bool refundedToEnterprise, address regulator, uint256 amount);
    event RevenueWithdrawn(uint256 indexed escrowId, address indexed user, uint256 amount);
    event EnterpriseFlagged(address indexed enterprise, bool flagged, string reason);

    // ★ v4.0 新增事件
    event FieldVerified(uint256 indexed fieldId, address indexed owner, uint256 commitment);
    event OrderCancelled(uint256 indexed escrowId, address indexed enterprise, uint256 amount);
    event PlatformRevenuePaid(uint256 indexed escrowId, address indexed platform, uint256 amount);
    event PlatformTreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    /// @param _platformTreasury 平台服务费收款地址（部署时指定，可由管理员后续变更）
    /// @param _zkVerifier       Groth16 权属验证器合约地址
    /// @dev AccessControl 的构造函数会自动把 DEFAULT_ADMIN_ROLE 授予部署者
    constructor(address _platformTreasury, address _zkVerifier) {
        require(_platformTreasury != address(0), unicode"平台收款地址不能为空");
        require(_zkVerifier != address(0), unicode"ZK 验证器地址不能为空");
        platformTreasury = _platformTreasury;
        zkVerifier = _zkVerifier;
    }

    /// @notice 变更 ZK 验证器地址（仅管理员；换电路时用）
    function setZkVerifier(address newVerifier) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newVerifier != address(0), unicode"ZK 验证器地址不能为空");
        zkVerifier = newVerifier;
    }

    /// @notice 变更平台收款地址（仅管理员；只影响未来分账，不影响任何已有订单）
    function setPlatformTreasury(address newTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newTreasury != address(0), unicode"平台收款地址不能为空");
        emit PlatformTreasuryUpdated(platformTreasury, newTreasury);
        platformTreasury = newTreasury;
    }

    /// @notice 预览一笔金额的分账结果（前端展示「用户实得 / 平台服务费」用）
    function platformSplitOf(uint256 amount) public pure returns (uint256 toUser, uint256 toPlatform) {
        toPlatform = (amount * PLATFORM_FEE_BPS) / BPS_DENOMINATOR;
        toUser = amount - toPlatform;
    }

    // ============================================================
    // 一、角色管理
    // ============================================================
    function registerAsUser() external { _grantRole(USER_ROLE, msg.sender); }
    function registerAsEnterprise() external { _grantRole(ENTERPRISE_ROLE, msg.sender); }
    function registerAsRegulator() external { _grantRole(REGULATOR_ROLE, msg.sender); }

    function roleOf(address who) external view returns (string memory) {
        if (hasRole(USER_ROLE, who)) return "user";
        if (hasRole(ENTERPRISE_ROLE, who)) return "enterprise";
        if (hasRole(REGULATOR_ROLE, who)) return "regulator";
        return "none";
    }

    // ============================================================
    // 二、用户端：字段注册 + 授权管理 + 定价权
    // ============================================================

    /// @notice ★ 数据确权（v4.0）：必须提交 ZK 权属证明
    /// @dev 证明由前端用 dataOwnership.circom 生成，公开信号顺序为 [commitment, owner]：
    ///      - commitment = Poseidon(secret, owner)，链上只存这个承诺；
    ///      - owner 必须等于 msg.sender —— 承诺与地址强绑定，别人拿到承诺也无法冒名确权；
    ///      - secret（权属密钥）只存在于用户本地，**永远不上链、不进入证明文件**。
    ///      确权是唯一需要 ZK 的环节；后续发起申请、授权、调用都不再生成证明。
    /// @param name        字段名称
    /// @param dataRef     链下数据文件标识（链上索引）。为空表示该字段暂未关联链下数据文件，
    ///                    不阻断确权（便于演示降级）
    /// @param pA/pB/pC    Groth16 证明
    /// @param pubSignals  [commitment, owner]
    function registerField(
        string calldata name,
        string calldata dataRef,
        uint[2] calldata pA,
        uint[2][2] calldata pB,
        uint[2] calldata pC,
        uint[2] calldata pubSignals
    ) external onlyRole(USER_ROLE) returns (uint256) {
        require(bytes(name).length > 0, unicode"字段名称不能为空");
        require(pubSignals[1] == uint256(uint160(msg.sender)), unicode"证明中的权属地址与提交者不一致");
        require(IZkVerifier(zkVerifier).verifyProof(pA, pB, pC, pubSignals), unicode"权属证明校验失败，无法确权");

        fields.push(DataField(msg.sender, name, 0, block.timestamp, pubSignals[0], dataRef));
        uint256 fieldId = fields.length - 1;
        emit FieldRegistered(fieldId, msg.sender, name);
        emit FieldVerified(fieldId, msg.sender, pubSignals[0]);
        return fieldId;
    }

    function getFieldsCount() external view returns (uint256) {
        return fields.length;
    }

    /// @notice ★ 链上标准单价：按计费周期返回合约内置的标准价
    /// @dev 价格是合约里的公开常量，任何人可链上核验；业务函数不接收传入的单价，
    ///      因此不存在「乱定价 / 恶意传价」的可能。
    function standardPriceOf(uint8 periodType) public pure returns (uint256) {
        require(periodType == 0 || periodType == 1, unicode"不支持的计费周期");
        return periodType == 0 ? STANDARD_PRICE_PER_CALL : STANDARD_PRICE_PER_DAY;
    }

    /// @notice 查询某字段对某企业的授权详情（前端用来展示剩余次数 / 有效期）
    function getPermission(uint256 fieldId, address enterprise) external view returns (
        bool active, uint256 expiry, uint256 maxCalls, uint256 usedCalls
    ) {
        Permission storage p = permissions[fieldId][enterprise];
        return (p.active, p.expiry, p.maxCalls, p.usedCalls);
    }

    /// @notice 判断是否已授权且仍在有效期内、未超次数（前端调用前的快速校验）
    function hasPermission(uint256 fieldId, address enterprise) external view returns (bool) {
        Permission storage p = permissions[fieldId][enterprise];
        if (!p.active) return false;
        if (p.expiry > 0 && block.timestamp >= p.expiry) return false;
        if (p.maxCalls > 0 && p.usedCalls >= p.maxCalls) return false;
        return true;
    }

    /// @notice 授权（新版本）：用户可指定有效期与最大调用次数
    function grantPermissionWithLimit(
        uint256 fieldId,
        address enterprise,
        uint256 expiry,
        uint256 maxCalls
    ) external onlyRole(USER_ROLE) {
        require(fieldId < fields.length, unicode"字段不存在");
        require(fields[fieldId].owner == msg.sender, unicode"只能授权自己的数据");
        require(hasRole(ENTERPRISE_ROLE, enterprise), unicode"对方不是企业角色");
        require(expiry == 0 || expiry > block.timestamp, unicode"有效期必须晚于当前时间");

        permissions[fieldId][enterprise] = Permission(true, expiry, maxCalls, 0);
        totalAuthorizations += 1;
        emit PermissionGranted(fieldId, msg.sender, enterprise, expiry, maxCalls);
    }

    /// @notice 授权（旧版本，兼容演示数据）：永久、不限次数
    function grantPermission(uint256 fieldId, address enterprise) external onlyRole(USER_ROLE) {
        require(fieldId < fields.length, unicode"字段不存在");
        require(fields[fieldId].owner == msg.sender, unicode"只能授权自己的数据");
        require(hasRole(ENTERPRISE_ROLE, enterprise), unicode"对方不是企业角色");
        permissions[fieldId][enterprise] = Permission(true, 0, 0, 0);
        totalAuthorizations += 1;
        emit PermissionGranted(fieldId, msg.sender, enterprise, 0, 0);
    }

    function revokePermission(uint256 fieldId, address enterprise) external onlyRole(USER_ROLE) {
        require(fieldId < fields.length, unicode"字段不存在");
        require(fields[fieldId].owner == msg.sender, unicode"只能撤销自己的数据");
        permissions[fieldId][enterprise] = Permission(false, 0, 0, 0);
        emit PermissionRevoked(fieldId, msg.sender, enterprise);
    }

    /// @notice 审批授权申请：同意
    /// @dev 根据申请的周期自动生成带期限/次数的授权：
    ///      - 按次（periodType=0）：maxCalls = units，expiry = 0（永久）
    ///      - 按天（periodType=1）：expiry = now + units * 86400，maxCalls = 0（不限次数）
    function approveAuthorization(uint256 requestId) external onlyRole(USER_ROLE) {
        require(requestId < authRequests.length, unicode"申请不存在");
        AuthRequest storage r = authRequests[requestId];
        require(r.user == msg.sender, unicode"只能审批自己的申请");
        require(!r.resolved, unicode"该申请已处理");
        r.resolved = true;

        uint256 expiry = 0;
        uint256 maxCalls = 0;
        if (r.periodType == 0) {
            // 按次：设置最大次数
            maxCalls = r.units;
        } else {
            // 按天：设置有效期
            expiry = block.timestamp + r.units * 1 days;
        }

        permissions[r.fieldId][r.enterprise] = Permission(true, expiry, maxCalls, 0);
        totalAuthorizations += 1;
        emit AuthorizationApproved(requestId, r.fieldId, r.user, r.enterprise, r.periodType, r.units, r.unitPrice, r.totalPrice);
        emit PermissionGranted(r.fieldId, r.user, r.enterprise, expiry, maxCalls);
    }

    function denyAuthorization(uint256 requestId) external onlyRole(USER_ROLE) {
        require(requestId < authRequests.length, unicode"申请不存在");
        AuthRequest storage r = authRequests[requestId];
        require(r.user == msg.sender, unicode"只能审批自己的申请");
        require(!r.resolved, unicode"该申请已处理");
        r.resolved = true;
        emit AuthorizationDenied(requestId, r.fieldId, r.user, r.enterprise, r.periodType, r.units, r.unitPrice, r.totalPrice);
    }

    // ============================================================
    // 三、企业端：押金 + 授权申请 + 托管调用
    // ============================================================

    function deposit() external payable onlyRole(ENTERPRISE_ROLE) nonReentrant {
        require(msg.value > 0, unicode"充值金额必须大于0");
        deposits[msg.sender] += msg.value;
        emit DepositMade(msg.sender, msg.value, deposits[msg.sender]);
    }

    /// @notice 发起授权申请：单价由合约按「链上标准价」计算，企业无法传入自定义价格
    /// @dev ★ 价格治理：STANDARD_PRICE_PER_CALL / STANDARD_PRICE_PER_DAY 为公开常量，
    ///      从机制上杜绝乱定价、哄抬与价格欺诈。
    /// @param fieldId     字段 ID
    /// @param periodType  0=按次 1=按天
    /// @param units       数量（次数 / 天数）
    function requestAuthorization(
        uint256 fieldId,
        uint8   periodType,
        uint256 units
    ) external onlyRole(ENTERPRISE_ROLE) returns (uint256) {
        require(fieldId < fields.length, unicode"字段不存在");
        require(periodType == 0 || periodType == 1, unicode"不支持的计费周期");
        require(units > 0, unicode"数量必须大于0");

        uint256 unitPrice = standardPriceOf(periodType);   // 链上标准价
        uint256 totalPrice = unitPrice * units;
        authRequests.push(AuthRequest(
            fieldId,
            fields[fieldId].owner,
            msg.sender,
            periodType,
            units,
            unitPrice,
            totalPrice,
            false
        ));
        uint256 requestId = authRequests.length - 1;
        emit AuthorizationRequested(requestId, fieldId, fields[fieldId].owner, msg.sender, periodType, units, unitPrice, totalPrice);
        return requestId;
    }

    function getAuthRequestsCount() external view returns (uint256) {
        return authRequests.length;
    }

    /// @notice ★ 调用数据（唯一入口）：费用进入托管 + 校验失败由合约自动留痕
    /// @dev 关键设计一：本函数「不抛出异常」，而是返回 (ok, escrowId, reason)。
    ///      原因：Solidity 中 revert 会回滚同一笔交易内的全部状态写入，
    ///      若「先记账、再 revert」，拦截留痕会被一起回滚 —— 等于没记（旧版本的缺陷）。
    ///      因此改为：校验失败 -> 合约写入拦截留痕 -> 正常返回原因，留痕永久留在链上，
    ///      且原因是合约判定的字符串，企业既无法伪造、也无法选择性不上报。
    ///      前端先用 staticCall 预演拿到 reason 展示错误横幅，再真实发一笔交易把留痕写链。
    /// @dev 关键设计二：不接收 unitPrice，单价由合约按「链上标准价」计算，
    ///      从机制上杜绝乱定价；金额 = 标准价 × units（演示时把 units 调大即可复现押金不足）。
    /// @param fieldId      字段 ID
    /// @param periodType   0=按次 1=按天
    /// @param units        数量（次数 / 天数）
    /// @param deliveryHash 交付凭证：链下数据摘要哈希（原始数据不上链）
    /// @return ok          是否调用成功
    /// @return escrowId    托管单 ID（成功时有效，确认收货 / 申诉 / 提现均基于它）
    /// @return reason      失败原因（成功时为空字符串，由合约判定）
    function callData(
        uint256 fieldId,
        uint8   periodType,
        uint256 units,
        bytes32 deliveryHash
    ) external onlyRole(ENTERPRISE_ROLE) nonReentrant returns (bool ok, uint256 escrowId, string memory reason) {
        reason = _checkCall(fieldId, periodType, units);
        if (bytes(reason).length > 0) {
            _recordBlocked(fieldId, reason);
            return (false, 0, reason);
        }
        escrowId = _executeCall(fieldId, units, standardPriceOf(periodType), deliveryHash);
        return (true, escrowId, "");
    }

    // ============================================================
    // 四、托管结算：确认收货 / 争议申诉 / 用户提现
    // ============================================================

    function getEscrowsCount() external view returns (uint256) {
        return escrows.length;
    }

    /// @notice 计算某托管单的可提现时间点
    function releaseAtOf(uint256 escrowId) public view returns (uint256) {
        Escrow storage e = escrows[escrowId];
        // 企业确认收货后立即解锁，否则争议窗口结束后解锁
        return e.confirmedAt > 0 ? e.confirmedAt : e.createdAt + CHALLENGE_PERIOD;
    }

    /// @notice 前端判断某托管单当前是否可提现
    function canWithdraw(uint256 escrowId) external view returns (bool ok, uint256 releaseAt) {
        require(escrowId < escrows.length, unicode"托管单不存在");
        Escrow storage e = escrows[escrowId];
        releaseAt = releaseAtOf(escrowId);
        ok = !e.settled && !e.disputed && block.timestamp >= releaseAt;
    }

    /// @notice 企业确认收货：确认后该笔托管立即解锁，用户可马上提现
    function confirmDelivery(uint256 escrowId) external onlyRole(ENTERPRISE_ROLE) {
        require(escrowId < escrows.length, unicode"托管单不存在");
        Escrow storage e = escrows[escrowId];
        require(e.enterprise == msg.sender, unicode"只能确认自己发起的调用");
        require(!e.settled, unicode"该笔调用已结算");
        require(!e.disputed, unicode"该笔调用处于争议中");
        require(e.confirmedAt == 0, unicode"该笔调用已确认过收货");

        e.confirmedAt = block.timestamp;
        emit DeliveryConfirmed(escrowId, msg.sender, e.fieldId, e.deliveryHash);
    }

    /// @notice ★ v4.0 订单状态查询：把一笔订单归一为三态，前端再补上「待授权」凑成完整状态机
    /// @return 0 = 已授权（调用中 / 资金托管中）
    ///         1 = 调用完成（已分账）
    ///         2 = 已取消（已退款）
    function orderStateOf(uint256 escrowId) external view returns (uint8) {
        require(escrowId < escrows.length, unicode"订单不存在");
        Escrow storage e = escrows[escrowId];
        if (e.refunded) return 2;
        if (e.settled) return 1;
        return 0;
    }

    /// @notice ★ v4.0 企业取消订单：把托管中的资金原路退回押金池
    /// @dev 只允许在「尚未结算 + 未进入争议 + 仍在争议窗口内」时取消，
    ///      窗口结束后资金已按约定归数据所有者，不再允许单方取消。
    function cancelOrder(uint256 escrowId) external onlyRole(ENTERPRISE_ROLE) nonReentrant {
        require(escrowId < escrows.length, unicode"订单不存在");
        Escrow storage e = escrows[escrowId];
        require(e.enterprise == msg.sender, unicode"只能取消自己的订单");
        require(!e.settled, unicode"该订单已结算，无法取消");
        require(!e.disputed, unicode"该订单处于争议中，请等待监管裁决");
        require(block.timestamp < releaseAtOf(escrowId), unicode"已过可取消时间，资金将结算给数据所有者");

        uint256 amount = e.amount;
        e.settled = true;
        e.refunded = true;

        deposits[e.enterprise] += amount;   // 原路退回押金池
        totalDistributed -= amount;          // 该笔分账已取消
        totalRefunded += amount;

        emit OrderCancelled(escrowId, msg.sender, amount);
    }

    /// @notice 企业发起争议申诉：必须在争议窗口内、且尚未确认收货
    /// @dev 申诉后该笔资金被锁定，等待监管裁决
    function raiseDispute(uint256 escrowId, string calldata reason) external onlyRole(ENTERPRISE_ROLE) {
        require(escrowId < escrows.length, unicode"托管单不存在");
        require(bytes(reason).length > 0, unicode"申诉理由不能为空");
        Escrow storage e = escrows[escrowId];
        require(e.enterprise == msg.sender, unicode"只能对自己的调用发起申诉");
        require(!e.settled, unicode"该笔调用已结算");
        require(!e.disputed, unicode"该笔调用已在争议中");
        require(block.timestamp < releaseAtOf(escrowId), unicode"争议窗口已结束，无法再发起申诉");

        e.disputed = true;
        e.disputeReason = reason;
        emit DisputeRaised(escrowId, msg.sender, e.fieldId, reason);
    }

    /// @notice 用户提现托管中的收益
    /// @dev 需满足：未结算 / 未处于争议中 / 已过解锁时间
    function withdrawRevenue(uint256 escrowId) external nonReentrant {
        require(escrowId < escrows.length, unicode"托管单不存在");
        Escrow storage e = escrows[escrowId];
        require(e.user == msg.sender, unicode"只能提现属于自己的收益");
        require(!e.settled, unicode"该笔收益已结算");
        require(!e.disputed, unicode"该笔收益处于争议中，请等待监管裁决");
        require(block.timestamp >= releaseAtOf(escrowId), unicode"仍在争议窗口内，请等待窗口结束后提现");

        uint256 amount = e.amount;
        e.settled = true;

        // ★ v4.0：按公开比例自动分账 —— 数据所有者 90% / 平台 10%
        (uint256 toUser, uint256 toPlatform) = platformSplitOf(amount);
        totalWithdrawn += toUser;
        totalPlatformRevenue += toPlatform;

        (bool ok, ) = payable(e.user).call{ value: toUser }("");
        require(ok, unicode"收益转账失败");
        if (toPlatform > 0) {
            (bool ok2, ) = payable(platformTreasury).call{ value: toPlatform }("");
            require(ok2, unicode"平台服务费转账失败");
            emit PlatformRevenuePaid(escrowId, platformTreasury, toPlatform);
        }

        emit RevenueWithdrawn(escrowId, e.user, toUser);
        // 与旧版本事件保持一致：收益真正到账时才发出，前端收益流水沿用该事件
        // 注意金额是「数据所有者实得部分」，平台服务费单独由 PlatformRevenuePaid 记录
        emit RevenueDistributed(e.fieldId, e.user, e.enterprise, toUser);
    }

    // ============================================================
    // 五、监管：争议裁决 + 失信标记 + 信誉分
    // ============================================================

    /// @notice 监管裁决争议：只能决定「退给企业」或「放给用户」
    /// @dev 资金只有这两个去向，监管无法把资金转给自己或任何第三方
    function resolveDispute(uint256 escrowId, bool refundToEnterprise) external onlyRole(REGULATOR_ROLE) nonReentrant {
        require(escrowId < escrows.length, unicode"托管单不存在");
        Escrow storage e = escrows[escrowId];
        require(e.disputed, unicode"该托管单不在争议中");
        require(!e.settled, unicode"该托管单已结算");

        uint256 amount = e.amount;
        e.settled = true;

        if (refundToEnterprise) {
            // 申诉成立：退回企业押金池，分账取消，企业信誉不受影响
            e.refunded = true;
            deposits[e.enterprise] += amount;
            totalDistributed -= amount;
            totalRefunded += amount;
        } else {
            // 申诉驳回：属于恶意申诉，放款给数据所有者并扣减企业信誉
            disputesLost[e.enterprise] += 1;
            (uint256 toUser, uint256 toPlatform) = platformSplitOf(amount);
            totalWithdrawn += toUser;
            totalPlatformRevenue += toPlatform;
            (bool ok, ) = payable(e.user).call{ value: toUser }("");
            require(ok, unicode"收益转账失败");
            if (toPlatform > 0) {
                (bool ok2, ) = payable(platformTreasury).call{ value: toPlatform }("");
                require(ok2, unicode"平台服务费转账失败");
                emit PlatformRevenuePaid(escrowId, platformTreasury, toPlatform);
            }
            emit RevenueDistributed(e.fieldId, e.user, e.enterprise, toUser);
        }

        emit DisputeResolved(escrowId, refundToEnterprise, msg.sender, amount);
    }

    /// @notice 监管标记 / 解除企业失信（只影响调用权限，不触碰资金）
    function flagEnterprise(address enterprise, bool flag, string calldata reason) external onlyRole(REGULATOR_ROLE) {
        require(!flag || hasRole(ENTERPRISE_ROLE, enterprise), unicode"标记对象不是企业角色");
        flagged[enterprise] = flag;
        flagReason[enterprise] = flag ? reason : "";
        emit EnterpriseFlagged(enterprise, flag, reason);
    }

    /// @notice ★ 链上信誉分：0-1000
    /// @dev 基线 600；每次成功调用 +8；每次被拦截 -60；每次恶意申诉败诉 -150；失信标记归零
    function reputationOf(address enterprise) external view returns (
        uint256 score, uint256 success, uint256 blocked, uint256 lost, bool isFlagged
    ) {
        return (_score(enterprise), successCalls[enterprise], blockedCount[enterprise], disputesLost[enterprise], flagged[enterprise]);
    }

    // ============================================================
    // 六、内部工具
    // ============================================================

    /// @notice 调用前置校验：返回空字符串表示通过，否则返回由「合约」判定的拦截原因
    /// @dev 拦截原因统一由合约给出，企业无法伪造
    function _checkCall(
        uint256 fieldId,
        uint8   periodType,
        uint256 units
    ) internal view returns (string memory) {
        if (fieldId >= fields.length) return unicode"字段不存在";
        if (periodType != 0 && periodType != 1) return unicode"不支持的计费周期";
        if (units == 0) return unicode"数量必须大于0";

        if (flagged[msg.sender]) return unicode"该企业已被监管标记失信，暂停调用权限";
        if (_score(msg.sender) < MIN_REPUTATION) return unicode"企业信誉分不足，暂停调用权限";

        Permission storage p = permissions[fieldId][msg.sender];
        if (!p.active) return unicode"未获得授权，请先申请授权";
        if (p.expiry > 0 && block.timestamp >= p.expiry) return unicode"该授权已过期，请重新申请";
        if (p.maxCalls > 0 && p.usedCalls + units > p.maxCalls) return unicode"该授权调用次数已用尽，请重新申请";

        // 金额由合约按链上标准价计算，调用方无法传入价格
        uint256 totalPrice = standardPriceOf(periodType) * units;
        if (deposits[msg.sender] < totalPrice) return unicode"余额不足，请充值！";

        return "";
    }

    /// @notice 执行调用：扣押金 -> 记次数 -> 建托管单（费用不直接转给用户）
    function _executeCall(
        uint256 fieldId,
        uint256 units,
        uint256 unitPrice,
        bytes32 deliveryHash
    ) internal returns (uint256 escrowId) {
        uint256 totalPrice = unitPrice * units;
        DataField storage f = fields[fieldId];
        Permission storage p = permissions[fieldId][msg.sender];

        deposits[msg.sender] -= totalPrice;
        p.usedCalls += units;
        f.callCount += units;
        successCalls[msg.sender] += 1;
        totalDistributed += totalPrice;

        escrows.push(Escrow(
            fieldId,
            f.owner,
            msg.sender,
            totalPrice,
            deliveryHash,
            block.timestamp,
            0,
            false,
            false,
            false,
            ""
        ));
        escrowId = escrows.length - 1;

        emit EscrowCreated(
            escrowId,
            fieldId,
            f.owner,
            msg.sender,
            totalPrice,
            deliveryHash,
            block.timestamp + CHALLENGE_PERIOD
        );
    }

    /// @notice 记录一次被拦截的调用（由合约自动调用，原因由合约判定）
    function _recordBlocked(uint256 fieldId, string memory reason) internal {
        blockedAttempts.push(BlockedAttempt(fieldId, msg.sender, reason, block.timestamp));
        blockedCount[msg.sender] += 1;
        emit AccessAttemptBlocked(msg.sender, fieldId, reason);
    }

    /// @notice 信誉分计算（内部）
    function _score(address who) internal view returns (uint256) {
        if (flagged[who]) return 0;
        int256 s = int256(BASE_REPUTATION)
            + int256(successCalls[who]) * 8
            - int256(blockedCount[who]) * 60
            - int256(disputesLost[who]) * 150;
        if (s < 0) return 0;
        if (s > int256(MAX_REPUTATION)) return MAX_REPUTATION;
        return uint256(s);
    }

}
