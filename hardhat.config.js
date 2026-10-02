// ============================================================
// Hardhat 配置文件 —— 连接本地 Ganache 模拟网络
// ------------------------------------------------------------
// 说明：
// 1. 请先启动 Ganache，并确保其使用与本配置一致的助记词，
//    这样 hardhat 才能用同样的账户部署、MetaMask 才能导入同样的账户。
// 2. 启动 Ganache CLI 的命令（与下面助记词一致）：
//      npx ganache -m "test test test test test test test test test test test junk" -p 7545
//    （Ganache 图形界面：New Workspace -> Accounts & Keys 里填入同样的助记词）
// 3. Ganache 默认 RPC 为 http://127.0.0.1:7545，ChainID 为 1337。
// ============================================================
require("@nomicfoundation/hardhat-toolbox");

// 本地 Ganache 助记词（与 Ganache 保持一致，才能推导出相同的 10 个演示账户）
const GANACHE_MNEMONIC = "any ivory brain wild text hurt embrace arrow famous juice tower refuse";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 } // 开启优化器，降低 gas
    }
  },
  networks: {
    // 本地 Ganache 测试网络
    ganache: {
      url: "http://127.0.0.1:7545",   // Ganache RPC 地址
      chainId: 1337,                  // Ganache 默认 ChainID
      accounts: { mnemonic: GANACHE_MNEMONIC, count: 10 } // 使用与 Ganache 相同的助记词派生账户
    }
  }
};
