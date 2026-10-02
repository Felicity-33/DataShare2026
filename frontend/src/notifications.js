// ============================================================
// notifications.js —— 铃铛通知中心（v4.9 已读流转修复 + 跨页同步）
// ------------------------------------------------------------
// 职责：
//   1. 核心业务通知存储（localStorage，按钱包账户隔离）
//   2. 四大分类：监管裁决 / 审批流程 / 资金变动 / 异常拦截
//   3. 三级优先级机制：紧急告警 → 核心待办 → 结果知晓
//   4. 双区模型（v4.7）：未读 = 当前通知区；已读 = 历史折叠区。
//      点击新通知即自动流转入历史区，历史区按「核心功能相关 /
//      用户相关 / 企业相关」三类分组归档，支持清空（带二次确认）
//
// 状态同步（v4.8 修复）：
//   - 「消费记忆 seen」：已读状态不再依附于列表条目本身 —— 每条
//     通知被标记已读时，同步把 id 记入存档级 seen 映射；此后即使
//     条目被清空历史 / 超限裁剪移除，重新同步时凭 seen 直接跳过，
//     彻底杜绝「切换账户后已处理通知复活为未读」的问题；
//   - digest 聚合通知例外：重新点亮代表确有新内容（如新分账入账），
//     点亮时撤销记忆、再次已读时按新摘要重新记录；
//   - 旧版本存档自愈：同步时把列表中已读但缺记忆的条目补记 seen。
//
// 已读流转修复（v4.9）：
//   - 首登基线不再「一刀切全部已读」：仅「结果知晓」类自动归档，
//     待办（TODO）与紧急告警（URGENT）保持未读 —— 用户未点击的
//     待办通知绝不自动进入历史区（旧逻辑会把切换账户 / 首次同步
//     时的待处理申请静默吞进历史，红点从未出现就被标为已读）；
//   - 跨标签页实时同步：订阅原生 storage 事件，多标签页同时打开
//     工作台时，任一页标记已读 / 收到新通知，其他页立即同步刷新。
// ============================================================

// 存储前缀：按账户地址隔离（小写化，避免大小写差异产生多份存档）
const STORAGE_PREFIX = 'dv_notifications_';
// 跨组件刷新事件名
const CHANGE_EVENT = 'dv:notifications-changed';
// 单账户通知留存上限（精简版收紧：超出后丢弃最旧的已读通知）
const MAX_KEEP = 40;

// ============================================================
// 优先级定义（数值越小越靠前展示）
//   0 = 紧急告警：异常拦截 / 资金被锁定，需要立即关注
//   1 = 核心待办：待审批 / 待裁决，需要处理
//   2 = 结果知晓：裁决结果 / 授权结果 / 收益汇总，知情即可
// ============================================================
export const PRIORITY = { URGENT: 0, TODO: 1, RESULT: 2 };

// ============================================================
// 分类定义：三端统一分类体系，界面徽标 / 配色由这里统一管理
// ============================================================
export const CATEGORIES = [
  { key: 'ruling',   label: '监管裁决', dot: 'bg-rose-500',    chip: 'bg-rose-50 text-rose-600' },
  { key: 'approval', label: '审批流程', dot: 'bg-cyan-500',    chip: 'bg-cyan-50 text-cyan-600' },
  { key: 'funds',    label: '资金变动', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-600' },
  { key: 'blocked',  label: '异常拦截', dot: 'bg-amber-500',   chip: 'bg-amber-50 text-amber-600' },
  { key: 'system',   label: '系统公告', dot: 'bg-slate-500',   chip: 'bg-slate-100 text-slate-600' },
];

// ============================================================
// 历史通知分组（v4.7）：历史折叠区按三类归档，便于按主体回溯
//   core       = 核心功能相关（待办 / 紧急告警 / 裁决流程）
//   user       = 用户相关（收益汇总 / 用户侧裁决结果）
//   enterprise = 企业相关（授权结果 / 调用拦截 / 企业侧裁决结果）
// ============================================================
export const HISTORY_GROUPS = [
  { key: 'core',       label: '核心功能相关' },
  { key: 'user',       label: '用户相关' },
  { key: 'enterprise', label: '企业相关' },
];

// 历史分组归属：新模板显式携带 group 字段；
// 旧存档无 group 时按分类兜底映射（资金→用户 / 拦截→企业 / 其余→核心）
export function historyGroupOf(n) {
  if (n?.group) return n.group;
  if (n?.category === 'funds') return 'user';
  if (n?.category === 'blocked') return 'enterprise';
  return 'core';
}

// ---------------- 存储层（账户隔离） ----------------

function storeKey(account) {
  return STORAGE_PREFIX + String(account || '').toLowerCase();
}

function loadStore(account) {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey(account)) || 'null');
    if (!raw || !Array.isArray(raw.list)) return null; // null = 首次（尚无基线）
    // seen 为 v4.8 新增的消费记忆层，旧存档缺省补空对象（向后兼容）
    return { init: true, list: raw.list, seen: raw.seen && typeof raw.seen === 'object' ? raw.seen : {} };
  } catch {
    return null;
  }
}

function saveStore(account, list, seen = {}) {
  localStorage.setItem(storeKey(account), JSON.stringify({ init: true, list, seen }));
  // 派发刷新事件：Header 面板订阅后自动更新
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { account } }));
}

// ============================================================
// 对外 API
// ============================================================

// 读取某账户全部通知（优先级升序 + 时间倒序：重要的事永远排在最前）
export function getNotifications(account) {
  const store = loadStore(account);
  if (!store) return [];
  return [...store.list].sort(
    (a, b) => (a.priority ?? PRIORITY.RESULT) - (b.priority ?? PRIORITY.RESULT) || b.ts - a.ts
  );
}

// 未读总数（铃铛徽标）
export function getUnreadCount(account) {
  const store = loadStore(account);
  if (!store) return 0;
  return store.list.filter((n) => !n.read).length;
}

// 幂等推送：candidates 为通知数组（结构见各 nf* 模板）；
// drop 为可选谓词 —— 命中的历史存量通知直接剔除（用于版本升级清洗旧类型）；
// 返回本次真正新增（未读）条数
export function pushNotifications(account, candidates = [], drop = null) {
  if (!account) return 0;
  const store = loadStore(account);
  const firstRun = !store;                 // 首次同步 → 建立已读基线
  // 存档清洗：v4.5 起移除欢迎类纯引导通知，v4.6 起由各端 drop 谓词
  // 移除本端已淘汰的历史通知类型，避免旧文案条目残留面板
  const list = store ? store.list.filter((n) => !String(n.id).startsWith('system:welcome')) : [];
  // ★ 消费记忆（v4.8）：从存档恢复 seen；记录「已读过的通知 id → 已读时摘要」，
  //   独立于列表存活 —— 条目被清空/裁剪后，同 id 候选凭此直接跳过不复活
  const seen = store?.seen ? { ...store.seen } : {};
  if (drop) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (drop(list[i])) list.splice(i, 1);
    }
  }
  // ★ 旧存档自愈：v4.8 之前的已读条目没有记忆，这里补记一次，
  //   保证老用户升级后清空历史 / 裁剪同样不会复活
  for (const n of list) {
    if (n.read && seen[n.id] === undefined) seen[n.id] = n.summary || '';
  }
  const idSet = new Set(list.map((n) => n.id));
  let pushed = 0;

  for (const c of candidates) {
    if (!c || !c.id) continue;
    // 聚合更新型通知（digest）：固定 id 全局仅一条，
    // 摘要变化时原位更新并重新点亮红点，避免同类事件逐条刷屏
    if (c.digest) {
      const target = list.find((n) => n.id === c.id);
      if (!target) {
        // ★ 已消费且摘要无变化（如清空历史后重新同步）→ 不再打扰；
        //   摘要变化（新分账入账 / 新拦截发生）才允许重新出现
        if (seen[c.id] === (c.summary || '')) continue;
        idSet.add(c.id);
        // 首登基线（v4.9）：仅「结果知晓」类直接归档已读；
        // 待办 / 紧急类聚合通报（如申诉）保持未读，等用户自己点击处理
        const read = firstRun && (c.priority ?? PRIORITY.RESULT) >= PRIORITY.RESULT;
        list.push(buildNotification(c, read));
        if (read) seen[c.id] = c.summary || '';
        else delete seen[c.id];
        if (!read) pushed++;
      } else if (target.summary !== c.summary) {
        target.summary = c.summary;
        target.ts = c.ts;
        if (target.read) {
          target.read = false;
          delete seen[c.id]; // ★ 重新点亮 = 撤销消费记忆（确有新内容）
          pushed++;
        }
      }
      continue;
    }
    // ★ 幂等 2.0（v4.8）：已消费过的通知（已读后被清空历史 / 超限裁剪移除）
    //   直接跳过 —— 切换账户触发重新同步也不会复活为未读
    if (seen[c.id] !== undefined) continue;
    if (idSet.has(c.id)) continue; // 幂等：已存在直接跳过
    idSet.add(c.id);
    // 首登基线（v4.9 修复「未点击自动进历史」）：
    //   仅「结果知晓」类（历史收益汇总 / 旧结果通报）自动置已读，避免红点轰炸；
    //   待办（TODO）与紧急告警（URGENT）必须保持未读 —— 它们是用户还没处理的事，
    //   未经点击绝不进入历史区（旧逻辑一刀切全部已读，待办红点被静默吞掉）。
    //   stickyUnread 仍生效：候选显式声明时即使在基线也强制未读。
    const read = firstRun
      ? !c.stickyUnread && (c.priority ?? PRIORITY.RESULT) >= PRIORITY.RESULT
      : !!c.read;
    list.push(buildNotification(c, read));
    if (read) seen[c.id] = c.summary || ''; // ★ 基线已读同样记入消费记忆
    if (!read) pushed++;
    // 闭合联动：本条推送会自动闭合的旧红点（如结果闭合待办）
    if (c.closesId) {
      const target = list.find((n) => n.id === c.closesId && !n.read);
      if (target) {
        target.read = true;
        seen[target.id] = target.summary || ''; // ★ 被闭合的待办同步记入消费记忆
        pushed = Math.max(0, pushed - 1);
      }
    }
  }

  if (list.length > MAX_KEEP) {
    // 超限裁剪：优先丢弃最早的已读，未读尽量保留
    // （被裁剪条目的 seen 记忆仍在，重新同步不会复活）
    const readSorted = list.filter((n) => n.read).sort((a, b) => a.ts - b.ts);
    let overflow = list.length - MAX_KEEP;
    for (const r of readSorted) {
      if (overflow <= 0) break;
      const idx = list.indexOf(r);
      if (idx >= 0) { list.splice(idx, 1); overflow--; }
    }
    if (overflow > 0) list.splice(0, overflow); // 兜底：直接丢最旧
  }

  // seen 容量维护：上限 300 条，超出按插入顺序淘汰最旧（防止长期膨胀）
  const seenKeys = Object.keys(seen);
  if (seenKeys.length > 300) {
    for (const k of seenKeys.slice(0, seenKeys.length - 300)) delete seen[k];
  }

  // 存档已存在则始终回写（保持 seen 记忆与列表一致）；全新账户且无内容则不产生空存档
  if (list.length || store) saveStore(account, list, seen);
  return pushed;
}

// 通知对象统一构建（含默认值兜底；group 决定历史折叠区归档分组）
function buildNotification(c, read) {
  return {
    id: c.id,
    category: c.category || 'system',
    priority: c.priority ?? PRIORITY.RESULT,
    group: historyGroupOf(c),
    title: c.title || '通知',
    summary: c.summary || '',
    tabKey: c.tabKey || '',
    ts: c.ts || Date.now(),
    read,
  };
}

// 单条标记已读（也用于「自主操作时闭合对应待办红点」）
export function markRead(account, id) {
  const store = loadStore(account);
  if (!store) return;
  const item = store.list.find((n) => n.id === id);
  if (item && !item.read) {
    item.read = true;
    store.seen[item.id] = item.summary || ''; // ★ 消费记忆同步记录（v4.8）
    saveStore(account, store.list, store.seen);
  }
}

// 全部标记已读
export function markAllRead(account) {
  const store = loadStore(account);
  if (!store) return;
  let changed = false;
  store.list.forEach((n) => {
    if (!n.read) {
      n.read = true;
      store.seen[n.id] = n.summary || ''; // ★ 消费记忆同步记录（v4.8）
      changed = true;
    }
  });
  if (changed) saveStore(account, store.list, store.seen);
}

// 清空历史通知（v4.7）：仅移除已读归档条目，未读保留在当前通知区；
// seen 消费记忆一并保留 —— 清空后重新同步（含切换账户）不会复活（v4.8）
export function clearHistory(account) {
  const store = loadStore(account);
  if (!store) return 0;
  const kept = store.list.filter((n) => !n.read);
  const removed = store.list.length - kept.length;
  if (removed > 0) saveStore(account, kept, store.seen);
  return removed;
}

// 清空某账户全部通知（演示 / 测试用）
export function clearNotifications(account) {
  localStorage.removeItem(storeKey(account));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { account } }));
}

// 订阅变更（返回取消订阅函数，供 Header useEffect 使用）
// ★ v4.9 跨标签页实时同步：本页写入 → CustomEvent（同页立即刷新）；
//   其他标签页写入 → 浏览器原生派发 storage 事件（本页监听后刷新），
//   两个标签页的通知面板 / 铃铛徽标保持一致，无需手动刷新页面。
export function onNotificationsChange(handler) {
  // 其他标签页触发的 storage 事件：key 命中通知存档前缀（或 null = clear 全清）才触发
  const storageHandler = (e) => {
    if (!e.key || e.key.startsWith(STORAGE_PREFIX)) handler(e);
  };
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener('storage', storageHandler);
  };
}

// ============================================================
// 差异化通知模板（三端共用；tabKey 由各工作台按自身导航传入）
// ------------------------------------------------------------
// 文案原则（v4.6 苹果精简版）：
//   ① 只推第三方事件 —— 审批结果/充值/发起申请/提交申诉等自主
//      操作不再产生通知（裁决时由动作函数直接闭合待办红点）；
//   ② 高频同类事件（收益分账 / 全网拦截）聚合为单条通报；
//   ③ 标题 ≤ 10 字、摘要一句话讲清「谁 / 多少钱 / 什么状态」，
//      不设操作指引 —— 点击通知即直达对应功能页。
// ============================================================

// ---- 审批流程：用户收到企业授权申请（核心待办） ----
export function nfAuthRequest({ requestId, fieldName, enterprise, totalPrice, ts }, tabKey) {
  return {
    id: `approval:req${requestId}:open`,
    category: 'approval',
    priority: PRIORITY.TODO,
    group: 'core',
    title: `新授权申请 #${requestId}`,
    summary: `${enterprise} 申请调用「${fieldName}」，报价 ${totalPrice} ETH。`,
    tabKey,
    ts,
  };
}

// ---- 审批流程：企业收到授权申请结果（用户审批决定，第三方事件） ----
export function nfAuthResult({ requestId, fieldName, approved, ts }, tabKey) {
  return {
    id: `approval:req${requestId}:${approved ? 'ok' : 'no'}`,
    category: 'approval',
    priority: PRIORITY.RESULT,
    group: 'enterprise',
    title: `授权申请 #${requestId} ${approved ? '已通过' : '被拒绝'}`,
    summary: `「${fieldName}」授权${approved ? '已生效' : '未生效，无资金变动'}。`,
    tabKey,
    ts,
  };
}

// ---- 资金变动：用户收益汇总（聚合单条，新分账入账时原位更新） ----
export function nfRevenueDigest({ count, total, ts }, tabKey) {
  return {
    id: 'funds:revenue', // 固定 id：聚合通知全局仅一条
    digest: true,
    category: 'funds',
    priority: PRIORITY.RESULT,
    group: 'user',
    title: '收益到账',
    summary: `累计 ${count} 笔数据分账，共 +${total} ETH。`,
    tabKey,
    ts,
  };
}

// ---- 异常拦截：企业调用被合约拦截（安全告警，逐条保留） ----
export function nfBlocked({ fieldId, reason, ts }, tabKey) {
  return {
    id: `blocked:fld${fieldId}-${reason}-${ts}`,
    category: 'blocked',
    priority: PRIORITY.URGENT,
    group: 'enterprise',
    title: `异常拦截 · 字段 #${fieldId}`,
    summary: `一次调用未通过授权校验：${reason || '未知原因'}。`,
    tabKey,
    ts,
  };
}

// ---- 异常拦截：监管端全网拦截汇总（聚合单条） ----
export function nfBlockedDigest({ count, latestReason, ts }, tabKey) {
  return {
    id: 'blocked:digest', // 固定 id：聚合通知全局仅一条
    digest: true,
    category: 'blocked',
    priority: PRIORITY.RESULT,
    group: 'core',
    title: '异常拦截通报',
    summary: `全网累计拦截 ${count} 次，最近一次：${latestReason || '未知原因'}。`,
    tabKey,
    ts,
  };
}

// ---- 监管裁决：申诉通知 ----
// role: 'user'=用户的字段被申诉（紧急）| 'regulator'=监管收到新申诉（核心待办）
// （企业发起申诉属自主操作，不再产生通知 —— 裁决结果通知足以覆盖）
export function nfDisputeRaised({ escrowId, fieldName, amount, reason, ts }, tabKey, role) {
  const byRole = {
    user: {
      priority: PRIORITY.URGENT,
      title: `数据被申诉 #${escrowId}`,
      summary: `企业就「${fieldName}」（${amount} ETH）发起申诉，资金锁定待裁决。`,
    },
    regulator: {
      priority: PRIORITY.TODO,
      title: `新申诉待裁决 #${escrowId}`,
      summary: `「${fieldName}」（${amount} ETH）：${reason}`,
    },
  };
  const t = byRole[role] || byRole.regulator;
  return {
    id: `ruling:${escrowId}:open`,
    category: 'ruling',
    priority: t.priority,
    group: 'core',
    title: t.title,
    summary: t.summary,
    tabKey,
    ts,
  };
}

// ---- 监管裁决：裁决结果（第三方裁决决定；闭合用户端「被申诉」红点） ----
// （监管自行裁决归档不再产生通知 —— 裁决动作时直接闭合「待裁决」红点）
export function nfDisputeResolved({ escrowId, fieldName, amount, refunded, ts }, tabKey, role) {
  const byRole = {
    user: {
      group: 'user',
      title: `裁决结果 #${escrowId}`,
      summary: refunded
        ? `申诉成立，${amount} ETH 已退回企业押金池。`
        : `申诉驳回，90% 收益已放款到账。`,
    },
    enterprise: {
      group: 'enterprise',
      title: `裁决结果 #${escrowId}`,
      summary: refunded
        ? `申诉成立，${amount} ETH 已退回押金池。`
        : `申诉驳回，${amount} ETH 已放款，信誉 -150。`,
    },
  };
  const t = byRole[role] || byRole.user;
  return {
    id: `ruling:${escrowId}:done`,
    category: 'ruling',
    priority: PRIORITY.RESULT,
    group: t.group,
    closesId: role === 'user' ? `ruling:${escrowId}:open` : undefined,
    title: t.title,
    summary: t.summary,
    tabKey,
    ts,
  };
}
