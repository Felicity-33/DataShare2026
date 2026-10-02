// ============================================================
// test/zk.test.js —— ZK 权属证明的链上校验测试
// ------------------------------------------------------------
// 覆盖：
//   1. 合法证明 → 链上 verifyProof 返回 true
//   2. 篡改公开信号（换成别人的承诺）→ 必须返回 false
//   3. 换一个私钥（冒充他人身份）→ 证明生成失败（无法伪造）
//   4. 端到端：DataShare.registerField 要求权属证明，冒名确权被拒绝
//
// 说明：证明在测试运行时现场生成（约 0.7s/次），
//       这样测试与账号无关 —— 不依赖硬编码的证明文件。
// ============================================================
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { makeProof, commitmentOf, deploySystem, initZk } = require("./helpers/zk");


describe("ZK 权属证明", function () {
  this.timeout(120000);

  let verifier;
  let dv;
  let user, enterprise, regulator, outsider;

  before(async function () {
    await initZk();
    [user, enterprise, regulator, outsider] = await ethers.getSigners();
    const sys = await deploySystem(user.address);   // 平台收款地址
    dv = sys.dv;
    verifier = sys.verifier;
    await (await dv.connect(user).registerAsUser()).wait();
  });

  it("合法证明可以通过链上验证", async function () {
    const pf = await makeProof(20240917n, user.address);
    expect(await verifier.verifyProof(pf.pA, pf.pB, pf.pC, pf.pubSignals)).to.equal(true);
  });

  it("篡改公开信号（冒充他人的承诺）必须被拒绝", async function () {
    const pf = await makeProof(20240917n, user.address);
    const tampered = [String(BigInt(pf.pubSignals[0]) + 1n), pf.pubSignals[1]];
    expect(await verifier.verifyProof(pf.pA, pf.pB, pf.pC, tampered)).to.equal(false);
  });

  it("换一个权属密钥（不知道 secret 就想冒充）无法通过原有证明", async function () {
    const mine = await makeProof(111n, user.address);
    // 攻击者拿自己的密钥算出另一份承诺，却想复用「本人」的证明
        const other = await commitmentOf(222n, user.address);
    const forged = [String(other), mine.pubSignals[1]];
    expect(await verifier.verifyProof(mine.pA, mine.pB, mine.pC, forged)).to.equal(false);
  });

  it("确权：registerField 接受合法权属证明并写入 commitment", async function () {
    const pf = await makeProof(555n, user.address);
    const tx = await dv.connect(user).registerField("消费偏好", "消费偏好", pf.pA, pf.pB, pf.pC, pf.pubSignals);
    const rc = await tx.wait();

    const f = await dv.fields(0);
    expect(f.owner).to.equal(user.address);
    expect(f.name).to.equal("消费偏好");
    expect(f.commitment).to.equal(pf.commitment);

    // 必须发出「确权 + 权属校验」两个事件
    const parsed = rc.logs.map((l) => { try { return dv.interface.parseLog(l); } catch { return null; } }).filter(Boolean);
    expect(parsed.some((e) => e.name === "FieldRegistered")).to.equal(true);
    expect(parsed.some((e) => e.name === "FieldVerified")).to.equal(true);
  });

  it("确权：把别人的承诺塞进证明里想冒名确权，会被合约拒绝", async function () {
    // 攻击者用自己的地址生成证明，却声称所有者是 user
    const pf = await makeProof(777n, outsider.address);
    await expect(
      dv.connect(outsider).registerField("伪造字段", "消费偏好", pf.pA, pf.pB, pf.pC, pf.pubSignals),
    ).to.be.revertedWithCustomError(dv, "AccessControlUnauthorizedAccount"); // 企业/监管无用户角色另说
  });

  it("确权：用户角色下，公开信号里的 owner 与提交者不一致必须拒绝", async function () {
    // 用 outsider 的地址生成证明，却由 user 提交 —— owner 校验必须拦下
    const pf = await makeProof(888n, outsider.address);
    await expect(
      dv.connect(user).registerField("冒名字段", "消费偏好", pf.pA, pf.pB, pf.pC, pf.pubSignals),
    ).to.be.revertedWith("证明中的权属地址与提交者不一致");
  });
});
