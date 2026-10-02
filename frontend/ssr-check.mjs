// 前端冒烟测试：用 SSR 真渲染各主要组件，捕获「渲染期就会抛」的错误
// ------------------------------------------------------------
// 为什么需要它：`npm run build` 只能发现语法错误，**发现不了运行期错误**。
// 典型漏网之鱼：
//   · TDZ（`const` 在声明前被求值，例如 hook 依赖数组引用了尚未声明的变量）→ 页面直接白屏
//   · 对 undefined 取属性、变量名拼错
// 用法：
//   cd frontend && node ssr-check.mjs
// 退出码 0 = 全部渲染通过；非 0 = 有组件渲染失败（会打印首个错误行）。
// ============================================================
import { createServer } from 'vite';
import React from 'react';
import { renderToString } from 'react-dom/server';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });

const mockWeb3 = {
  contract: null, provider: null, signer: null, account: null,
  role: 'user', connected: false, connecting: false, networkOk: true,
  eventsVersion: 0, contractVersion: '3.0', versionOk: true,
  connect: async () => {}, disconnect: () => {}, switchAccount: () => {},
  refreshRole: async () => {}, registerRole: async () => {}, getRole: async () => 'none',
  fetchAllEvents: async () => [],
};

// 各组件需要的 props（按 tag 取名，避免深层三元表达式）
const PROPS = {
  dash: () => ({ web3: mockWeb3, onNotice: () => {}, onTx: () => {} }),
  proof: () => ({
    row: { escrowId: 0, fieldId: 4, fieldName: '饮食口味', user: '0xabc', enterprise: '0xdef', amount: '50000000000000000', deliveryHash: '0x' + '3f'.repeat(32), ts: 1, confirmedAt: 0, disputed: false, settled: false, refunded: false, disputeReason: '', txHash: '0x' + 'aa'.repeat(32) },
    contract: null, viewer: 'regulator', onClose: () => {},
  }),
  help: () => ({ role: 'user', onClose: () => {} }),
  json: () => ({
    payload: {
      分类: '金融理财', 年龄段: '26-35 岁', 记录条数: 1200,
      兴趣标签: ['理财', '基金'],
      // 这一组值刻意覆盖所有语义分支：时段（跨零点）/ 斜杠比值 / a:b 比值 /
      // 单百分比（带括号说明与不带说明）/ 区间 / 纯文本
      消费特征: {
        月均消费: '3,000 - 8,000 元',
        活跃时段: '22:00 - 02:00',
        系统偏好: 'Android 占 58% / iOS 占 42%',
        性别倾向: '男女比例接近（51% / 49%）',
        储蓄消费比: '32 : 68',
        复购率: '41%',
        收入稳定性: '稳健型为主（约 54%）',
        价格敏感度: '中等',
      },
      字段字典: [{ 字段: 'age', 类型: 'int', 说明: '年龄段' }],
      合规声明: { 数据来源: '示例', 使用限制: '仅限本次授权范围' },
    },
    fileUrl: '/data/示例.json', fileName: '示例.json', onNotice: () => {},
  }),
  charts: () => ({
    logs: [
      { ts: 1789000000, blockNumber: 1200, type: '调用分账', fieldId: 2, user: '0xC18Eaf51C2', enterprise: '0x49f880A668', amount: '50000000000000000' },
      { ts: 1789001800, blockNumber: 1201, type: '非法拦截', fieldId: 2, user: '0xC18Eaf51C2', enterprise: '0x7788aaBBcc', amount: null },
      { ts: 1789003600, blockNumber: 1202, type: '字段上链', fieldId: 5, user: '0xC18Eaf51C2', enterprise: null, amount: null },
    ],
  }),
};

const targets = [
  ['./src/components/UserDashboard.jsx', 'user', 'dash'],
  ['./src/components/EnterpriseDashboard.jsx', 'enterprise', 'dash'],
  ['./src/components/RegulatorDashboard.jsx', 'regulator', 'dash'],
  ['./src/components/Home.jsx', 'home', 'dash'],
  ['./src/components/ProofDrawer.jsx', 'proof', 'proof'],
  ['./src/components/HelpModal.jsx', 'help', 'help'],
  ['./src/components/DataPayloadView.jsx', 'payload图表', 'json'],
  ['./src/components/AuditCharts.jsx', 'charts', 'charts'],
];

let bad = 0;
for (const [file, tag, propKey] of targets) {
  try {
    const mod = await vite.ssrLoadModule(file);
    const C = mod.default;
    renderToString(React.createElement(C, PROPS[propKey]()));
    console.log(`✅ ${tag.padEnd(11)} 渲染通过`);
  } catch (e) {
    bad++;
    console.log(`❌ ${tag.padEnd(11)} 渲染失败: ${String(e.message).split('\n')[0]}`);
  }
}

await vite.close();
console.log(bad === 0 ? '\n全部组件渲染正常' : `\n有 ${bad} 个组件渲染失败`);
process.exit(bad === 0 ? 0 : 1);
