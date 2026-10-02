// ============================================================
// DataShare 核心业务测试（Hardhat 内置网络 + Ethers.js v6）
// ------------------------------------------------------------
// 运行命令：npx hardhat test
//
// 覆盖范围（v4.0 订单闭环）：
//   1. 角色访问控制 / ZK 权属确权 / 合约版本号
//   2. 链上标准价：价格由合约常量决定，业务函数不接收 unitPrice
//   3. 押金充值
//   4. 托管调用：押金扣除、资金进托管、用户余额「不变」
//   5. 提前结算 -> 立即解锁 -> 用户提现 -> 收益到账（按 90/10 自动分账）
//   6. 争议窗口内不可提现 / 超时自动解锁
//   7. 争议申诉 -> 监管裁决（放款给数据所有者 / 退款给企业）
//   8. 合约自证审计：失败不 revert、自动留痕、原因由合约判定
//   9. 链上信誉分：成功加分、拦截扣分、失信归零、低于阈值暂停
//  10. 监管边界：不可动用资金、非监管不可裁决
//  11. 平台分账：比例由常量决定、提现时自动拆分、退款不抽费
//  12. 订单取消与订单状态机：窗口内可取消原路退款、超时后不可取消
// ============================================================
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { registerFieldWithZk, deploySystem } = require("./helpers/zk");

describe("DataShare —— 个人数据授权与托管结算", function () {
  let dv;
  let deployer, user, user2, enterprise, regulator, platform;
  let pfUser;   // 用户A 确权时生成的证明（含 commitment），供断言比对
  const ETHER = ethers.parseEther;
  const PROOF = ethers.keccak256(ethers.toUtf8Bytes("mock-payload-digest-v1"));
  // 链上标准价（与合约常量一致）
  const P_CALL = ETHER("0.05");
  const P_DAY = ETHER("0.5");
  // 常用数量：4 次 × 0.05 = 0.2 ETH（对应演示里的 0.2 ETH 调用）
  const U4 = 4;
  // 余额不足用：30 次 × 0.05 = 1.5 ETH > 1 ETH 押金
  const U_BIG = 30;
  // 占位证明：只用于测权限的用例 —— AccessControl 的修饰符会先于验签就 revert
  const DUMMY = { pA: [0n, 0n], pB: [[0n, 0n], [0n, 0n]], pC: [0n, 0n], pub: [0n, 0n] };
  const reg = (c, name, dataRef = '') => c.registerField(name, dataRef, DUMMY.pA, DUMMY.pB, DUMMY.pC, DUMMY.pub);

  beforeEach(async function () {
    [deployer, user, user2, enterprise, regulator, platform] = await ethers.getSigners();

    // v4.0：先部署 Groth16 验证器，再用「平台收款地址 + 验证器地址」部署 DataShare
    ({ dv } = await deploySystem(platform.address));

    await (await dv.connect(user).registerAsUser()).wait();
    await (await dv.connect(user2).registerAsUser()).wait();
    await (await dv.connect(enterprise).registerAsEnterprise()).wait();
    await (await dv.connect(regulator).registerAsRegulator()).wait();

    // 用户A 用 ZK 权属证明确权「消费偏好」，并授权给演示企业
    pfUser = await registerFieldWithZk(dv, user, "消费偏好", 10001n, "消费偏好");
    await (await dv.connect(user).grantPermission(0, enterprise.address)).wait();
    // 企业充值 1 ETH 押金
    await (await dv.connect(enterprise).deposit({ value: ETHER("1") })).wait();
  });

  // ============================================================
  // 1. 角色访问控制
  // ============================================================
  describe("角色访问控制", function () {
    it("非用户角色不能注册数据字段", async function () {
      await expect(reg(dv.connect(enterprise), "x"))
        .to.be.revertedWithCustomError(dv, "AccessControlUnauthorizedAccount");
    });

    it("非企业角色不能充值押金", async function () {
      await expect(dv.connect(user).deposit({ value: ETHER("1") }))
        .to.be.revertedWithCustomError(dv, "AccessControlUnauthorizedAccount");
    });

    it("非企业角色不能调用数据", async function () {
      await expect(dv.connect(user).callData(0, 0, 1, PROOF))
        .to.be.revertedWithCustomError(dv, "AccessControlUnauthorizedAccount");
    });

    it("非监管角色不能裁决争议", async function () {
      await expect(dv.connect(enterprise).resolveDispute(0, true))
        .to.be.revertedWithCustomError(dv, "AccessControlUnauthorizedAccount");
    });

    it("非监管角色不能标记企业失信", async function () {
      await expect(dv.connect(user).flagEnterprise(enterprise.address, true, "x"))
        .to.be.revertedWithCustomError(dv, "AccessControlUnauthorizedAccount");
    });

    it("roleOf 正确返回角色字符串", async function () {
      expect(await dv.roleOf(user.address)).to.equal("user");
      expect(await dv.roleOf(enterprise.address)).to.equal("enterprise");
      expect(await dv.roleOf(regulator.address)).to.equal("regulator");
      expect(await dv.roleOf(deployer.address)).to.equal("none");
    });
  });

  // ============================================================
  // 2. 字段注册 + 合约版本 + 链上标准价
  // ============================================================
  describe("字段注册与链上标准价", function () {
    it("注册字段产生 FieldRegistered 事件", async function () {
      const evs = await dv.queryFilter("FieldRegistered");
      const ev = evs[evs.length - 1];
      expect(ev.args.fieldId).to.equal(0n);
      expect(ev.args.owner).to.equal(user.address);
      expect(ev.args.name).to.equal("消费偏好");
      expect(await dv.getFieldsCount()).to.equal(1n);

      // v4.0：确权必须同时发出 FieldVerified（权属证明已通过链上校验）
      const vEvs = await dv.queryFilter("FieldVerified");
      expect(vEvs.length).to.equal(1);
      expect(vEvs[0].args.owner).to.equal(user.address);
      expect(vEvs[0].args.commitment).to.equal(pfUser.commitment);
      // DataField 结构：owner / name / callCount / createdAt / commitment / dataRef（6 项）
      const f = await dv.fields(0);
      expect(f.length).to.equal(6);
      expect(f.owner).to.equal(user.address);
      // 确权时写入的权属承诺，必须与「生成证明时用的那个承诺」逐位相同
      expect(f.commitment).to.equal(pfUser.commitment);
      // v4.3：链上索引 dataRef 必须原样写入（链下数据文件的标识）
      expect(f.dataRef).to.equal("消费偏好");
      expect(f.commitment).to.not.equal(0n);
      // 承诺与所有者地址绑定：同一个 secret 换个地址会得到不同的承诺
      const { commitmentOf } = require("./helpers/zk");
      const other = await commitmentOf(10001n, user2.address);
      expect(other).to.not.equal(f.commitment);
    });

    it("字段名称不能为空", async function () {
      await expect(reg(dv.connect(user), "")).to.be.revertedWith("字段名称不能为空");
    });

    it("合约版本号可链上核验（前端据此校验 ABI 是否匹配）", async function () {
      expect(await dv.CONTRACT_VERSION()).to.equal("4.4");
    });

    it("标准单价由合约常量决定，按次 0.05 / 按天 0.5", async function () {
      expect(await dv.STANDARD_PRICE_PER_CALL()).to.equal(P_CALL);
      expect(await dv.STANDARD_PRICE_PER_DAY()).to.equal(P_DAY);
      expect(await dv.standardPriceOf(0)).to.equal(P_CALL);
      expect(await dv.standardPriceOf(1)).to.equal(P_DAY);
    });

    it("不支持的计费周期会被拒绝", async function () {
      await expect(dv.standardPriceOf(2)).to.be.revertedWith("不支持的计费周期");
    });

    it("授权申请金额完全由合约计算（企业无法传入价格）", async function () {
      // requestAuthorization 只接收 fieldId / periodType / units 三个参数
      await (await dv.connect(enterprise).requestAuthorization(0, 0, 3)).wait();
      const req = await dv.authRequests(0);
      expect(req.unitPrice).to.equal(P_CALL);        // 单价 = 链上标准价
      expect(req.totalPrice).to.equal(P_CALL * 3n);  // 总价 = 标准价 × 数量
      expect(req.units).to.equal(3n);
    });
  });

  // ============================================================
  // 3. 授权 / 撤销 / 申请审批
  // ============================================================
  describe("授权管理", function () {
    it("只能授权给企业角色", async function () {
      await expect(dv.connect(user).grantPermission(0, user2.address))
        .to.be.revertedWith("对方不是企业角色");
    });

    it("非字段所有者不能授权", async function () {
      await expect(dv.connect(user2).grantPermission(0, enterprise.address))
        .to.be.revertedWith("只能授权自己的数据");
    });

    it("撤销授权后 hasPermission 返回 false", async function () {
      await (await dv.connect(user).revokePermission(0, enterprise.address)).wait();
      expect(await dv.hasPermission(0, enterprise.address)).to.equal(false);
    });

    it("充值金额必须大于 0", async function () {
      await expect(dv.connect(enterprise).deposit({ value: 0 }))
        .to.be.revertedWith("充值金额必须大于0");
    });

    it("企业发起申请，用户同意后获得带期限/次数的授权", async function () {
      await (await dv.connect(enterprise).requestAuthorization(0, 0, 3)).wait();
      await (await dv.connect(user).approveAuthorization(0)).wait();
      const perm = await dv.getPermission(0, enterprise.address);
      expect(perm.active).to.equal(true);
      expect(perm.maxCalls).to.equal(3n);   // 按次：最大次数 = units
      expect(perm.expiry).to.equal(0n);
      expect(await dv.hasPermission(0, enterprise.address)).to.equal(true);
    });

    it("按天申请审批后生成有效期授权", async function () {
      await (await dv.connect(enterprise).requestAuthorization(0, 1, 2)).wait();
      await (await dv.connect(user).approveAuthorization(0)).wait();
      const perm = await dv.getPermission(0, enterprise.address);
      expect(perm.active).to.equal(true);
      expect(perm.maxCalls).to.equal(0n);
      expect(perm.expiry).to.be.greaterThan(0n);
    });

    it("用户拒绝后不授予权限", async function () {
      // 先撤销基线授权，才能验证「拒绝 = 不新增授权」
      await (await dv.connect(user).revokePermission(0, enterprise.address)).wait();
      await (await dv.connect(enterprise).requestAuthorization(0, 1, 2)).wait();
      await (await dv.connect(user).denyAuthorization(0)).wait();
      expect(await dv.hasPermission(0, enterprise.address)).to.equal(false);
      const req = await dv.authRequests(0);
      expect(req.resolved).to.equal(true);
    });

    it("非申请用户不能审批他人的申请", async function () {
      await registerFieldWithZk(dv, user2, "购物偏好", 20002n);
      await (await dv.connect(enterprise).requestAuthorization(1, 0, 1)).wait();
      await expect(dv.connect(user).denyAuthorization(0)).to.be.revertedWith("只能审批自己的申请");
    });
  });

  // ============================================================
  // 4. 托管调用：钱不直接给用户，先进合约托管
  // ============================================================
  describe("托管式调用结算", function () {
    it("调用成功后：押金扣除、金额进入托管、用户余额不变、生成交付凭证", async function () {
      const userBefore = await ethers.provider.getBalance(user.address);

      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();

      // 用户余额「没有」变化 —— 钱在托管里，不是立即到账
      expect(await ethers.provider.getBalance(user.address)).to.equal(userBefore);
      // 企业押金扣除 4 × 0.05 = 0.2 ETH
      expect(await dv.deposits(enterprise.address)).to.equal(ETHER("0.8"));
      // 托管单已生成，金额与凭证正确
      expect(await dv.getEscrowsCount()).to.equal(1n);
      const e = await dv.escrows(0);
      expect(e.fieldId).to.equal(0n);
      expect(e.user).to.equal(user.address);
      expect(e.enterprise).to.equal(enterprise.address);
      expect(e.amount).to.equal(ETHER("0.2"));
      expect(e.deliveryHash).to.equal(PROOF);
      // 字段调用次数 +4，分账总额累计
      expect((await dv.fields(0)).callCount).to.equal(4n);
      expect(await dv.totalDistributed()).to.equal(ETHER("0.2"));
      // EscrowCreated 事件
      const evs = await dv.queryFilter("EscrowCreated");
      const ev = evs[evs.length - 1];
      expect(ev.args.amount).to.equal(ETHER("0.2"));
      expect(ev.args.deliveryHash).to.equal(PROOF);
      expect(ev.args.user).to.equal(user.address);
    });

    it("企业确认收货后用户可立即提现，收益才真正到账", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      // 未确认 + 窗口内：不可提现
      let [ok] = await dv.canWithdraw(0);
      expect(ok).to.equal(false);
      await expect(dv.connect(user).withdrawRevenue(0))
        .to.be.revertedWith("仍在争议窗口内，请等待窗口结束后提现");

      // 企业确认收货 -> 立即解锁
      await (await dv.connect(enterprise).confirmDelivery(0)).wait();
      [ok] = await dv.canWithdraw(0);
      expect(ok).to.equal(true);

      const before = await ethers.provider.getBalance(user.address);
      const rc = await (await dv.connect(user).withdrawRevenue(0)).wait();
      const gasUsed = rc.gasUsed * rc.gasPrice; // 提现由用户发起，需扣除自己支付的 gas
      const after = await ethers.provider.getBalance(user.address);
      // v4.0：按 90/10 分账，用户实得 0.18 ETH（0.2 × 90%）
      expect(after - before).to.equal(ETHER("0.18") - gasUsed);

      // 收益到账事件（前端收益流水沿用该事件）—— 金额是「数据所有者实得部分」
      const evs = await dv.queryFilter("RevenueDistributed");
      const ev = evs[evs.length - 1];
      expect(ev.args.user).to.equal(user.address);
      expect(ev.args.amount).to.equal(ETHER("0.18"));
      expect(await dv.totalWithdrawn()).to.equal(ETHER("0.18"));
      // 平台服务费单独留痕
      expect(await dv.totalPlatformRevenue()).to.equal(ETHER("0.02"));

      // 不可重复提现
      await expect(dv.connect(user).withdrawRevenue(0)).to.be.revertedWith("该笔收益已结算");
    });

    it("企业不确认时，超过争议窗口自动解锁可提现", async function () {
      // 按天计费：1 天 × 0.5 = 0.5 ETH
      await (await dv.connect(enterprise).callData(0, 1, 1, PROOF)).wait();
      await time.increase(601); // CHALLENGE_PERIOD = 600（v4.4 由 60 秒延长）

      const [ok] = await dv.canWithdraw(0);
      expect(ok).to.equal(true);
      const before = await ethers.provider.getBalance(user.address);
      const rc = await (await dv.connect(user).withdrawRevenue(0)).wait();
      const gasUsed = rc.gasUsed * rc.gasPrice;
      // 0.5 ETH 同样按 90/10 拆分，用户实得 0.45
      expect((await ethers.provider.getBalance(user.address)) - before).to.equal(ETHER("0.45") - gasUsed);
    });

    it("只有数据所有者本人能提现自己的托管收益", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      await (await dv.connect(enterprise).confirmDelivery(0)).wait();
      await expect(dv.connect(user2).withdrawRevenue(0))
        .to.be.revertedWith("只能提现属于自己的收益");
    });

    it("按次授权用尽后继续调用会被拦截", async function () {
      await (await dv.connect(user).revokePermission(0, enterprise.address)).wait();
      await (await dv.connect(enterprise).requestAuthorization(0, 0, 2)).wait();
      await (await dv.connect(user).approveAuthorization(0)).wait();

      await (await dv.connect(enterprise).callData(0, 0, 2, PROOF)).wait();
      const [ok, , reason] = await dv.connect(enterprise).callData.staticCall(0, 0, 1, PROOF);
      expect(ok).to.equal(false);
      expect(reason).to.equal("该授权调用次数已用尽，请重新申请");
    });
  });

  // ============================================================
  // 5. 合约自证审计：失败不 revert、自动留痕
  // ============================================================
  describe("合约自证审计（拦截自动留痕）", function () {
    it("押金不足：调用不抛出异常、返回原因、并自动写入链上留痕", async function () {
      // 押金 1 ETH，30 次 × 0.05 = 1.5 ETH 必然不足
      const [ok, escrowId, reason] = await dv.connect(enterprise).callData.staticCall(0, 0, U_BIG, PROOF);
      expect(ok).to.equal(false);
      expect(escrowId).to.equal(0n);
      expect(reason).to.equal("余额不足，请充值！");

      // 真实发交易：交易成功（不回滚），留痕永久上链
      await (await dv.connect(enterprise).callData(0, 0, U_BIG, PROOF)).wait();

      const blk = await dv.blockedAttempts(0);
      expect(blk.fieldId).to.equal(0n);
      expect(blk.enterprise).to.equal(enterprise.address);
      // 原因由「合约」给出，企业无法伪造
      expect(blk.reason).to.equal("余额不足，请充值！");
      // 被拦截次数自动记账，且没有生成托管单、押金未变动
      expect(await dv.blockedCount(enterprise.address)).to.equal(1n);
      expect(await dv.getEscrowsCount()).to.equal(0n);
      expect(await dv.deposits(enterprise.address)).to.equal(ETHER("1"));

      const evs = await dv.queryFilter("AccessAttemptBlocked");
      const ev = evs[evs.length - 1];
      expect(ev.args.enterprise).to.equal(enterprise.address);
      expect(ev.args.reason).to.equal("余额不足，请充值！");
    });

    it("未授权调用被自动留痕", async function () {
      await (await dv.connect(user).revokePermission(0, enterprise.address)).wait();
      await (await dv.connect(enterprise).callData(0, 0, 1, PROOF)).wait();
      const blk = await dv.blockedAttempts(0);
      expect(blk.reason).to.equal("未获得授权，请先申请授权");
      expect(await dv.blockedCount(enterprise.address)).to.equal(1n);
    });

    it("授权过期被自动留痕", async function () {
      await (await dv.connect(user).revokePermission(0, enterprise.address)).wait();
      const expiry = (await time.latest()) + 10;
      await (await dv.connect(user).grantPermissionWithLimit(0, enterprise.address, expiry, 0)).wait();
      await time.increaseTo(expiry + 1);
      await (await dv.connect(enterprise).callData(0, 0, 1, PROOF)).wait();
      const blk = await dv.blockedAttempts(0);
      expect(blk.reason).to.equal("该授权已过期，请重新申请");
    });
  });

  // ============================================================
  // 5.5 押金边界：等额刚好扣完 / 差 1 wei / 超大数量 / 零数量
  //     （对应前端「押金不足仍可调用」BUG 的回归验证——合约层拦截必须逐位精确）
  // ============================================================
  describe("押金边界（等额 / 差 1 wei / 大数量 / 零数量）", function () {
    it("等额调用：押金恰好扣到 0 并成功建单，随后再调 1 次即被拦截", async function () {
      // 20 次 × 0.05 = 1 ETH，与押金等额：应放行（边界上的等号成立）
      const [ok, escrowId] = await dv.connect(enterprise).callData.staticCall(0, 0, 20, PROOF);
      expect(ok).to.equal(true);

      await (await dv.connect(enterprise).callData(0, 0, 20, PROOF)).wait();
      expect(await dv.deposits(enterprise.address)).to.equal(0n);   // 押金恰好归零
      const e = await dv.escrows(escrowId);
      expect(e.amount).to.equal(ETHER("1"));                        // 全额进托管

      // 押金已空：再调 1 次必须被拦截，且原因由合约给出
      const [ok2, , reason2] = await dv.connect(enterprise).callData.staticCall(0, 0, 1, PROOF);
      expect(ok2).to.equal(false);
      expect(reason2).to.equal("余额不足，请充值！");
    });

    it("差 1 wei：总价多 1 wei 即拦截，少 1 个单位即放行", async function () {
      // 押金补到 1.2 ETH - 1 wei（故意差 1 wei）
      await (await dv.connect(enterprise).deposit({ value: ETHER("0.2") - 1n })).wait();
      expect(await dv.deposits(enterprise.address)).to.equal(ETHER("1.2") - 1n);

      // 24 次 × 0.05 = 1.2 ETH > 1.2 ETH - 1 wei：仅差 1 wei 也必须拦截
      const [okBad, , reasonBad] = await dv.connect(enterprise).callData.staticCall(0, 0, 24, PROOF);
      expect(okBad).to.equal(false);
      expect(reasonBad).to.equal("余额不足，请充值！");

      // 23 次 × 0.05 = 1.15 ETH ≤ 押金：放行，剩余 = 0.05 ETH - 1 wei
      const [okGood, escrowId] = await dv.connect(enterprise).callData.staticCall(0, 0, 23, PROOF);
      expect(okGood).to.equal(true);
      await (await dv.connect(enterprise).callData(0, 0, 23, PROOF)).wait();
      expect(await dv.deposits(enterprise.address)).to.equal(ETHER("0.05") - 1n);
      expect((await dv.escrows(escrowId)).amount).to.equal(ETHER("1.15"));
    });

    it("超大数量（1000 次 = 50 ETH）：必须拦截且不建单、不动押金（复现演示场景）", async function () {
      // 押金仅 1 ETH，1000 次 × 0.05 = 50 ETH：远超余额，必须拦截
      const [ok, escrowId, reason] = await dv.connect(enterprise).callData.staticCall(0, 0, 1000, PROOF);
      expect(ok).to.equal(false);
      expect(escrowId).to.equal(0n);
      expect(reason).to.equal("余额不足，请充值！");
      // 预演不落链：押金原封不动、托管单数量为 0
      expect(await dv.deposits(enterprise.address)).to.equal(ETHER("1"));
      expect(await dv.getEscrowsCount()).to.equal(0n);
    });

    it("零数量：units=0 被合约直接拦截", async function () {
      const [ok, , reason] = await dv.connect(enterprise).callData.staticCall(0, 0, 0, PROOF);
      expect(ok).to.equal(false);
      expect(reason).to.equal("数量必须大于0");
    });
  });

  // ============================================================
  // 6. 争议申诉 + 监管裁决（资金救济路径）
  // ============================================================
  describe("争议与监管裁决", function () {
    it("企业申诉后资金锁定，监管驳回申诉则放款给用户并扣企业信誉", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      await (await dv.connect(enterprise).raiseDispute(0, "交付数据与描述不符")).wait();

      const e = await dv.escrows(0);
      expect(e.disputed).to.equal(true);
      expect(e.disputeReason).to.equal("交付数据与描述不符");

      // 争议中：用户不可提现
      await expect(dv.connect(user).withdrawRevenue(0)).to.be.revertedWith("该笔收益处于争议中，请等待监管裁决");

      // 监管驳回申诉（refundToEnterprise=false）-> 放款给用户
      // 注意：gas 由监管支付，用户是纯收款方，因此余额恰好增加 0.2 ETH
      const before = await ethers.provider.getBalance(user.address);
      await (await dv.connect(regulator).resolveDispute(0, false)).wait();
      // 裁决放款同样按 90/10 分账，用户实得 0.18
      expect((await ethers.provider.getBalance(user.address)) - before).to.equal(ETHER("0.18"));

      const after = await dv.escrows(0);
      expect(after.settled).to.equal(true);
      expect(after.refunded).to.equal(false);
      // 恶意申诉记一次败诉
      expect(await dv.disputesLost(enterprise.address)).to.equal(1n);
      expect(await dv.totalRefunded()).to.equal(0n);
    });

    it("监管裁定退款：押金退回企业、分账取消、信誉不受损", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      expect(await dv.deposits(enterprise.address)).to.equal(ETHER("0.8"));
      await (await dv.connect(enterprise).raiseDispute(0, "数据为空")).wait();

      await (await dv.connect(regulator).resolveDispute(0, true)).wait();

      // 押金回补
      expect(await dv.deposits(enterprise.address)).to.equal(ETHER("1"));
      // 分账总额回退、退款总额累计
      expect(await dv.totalDistributed()).to.equal(0n);
      expect(await dv.totalRefunded()).to.equal(ETHER("0.2"));
      // 申诉成立，不算败诉
      expect(await dv.disputesLost(enterprise.address)).to.equal(0n);
      const e = await dv.escrows(0);
      expect(e.refunded).to.equal(true);
      expect(e.settled).to.equal(true);
    });

    it("确认收货后不能再发起争议", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      await (await dv.connect(enterprise).confirmDelivery(0)).wait();
      await expect(dv.connect(enterprise).raiseDispute(0, "事后反悔"))
        .to.be.revertedWith("争议窗口已结束，无法再发起申诉");
    });

    it("争议窗口结束后不能再发起申诉", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      await time.increase(601); // CHALLENGE_PERIOD = 600（v4.4 由 60 秒延长）
      await expect(dv.connect(enterprise).raiseDispute(0, "太晚了"))
        .to.be.revertedWith("争议窗口已结束，无法再发起申诉");
    });

    it("监管不能裁决非争议中的托管单", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      await expect(dv.connect(regulator).resolveDispute(0, true))
        .to.be.revertedWith("该托管单不在争议中");
    });
  });

  // ============================================================
  // 7. 链上信誉分 + 失信标记
  // ============================================================
  describe("链上信誉分与失信标记", function () {
    it("新企业基线 600 分，成功调用加分、被拦截扣分", async function () {
      let [score, success, blocked] = await dv.reputationOf(enterprise.address);
      expect(score).to.equal(600n);
      expect(success).to.equal(0n);
      expect(blocked).to.equal(0n);

      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      [score, success] = await dv.reputationOf(enterprise.address);
      expect(score).to.equal(608n);
      expect(success).to.equal(1n);

      // 一次余额不足拦截
      await (await dv.connect(enterprise).callData(0, 0, U_BIG, PROOF)).wait();
      [score, , blocked] = await dv.reputationOf(enterprise.address);
      expect(blocked).to.equal(1n);
      expect(score).to.equal(548n); // 608 - 60
    });

    it("信誉分低于阈值后调用被自动拒绝", async function () {
      // 连续 6 次余额不足：600 - 360 = 240 < 300
      for (let i = 0; i < 6; i++) {
        await (await dv.connect(enterprise).callData(0, 0, U_BIG, PROOF)).wait();
      }
      const [score] = await dv.reputationOf(enterprise.address);
      expect(score).to.equal(240n);

      const [ok, , reason] = await dv.connect(enterprise).callData.staticCall(0, 0, 1, PROOF);
      expect(ok).to.equal(false);
      expect(reason).to.equal("企业信誉分不足，暂停调用权限");
    });

    it("监管标记失信后信誉归零且无法调用，解除后恢复", async function () {
      await (await dv.connect(regulator).flagEnterprise(enterprise.address, true, "恶意爬取")).wait();
      let [score, , , , isFlagged] = await dv.reputationOf(enterprise.address);
      expect(isFlagged).to.equal(true);
      expect(score).to.equal(0n);
      expect(await dv.flagReason(enterprise.address)).to.equal("恶意爬取");

      const [ok, , reason] = await dv.connect(enterprise).callData.staticCall(0, 0, 1, PROOF);
      expect(ok).to.equal(false);
      expect(reason).to.equal("该企业已被监管标记失信，暂停调用权限");

      await (await dv.connect(regulator).flagEnterprise(enterprise.address, false, "")).wait();
      [score, , , , isFlagged] = await dv.reputationOf(enterprise.address);
      expect(isFlagged).to.equal(false);
      expect(score).to.equal(600n);
      const [ok2] = await dv.connect(enterprise).callData.staticCall(0, 0, 1, PROOF);
      expect(ok2).to.equal(true);
    });

    it("监管标记对象必须是企业角色", async function () {
      await expect(dv.connect(regulator).flagEnterprise(user.address, true, "x"))
        .to.be.revertedWith("标记对象不是企业角色");
    });
  });

  // ============================================================
  // 8. 监管只读
  // ============================================================
  describe("监管只读统计", function () {
    it("监管角色可查询全局统计数据", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      expect(await dv.connect(regulator).getFieldsCount()).to.equal(1n);
      expect(await dv.connect(regulator).totalDistributed()).to.equal(ETHER("0.2"));
      expect(await dv.connect(regulator).totalAuthorizations()).to.be.greaterThanOrEqual(1n);
      expect(await dv.connect(regulator).getEscrowsCount()).to.equal(1n);
      // 平台累计收入也属于公开可审计的全局统计
      expect(await dv.connect(regulator).totalPlatformRevenue()).to.equal(0n);
    });
  });

  // ============================================================
  // 9. 平台分账（v4.0）
  // ============================================================
  describe("平台分账", function () {
    it("分账比例由合约常量决定：数据所有者 90% / 平台 10%", async function () {
      expect(await dv.PLATFORM_FEE_BPS()).to.equal(1000n);
      expect(await dv.BPS_DENOMINATOR()).to.equal(10000n);
      const [toUser, toPlatform] = await dv.platformSplitOf(ETHER("0.2"));
      expect(toUser).to.equal(ETHER("0.18"));
      expect(toPlatform).to.equal(ETHER("0.02"));
      // 拆分不能凭空多出钱
      expect(toUser + toPlatform).to.equal(ETHER("0.2"));
    });

    it("提现时平台服务费自动转给平台地址并留痕", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      await (await dv.connect(enterprise).confirmDelivery(0)).wait();

      const beforePlatform = await ethers.provider.getBalance(platform.address);
      const beforeUser = await ethers.provider.getBalance(user.address);
      const rc = await (await dv.connect(user).withdrawRevenue(0)).wait();
      const gasUsed = rc.gasUsed * rc.gasPrice;

      expect((await ethers.provider.getBalance(user.address)) - beforeUser).to.equal(ETHER("0.18") - gasUsed);
      expect((await ethers.provider.getBalance(platform.address)) - beforePlatform).to.equal(ETHER("0.02"));

      const evs = await dv.queryFilter("PlatformRevenuePaid");
      expect(evs.length).to.equal(1);
      expect(evs[0].args.amount).to.equal(ETHER("0.02"));
      expect(await dv.totalPlatformRevenue()).to.equal(ETHER("0.02"));
      expect(await dv.totalWithdrawn()).to.equal(ETHER("0.18"));
    });

    it("平台地址不能是零地址，且只有管理员能改", async function () {
      const Factory = await ethers.getContractFactory("DataShare");
      await expect(Factory.deploy(ethers.ZeroAddress, await dv.zkVerifier()))
        .to.be.revertedWith("平台收款地址不能为空");
      await expect(dv.connect(user).setPlatformTreasury(user.address))
        .to.be.revertedWithCustomError(dv, "AccessControlUnauthorizedAccount");
    });

    it("退款不抽服务费：争议裁决退款时全额退回企业", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      await (await dv.connect(enterprise).raiseDispute(0, "数据为空")).wait();
      const beforePlatform = await ethers.provider.getBalance(platform.address);
      await (await dv.connect(regulator).resolveDispute(0, true)).wait();
      expect((await ethers.provider.getBalance(platform.address)) - beforePlatform).to.equal(0n);
      expect(await dv.totalPlatformRevenue()).to.equal(0n);
      expect(await dv.deposits(enterprise.address)).to.equal(ETHER("1"));
    });
  });

  // ============================================================
  // 10. 订单取消与订单状态机（v4.0）
  // ============================================================
  describe("订单取消与订单状态", function () {
    it("订单状态：托管中 = 0，已取消（退款）= 2", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      expect(await dv.orderStateOf(0)).to.equal(0n);
      await (await dv.connect(enterprise).cancelOrder(0)).wait();
      expect(await dv.orderStateOf(0)).to.equal(2n);
    });

    it("企业可在窗口内取消订单，资金原路退回押金池并发出事件", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      expect(await dv.deposits(enterprise.address)).to.equal(ETHER("0.8"));

      const rc = await (await dv.connect(enterprise).cancelOrder(0)).wait();
      const parsed = rc.logs
        .map((l) => { try { return dv.interface.parseLog(l); } catch { return null; } })
        .filter(Boolean);
      expect(parsed.some((e) => e.name === "OrderCancelled")).to.equal(true);

      expect(await dv.deposits(enterprise.address)).to.equal(ETHER("1"));  // 原路退回
      expect(await dv.totalDistributed()).to.equal(0n);                     // 分账取消
      expect(await dv.totalRefunded()).to.equal(ETHER("0.2"));
      const e = await dv.escrows(0);
      expect(e.settled).to.equal(true);
      expect(e.refunded).to.equal(true);
    });

    it("过了可取消时间后不能单方取消（资金归数据所有者）", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      await time.increase(601); // CHALLENGE_PERIOD = 600（v4.4 由 60 秒延长）
      await expect(dv.connect(enterprise).cancelOrder(0))
        .to.be.revertedWith("已过可取消时间，资金将结算给数据所有者");
    });

    it("不能取消别人的订单，也不能取消已结算订单", async function () {
      await (await dv.connect(enterprise).callData(0, 0, U4, PROOF)).wait();
      await expect(dv.connect(user).cancelOrder(0))
        .to.be.revertedWithCustomError(dv, "AccessControlUnauthorizedAccount");

      await (await dv.connect(enterprise).confirmDelivery(0)).wait();
      await (await dv.connect(user).withdrawRevenue(0)).wait();
      await expect(dv.connect(enterprise).cancelOrder(0)).to.be.revertedWith("该订单已结算，无法取消");
    });
  });
});
