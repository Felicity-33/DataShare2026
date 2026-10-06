// ============================================================
// Hardhat 配置文件 —— 支持本地 Ganache 与 Sepolia 公共测试网双目标
// ------------------------------------------------------------
// 1. 本地演示（默认）：请先启动 Ganache，并确保其使用与本配置一致的助记词，
//    这样 hardhat 才能用同样的账户部署、MetaMask 才能导入同样的账户。
//    启动命令：npx ganache -m "any ivory brain ..." -p 7545
//    （Ganache 图形界面：New Workspace -> Accounts & Keys 里填入同样的助记词）
// 2. Sepolia 部署（线上评审）：先在项目根目录创建 .env 文件写入部署私钥：
//      SEPOLIA_PRIVATE_KEY=0x你的测试账户私钥
//    再执行：npm run deploy:sepolia
//    ⚠️ 该私钥只应存放测试币（水龙头领取），切勿使用存有真实资产的账户；
//       .env 已在 .gitignore 中，私钥不会被提交到仓库。
// 3. Ganache 默认 RPC 为 http://127.0.0.1:7545，ChainID 为 1337；
//    Sepolia ChainID 为 11155111。
// ============================================================
require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config(); // 读取根目录 .env（Sepolia 部署私钥等敏感配置）

// 本地 Ganache 助记词（与 Ganache 保持一致，才能推导出相同的 10 个演示账户）
const GANACHE_MNEMONIC = "any ivory brain wild text hurt embrace arrow famous juice tower refuse";

// Sepolia 部署私钥（从根目录 .env 读取；缺失时 sepolia 网络不可用，本地演示不受影响）
const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY || "";

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
    },
    // Sepolia 公共测试网络（线上评审部署目标）
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", // 公共 RPC 免注册，可换 Alchemy/Infura
      chainId: 11155111,
      // 部署账户零配置：优先用 .env 里的专用私钥；未配置时自动用本地演示助记词
      // 派生（该助记词为公开演示助记词，地址上只放水龙头测试币，零资产风险）。
      // 使用前只需给派生地址领取 Sepolia 测试币即可部署。
      accounts: SEPOLIA_PRIVATE_KEY
        ? [SEPOLIA_PRIVATE_KEY]
        : { mnemonic: GANACHE_MNEMONIC, count: 3 }
    }
  }
};
