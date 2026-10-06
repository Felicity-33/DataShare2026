pragma circom 2.0.0;

// ============================================================
// dataOwnership.circom —— 数据权属证明（轻量 ZK，仅用于「确权」阶段）
// ------------------------------------------------------------
// 要解决的问题：
//   用户上链确权时，合约需要确认「提交者确实是这条数据的所有者」。
//   但直接把权属密钥（secret）明文提交上链，等于把钥匙公开 —— 谁都能冒充。
//
// 本电路让用户证明：
//   「我知道一个 secret，使得 Poseidon(secret, owner) == commitment」
//   而 **不暴露 secret 本身**。
//
// 公开输入（会上链、可被任何人核验）：
//   commitment —— 数据权属承诺，注册字段时一起写入链上存证
//   owner      —— 提交者地址（换算成 field 元素），把承诺绑定到人
//
// 私有输入（永远不上链、不进入证明文件）：
//   secret     —— 只有数据所有者知道的权属密钥（前端本地生成并保存）
//
// 为什么要把 owner 也放进哈希：
//   如果 commitment 只由 secret 决定，那么任何人看到链上的 commitment 都无法反推 secret，
//   但**所有者自己**在别处泄露 commitment 后，别人仍无法伪造（因为不知道 secret）。
//   把 owner 一起哈希后，承诺与地址强绑定：
//   同一条数据的承诺无法被迁移到另一个地址上使用（防冒名确权 / 防跨账户复用）。
//
// 约束规模：Poseidon(2) 属于「轻量」级别，
// 前端可在浏览器内几秒内完成证明生成。
// ============================================================

include "circomlib/circuits/poseidon.circom";

template DataOwnership() {
    // 私有输入：权属密钥，只有数据所有者知道
    signal input secret;

    // 公开输入：承诺值（链上存证）
    signal input commitment;
    // 公开输入：所有者地址（合约会校验它等于 msg.sender）
    signal input owner;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== secret;
    hasher.inputs[1] <== owner;

    // 约束：公开承诺必须等于「密钥 + 地址」的哈希
    commitment === hasher.out;
}

// public 列表的顺序即公开信号在 proof 中的顺序：[commitment, owner]
component main {public [commitment, owner]} = DataOwnership();
