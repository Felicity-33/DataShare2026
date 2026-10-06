# 第三方组件与开源许可说明

本文件说明「链承共予 · DataShare」所使用第三方开源组件的名称、版本、许可协议与来源，
以便评审与使用者核查。

**本项目自研范围**：智能合约业务逻辑、零知识电路与前端均为团队自主实现，采用 MIT 许可，详见项目根目录 [LICENSE](LICENSE)。

## 一、运行时与构建依赖

| 组件 | 版本 | 许可协议 | 用途 | 来源 |
| --- | --- | --- | --- | --- |
| Solidity 编译器 | 0.8.24 | GPL-3.0 | 编译智能合约 | https://github.com/ethereum/solidity |
| Hardhat | 2.29.1 | MIT | 合约编译、测试与部署 | https://github.com/NomicFoundation/hardhat |
| hardhat-toolbox | 5.0.0 | MIT | Hardhat 测试与工具集成 | https://github.com/NomicFoundation/hardhat |
| Ganache | 7.9.2 | MIT | 本地模拟链 | https://github.com/ConsenSys/ganache |
| OpenZeppelin Contracts | 5.6.1 | MIT | 角色控制、防重入等合约基础组件 | https://github.com/OpenZeppelin/openzeppelin-contracts |
| circom | 0.2.23 | GPL-3.0 | 编译零知识电路 | https://github.com/iden3/circom |
| circomlib | 2.0.5 | GPL-3.0 | 电路基础组件（Poseidon 哈希等） | https://github.com/iden3/circomlib |
| circomlibjs | 0.1.7 | GPL-3.0 | 电路的 JavaScript 侧实现校验 | https://github.com/iden3/circomlibjs |
| snarkjs | 0.7.6 | GPL-3.0 | 生成与验证 Groth16 证明 | https://github.com/iden3/snarkjs |
| ethers | 6.17.0 | MIT | 前端与智能合约通信 | https://github.com/ethers-io/ethers.js |
| React / React DOM | 18.3.1 | MIT | 前端界面框架 | https://github.com/facebook/react |
| Vite | 5.4.21 | MIT | 前端构建与开发服务 | https://github.com/vitejs/vite |
| @vitejs/plugin-react | 4.7.0 | MIT | React 构建插件 | https://github.com/vitejs/vite-plugin-react |
| TailwindCSS | 3.4.19 | MIT | 页面样式 | https://github.com/tailwindlabs/tailwindcss |
| PostCSS | 8.5.28 | MIT | 样式处理 | https://github.com/postcss/postcss |
| Autoprefixer | 10.6.0 | MIT | 样式兼容处理 | https://github.com/postcss/autoprefixer |
| Recharts | 2.15.4 | MIT | 数据图表可视化 | https://github.com/recharts/recharts |
| lucide-react | 1.47.0 | ISC | 界面图标 | https://github.com/lucide-icons/lucide |
| poseidon-lite | 0.3.0 | MIT | 前端 Poseidon 哈希计算 | https://github.com/paulmillr/poseidon-lite |

## 二、GPL-3.0 组件的使用方式

- 上表中标注 GPL-3.0 的组件均为**独立工具或独立依赖**，以其原始形态使用，未修改其源码；
- 未将其源码静态并入本项目的交付产物；本项目交付的验证器合约由 SnarkJS 依据自有电路生成并独立部署；
- 上述组件的完整源码可通过上表链接获取，其许可条款以各自原始仓库为准。

## 三、未随本项目分发的第三方软件

- **MetaMask 浏览器插件**：由使用者自行安装的第三方钱包软件，本项目不分发其任何文件、不改动其代码；其许可条款与使用规则以官方发布为准。

## 四、数据与素材说明

- 链下数据集均为本地构造的模拟数据，不含任何真实个人信息；
- 项目文档中的架构图、流程图由本项目自绘，终端与界面图为本项目实测截图。

## 五、合规声明

- 本项目不发行代币、不融资、不挖矿，与 ICO 及虚拟货币无关；合约中的计价常量仅为本地演示链上的记账单位，无实际价值；
- 项目全程运行于本地模拟链，不使用云服务与外部数据接口。