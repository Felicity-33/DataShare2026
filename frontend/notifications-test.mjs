// ============================================================
// notifications-test.mjs —— 通知中心 v4.9 逻辑自动化测试（Node 直跑）
// ------------------------------------------------------------
// 用法：在 frontend 目录执行  node notifications-test.mjs
// 说明：notifications.js 是纯 localStorage 逻辑模块（无 DOM 依赖），
//       这里用内存版 localStorage + EventTarget 模拟浏览器环境，
//       逐条验证 v4.9 的四个需求场景与关键回归项。
// 运行环境：Node 18+（无需安装任何依赖）
// ============================================================

// ---------------- 浏览器环境 polyfill ----------------
// 内存版 localStorage：模拟同源存储（多个"标签页"共享同一份）
class MemStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
globalThis.localStorage = new MemStorage();
// window 用 EventTarget 模拟（notifications.js 只用到 add/dispatch/removeEventListener）
globalThis.window = new EventTarget();
// Node 18 缺全局 CustomEvent，补一个最小实现
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class extends Event {
    constructor(type, opts = {}) { super(type); this.detail = opts.detail; }
  };
}

const nf = await import('./src/notifications.js');

// ---------------- 断言与用例框架 ----------------
let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name}`); }
}
function section(title) { console.log(`\n■ ${title}`); }

// 模拟"另一个标签页"写入：直接改 localStorage 并派生原生 storage 事件
// （浏览器里该事件由引擎在【其他】标签页自动派发，这里手工模拟等价触发）
function simulateOtherTabWrite(key, value) {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
  window.dispatchEvent(Object.assign(new Event('storage'), { key, newValue: value }));
}

// 测试账户与通用候选
const ACC = '0xABC0000000000000000000000000000000000001';
const todoReq = (id) => nf.nfAuthRequest(
  { requestId: id, fieldName: '运动健康', enterprise: '0x49f8...a3F9', totalPrice: '0.05', ts: Date.now() }, 'requests');
const resultDigest = (count) => nf.nfRevenueDigest({ count, total: String(count * 0.05), ts: Date.now() }, 'revenue');
const disputeOpen = (escrowId) => nf.nfDisputeRaised(
  { escrowId, fieldName: '消费偏好', amount: '0.5', reason: '数据质量争议', ts: Date.now() }, 'escrow', 'regulator');
const disputeDone = (escrowId) => nf.nfDisputeResolved(
  { escrowId, fieldName: '消费偏好', amount: '0.5', refunded: false, ts: Date.now() }, 'escrow', 'user');

// ============================================================
// 场景 1：新通知接收时正确进入"新通知区"（红色标识的数据前提）
// ------------------------------------------------------------
// UI 侧红色高亮（红底 + 红左边条 + 红点 + 铃铛角标）由 Header 按
// n.read === false 渲染 —— 数据层保证未读即为红色标识生效。
// ============================================================
section('场景 1：新通知接收 → 未读状态（红色标识生效前提）');
nf.clearNotifications(ACC);
let pushed = nf.pushNotifications(ACC, [todoReq(1)]);
let all = nf.getNotifications(ACC);
check('首次同步推送待办申请，返回新增未读数 = 1', pushed === 1);
check('通知 read = false（未读 → 界面渲染红色高亮 + 铃铛角标 +1）', all.length === 1 && all[0].read === false);
check('未读总数 = 1（铃铛红色角标显示 1）', nf.getUnreadCount(ACC) === 1);

// ============================================================
// 场景 2：点击通知 → 立即移除红色标识并转入历史记录
// ============================================================
section('场景 2：点击通知 → 标记已读 → 流转入历史区');
nf.markRead(ACC, 'approval:req1:open');
all = nf.getNotifications(ACC);
check('点击后该通知 read = true（红标立即消失、铃铛角标归零）', all[0].read === true && nf.getUnreadCount(ACC) === 0);
check('已读通知进入历史分区（Header 按 read 拆分，落在历史折叠区）', all.filter((n) => n.read).length === 1);

// ============================================================
// 场景 3：未点击的新通知保持在新通知列表（核心修复回归）
// ------------------------------------------------------------
// 旧 bug：账户首登基线（firstRun）把包括待办在内的全部候选一刀切
// 置为已读 → 未经点击直接进历史。新逻辑仅「结果知晓」类自动归档。
// ============================================================
section('场景 3：未点击的通知不自动进历史（首登基线修复回归）');
// 3a. 模拟旧 bug 场景：全新存档 + 链上已有待处理申请 → 必须保持未读
//     （escrow 7：申诉已有裁决结果 → 联动闭合；escrow 8：申诉仍待决 → 保持未读）
nf.clearNotifications(ACC);
nf.pushNotifications(ACC, [todoReq(2), resultDigest(3), disputeOpen(7), disputeDone(7), disputeOpen(8)]);
all = nf.getNotifications(ACC);
const req2 = all.find((n) => n.id === 'approval:req2:open');
const digest = all.find((n) => n.id === 'funds:revenue');
check('首登基线：待审批申请保持未读（旧逻辑会被静默吞进历史）', req2 && req2.read === false);
check('首登基线：结果知晓类（收益汇总）自动归档已读，避免红点轰炸', digest && digest.read === true);
check('首登基线：待决申诉提醒（escrow 8）保持未读', all.find((n) => n.id === 'ruling:8:open')?.read === false);
// 裁决结果闭合待办：disputeDone 的 closesId 应把 disputeOpen 闭合为已读
check('闭合联动：已裁决的申诉提醒（escrow 7）被裁决结果闭合为已读', all.find((n) => n.id === 'ruling:7:open')?.read === true);
check('未读总数 = 2（待审批申请 + 待决申诉；结果类不计入）', nf.getUnreadCount(ACC) === 2);
// 3b. 反复重新同步（模拟页面刷新 / 链上事件触发 load()），未点击的绝不能"自动变已读"
for (let i = 0; i < 3; i++) nf.pushNotifications(ACC, [todoReq(2), resultDigest(3), disputeOpen(7), disputeDone(7), disputeOpen(8)]);
all = nf.getNotifications(ACC);
check('多次重新同步后，未点击的待办依旧未读、仍在新通知区', all.find((n) => n.id === 'approval:req2:open')?.read === false && nf.getUnreadCount(ACC) === 2);
// 3c. 点击其中一条 → 只影响被点击的那条
nf.markRead(ACC, 'approval:req2:open');
check('点击申请 #2 后：其转历史，申诉提醒不受影响仍在新通知区', nf.getUnreadCount(ACC) === 1 && all.find((n) => n.id === 'ruling:7:open') !== undefined);

// ============================================================
// 场景 4：多标签页状态实时同步
// ------------------------------------------------------------
// 浏览器机制：其他标签页写 localStorage 时，本页收到原生 storage 事件。
// 这里验证订阅 API 对 storage 事件的监听与清理逻辑（等价于浏览器触发）。
// ============================================================
section('场景 4：跨标签页实时同步（storage 事件监听）');
nf.clearNotifications(ACC);
let fires = 0;
const unsub = nf.onNotificationsChange(() => { fires++; });
// 模拟另一个标签页标记已读后的存档回写
simulateOtherTabWrite(`dv_notifications_${ACC.toLowerCase()}`, JSON.stringify({ init: true, list: [], seen: {} }));
check('其他标签页写入存档 → 本页订阅回调被触发（面板/角标即时刷新）', fires === 1);
// 无关 key 的 storage 事件不应误触发
simulateOtherTabWrite('unrelated_key', 'x');
check('无关存储写入不误触发通知刷新', fires === 1);
// 模拟 localStorage.clear()（浏览器派发 key = null 的 storage 事件）
window.dispatchEvent(Object.assign(new Event('storage'), { key: null }));
check('localStorage 全清（key=null）也能触发刷新', fires === 2);
unsub();
simulateOtherTabWrite(`dv_notifications_${ACC.toLowerCase()}`, null);
check('取消订阅后不再触发（无内存泄漏）', fires === 2);
// 同页写入走 CustomEvent：push 后计数 +1
const unsub2 = nf.onNotificationsChange(() => { fires++; });
nf.pushNotifications(ACC, [todoReq(9)]);
check('本页推送新通知 → 订阅回调同步触发', fires === 3);
unsub2();

// ============================================================
// 回归 A：消费记忆（v4.8）—— 已读后清历史，重新同步不复活
// ============================================================
section('回归 A：已读通知清历史后不复活（seen 消费记忆）');
nf.clearNotifications(ACC);
nf.pushNotifications(ACC, [todoReq(5)]);
nf.markRead(ACC, 'approval:req5:open');           // 用户点击 → 已读
nf.clearHistory(ACC);                              // 清空历史（移除已读条目）
const again = nf.pushNotifications(ACC, [todoReq(5)]); // 重新同步同 id 候选
check('已读 + 清历史后，同 id 通知重新同步不复活为未读', again === 0 && nf.getNotifications(ACC).length === 0);

// ============================================================
// 回归 B：聚合 digest —— 摘要变化重新点亮，未点击保持未读
// ============================================================
section('回归 B：收益汇总 digest 摘要变化重新点亮');
nf.clearNotifications(ACC);
nf.pushNotifications(ACC, [resultDigest(1)]);
nf.markRead(ACC, 'funds:revenue');                 // 用户看过（已读）
check('digest 已读后摘要未变 → 重新同步不打扰', nf.pushNotifications(ACC, [resultDigest(1)]) === 0 && nf.getUnreadCount(ACC) === 0);
nf.pushNotifications(ACC, [resultDigest(2)]);      // 新分账入账 → 摘要变化
check('digest 摘要变化（新入账）→ 重新点亮为未读', nf.getUnreadCount(ACC) === 1);
for (let i = 0; i < 3; i++) nf.pushNotifications(ACC, [resultDigest(2)]);
check('digest 未读期间反复同步保持未读（未点击不进历史）', nf.getUnreadCount(ACC) === 1);

// ---------------- 结果汇总 ----------------
console.log(`\n==================== 测试结果 ====================`);
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed > 0 ? 1 : 0);
