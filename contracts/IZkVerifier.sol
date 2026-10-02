// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ============================================================
// IZkVerifier.sol —— Groth16 验证器接口
// ------------------------------------------------------------
// 为什么用「独立部署 + 外部调用」而不是继承：
//   snarkjs 生成的 Groth16Verifier 函数体**只有内联汇编**，并以汇编 return 结束，
//   没有 Solidity 层面的 return 语句。Solidity 编译器因此认为「调用它之后不可达」，
//   会把 `require(verifyProof(...))` 之后的代码（写状态、发事件）当成死代码删掉 ——
//   交易照样成功，但字段根本没注册、事件也不发，属于极难发现的静默故障。
//   （实测：继承时 registerField 的 fields.push 与 emit 全部被删，gasUsed 225130 / 事件数 0）
//
//   改成外部调用后，编译器无法对被调用合约做控制流推断，也就不会误删后续代码。
//   顺带的好处：DataShare 体积更小（不会因内联验证器而超过 24KB 部署上限）。
// ============================================================
interface IZkVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[2] calldata _pubSignals
    ) external view returns (bool);
}
