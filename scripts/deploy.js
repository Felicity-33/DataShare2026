// ============================================================
// DataShare 部署脚本（Ethers.js v6 语法，支持 Ganache / Sepolia 双目标）
// ------------------------------------------------------------
// 运行命令：
//   本地：npm run deploy（等价于 hardhat run scripts/deploy.js --network ganache）
//   线上：npm run deploy:sepolia（前置：根目录 .env 配置 SEPOLIA_PRIVATE_KEY）
//
// v4.4 部署内容（v4.4 变更：争议窗口 60 秒 → 600 秒，修复企业申诉因窗口过短无法发起的问题）：
//   1. 部署 Groth16 权属验证器（ZkVerifier.sol，由 scripts/build-zk.cjs 生成）
//   2. 部署 DataShare（构造参数：平台收款地址 + 验证器地址）
//   3. 为演示账户分配角色（用户 / 企业 / 监管）
//   4. 演示账号用**真实的 ZK 权属证明**完成确权（每字段一枚证明）
//   5. 预授权一条，方便直接演示「调用」流程
//
// Sepolia 分支差异（线上评审）：钱包只有部署者一枚私钥，六个演示账户不可用，
//   因此仅部署合约 + 部署者以「演示用户」身份确权两个数据字段（上线即有内容可看）；
//   角色（用户/企业/监管）由评委在前端「选择你的链上角色」自助注册——这本身就是产品交互。
//
// 部署完成后，Sepolia 合约地址填入 frontend/.env 的 VITE_SEPOLIA_CONTRACT_ADDRESS。
//
// 前置条件：先跑一次 `node scripts/build-zk.cjs` 生成电路产物（wasm / zkey / 验证器）。
// ============================================================
const hre = require("hardhat");
const { deploySystem, registerFieldWithZk, initZk } = require("./lib/zk.cjs");

// Sepolia 精简部署：零私钥配置（hardhat.config 自动用演示助记词派生部署账户），
// 合约上线即含 2 个已确权数据字段。唯一前置：该账户已从水龙头领取测试 ETH。
async function deploySepolia() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer || !deployer.address) {
    throw new Error("未读到部署账户：请检查 hardhat.config.js 的 sepolia.accounts 配置");
  }

  console.log("================== DataShare v4.4 Sepolia 部署开始 ==================");
  console.log("部署账户:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("账户余额:", hre.ethers.formatEther(balance), "ETH");
  if (balance < hre.ethers.parseEther("0.1")) {
    throw new Error("测试 ETH 不足（部署约需 0.1 ~ 0.3 ETH），请先到 Sepolia 水龙头领取测试 ETH 后重试");
  }

  // 预热 ZK 并部署验证器 + 主合约（平台服务费收款地址 = 部署者）
  await initZk();
  const { verifier, dv } = await deploySystem(deployer.address);
  const verifierAddress = await verifier.getAddress();
  const contractAddress = await dv.getAddress();
  console.log("Groth16 验证器地址:", verifierAddress);
  console.log("DataShare 合约地址:", contractAddress);

  // 部署者注册为用户并确权两个数据字段（真实 Groth16 证明，上线即可浏览）
  await (await dv.connect(deployer).registerAsUser()).wait();
  console.log("部署者已注册为演示用户");
  console.log("\n>>> 开始 ZK 确权（每个字段生成一枚 Groth16 证明）");
  await registerFieldWithZk(dv, deployer, "消费偏好", 1000001n, "消费偏好");
  await registerFieldWithZk(dv, deployer, "出行习惯", 1000002n, "出行习惯");
  console.log("已确权字段：消费偏好(0)、出行习惯(1)");

  console.log("\n================== Sepolia 部署完成 ==================");
  console.log("");
  console.log("【前端配置提醒】请将下面的地址写入 frontend/.env 后重新构建发布：");
  console.log("  VITE_SEPOLIA_CONTRACT_ADDRESS=" + contractAddress);
  console.log("");
  console.log("【链上查看】https://sepolia.etherscan.io/address/" + contractAddress);
  console.log("【角色说明】用户/企业/监管角色由各钱包地址在前端自助注册（合约 AccessControl 自助注册）");
}

async function main() {
  // Sepolia 走单私钥精简分支；其余网络（ganache 等）走六账户完整演示分支
  if (hre.network.name === "sepolia") return deploySepolia();

  // 账户顺序与 MetaMask 导入后的顺序一致：
  //   0 = 部署者(同时作为平台收款地址)  1 = 演示用户(用户A)  2 = 演示企业
  //   3 = 监管   4/5 = 用户B/用户C
  const [deployer, user, enterprise, regulator, userB, userC] = await hre.ethers.getSigners();

  // ★ 横幅版本号与 DataShare.sol 的 CONTRACT_VERSION 保持一致（当前 v4.4）
  console.log("================== DataShare v4.4 部署开始 ==================");
  console.log("部署账户:", deployer.address);

  // 0. 预热 ZK（加载 Poseidon，稍后确权要用）
  await initZk();

  // 1 + 2. 部署验证器 与 DataShare 主合约
  const { verifier, dv } = await deploySystem(deployer.address);  // 平台服务费收款地址 = 部署者
  const verifierAddress = await verifier.getAddress();
  const contractAddress = await dv.getAddress();
  console.log("Groth16 验证器地址:", verifierAddress);
  console.log("DataShare 合约地址:", contractAddress);
  console.log("平台服务费收款地址:", deployer.address, `（分成 ${Number(await dv.PLATFORM_FEE_BPS()) / 100}%）`);

  // 3. 分配角色（AccessControl 自助注册）
  await (await dv.connect(user).registerAsUser()).wait();
  console.log("用户角色已分配 ->", user.address);
  await (await dv.connect(enterprise).registerAsEnterprise()).wait();
  console.log("企业角色已分配 ->", enterprise.address);
  await (await dv.connect(regulator).registerAsRegulator()).wait();
  console.log("监管角色已分配 ->", regulator.address);
  await (await dv.connect(userB).registerAsUser()).wait();
  await (await dv.connect(userC).registerAsUser()).wait();
  console.log("用户B/用户C 角色已分配");

  // 4. 演示用户用 ZK 权属证明确权数据字段
  //    secret 只是演示用的固定值；真实场景应由用户本地随机生成并妥善保管（不上链）
  console.log("\n>>> 开始 ZK 确权（每个字段生成一枚 Groth16 证明，约 0.2s/个）");
  await registerFieldWithZk(dv, user, "消费偏好", 1000001n, "消费偏好");
  await registerFieldWithZk(dv, user, "出行习惯", 1000002n, "出行习惯");
  console.log("用户A 已确权字段：消费偏好(0)、出行习惯(1)");
  await registerFieldWithZk(dv, userB, "消费偏好", 1000003n, "消费偏好");
  await registerFieldWithZk(dv, userC, "运动健康", 1000004n, "运动健康");
  console.log("用户B/用户C 已确权字段：消费偏好(2)、运动健康(3)");

  // 5. 预授权：用户A 把「消费偏好(0)」授权给演示企业，便于直接演示调用
  await (await dv.connect(user).grantPermission(0, enterprise.address)).wait();
  console.log("预授权完成：用户A 的 消费偏好 -> 演示企业");

  console.log("\n================== 部署完成 ==================");
  console.log("");
  console.log("【前端配置提醒】请将合约地址复制到 frontend/src/config.js 的 CONTRACT_ADDRESS：");
  console.log("  " + contractAddress);
  console.log("");
  console.log("【演示账户地址】（MetaMask 导入 private key 时按顺序对应）");
  console.log("  用户A(演示用户):", user.address);
  console.log("  演示企业:", enterprise.address);
  console.log("  监管:", regulator.address);
  console.log("  平台(部署者):", deployer.address);
  console.log("  用户B:", userB.address);
  console.log("  用户C:", userC.address);
  console.log("  （账户私钥见 Ganache 界面 Accounts 列表）");
}

main()
  // 显式退出：脚本用到了 hre.ethers，Hardhat 内置网络的连接会一直挂住事件循环，
  // 不主动退出会导致进程被外部超时杀掉 —— 输出丢失、退出码变成 1（看起来像部署失败）。
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("部署失败:", error);
    process.exit(1);
  });
