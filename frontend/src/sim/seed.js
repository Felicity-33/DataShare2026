// ============================================================
// seed.js —— 模拟链的预置演示数据（播种器）
// ------------------------------------------------------------
// 目标：让评委一进入演示模式就看到「活」的平台，而不是空表：
//   - 三个演示身份已注册角色（用户 / 企业 / 监管，页面可直接切换）
//   - 用户的 5 个数据字段已确权（dataRef 指向 public/data 的真实链下文件）
//   - 企业已有押金、两条有效授权、一张待审批申请（用户端通知红点）
//   - 5 笔历史托管单覆盖完整状态机：已提现 ×2 / 争议中 ×1 / 已确认待提现 ×1 / 托管中 ×1
//   - 3 条合约级拦截留痕（AccessAttemptBlocked）→ 企业信誉分按公式扣减
//   - 全部事件按时间分布在最近 7 天 → 三端图表开箱有数据
// 所有金额一律 BigInt(wei)，数值口径与真实链完全一致。
// 时间轴同样必须链上自洽：区块号随时间递增、充值先于调用、拦截原因与合约
// _checkCall 判定一致；交付凭证待链下数据加载后由 hydrateSeedDeliveryHashes 回填真实摘要。
// ============================================================

// wei 辅助：n ETH → BigInt(wei)
const eth = (n) => BigInt(Math.round(n * 1e18));
// 用户实得 = 90%（合约 platformSplitOf：平台 10%）
const toUser = (n) => eth(n) - (eth(n) * 1000n) / 10000n;

export function buildSeedState({ freshState, nowSec, randHash, commitmentOf, platformTreasury }) {
  const st = freshState();
  const DAY = 86400;
  const now = nowSec();
  const at = (daysAgo, plusSec = 0) => now - Math.round(daysAgo * DAY) + plusSec;

  // ---------------- 演示身份（与 mockChain.js 的地址常量一致） ----------------
  const USER = '0x8E2Ba5c9F31D4B7a06cE93f15A802b47d1Cc6f30';
  const ENT = '0x49f880A668C62C9390Ea0E1e36cC6637A50ba3F9';   // = config.DEMO_ENTERPRISE_ADDRESS
  const REG = '0x41C7dF0a29B6E8351cA0b942D8f57e36A90b4d17';

  st.roles[USER] = 'user';
  st.roles[ENT] = 'enterprise';
  st.roles[REG] = 'regulator';

  // ---------------- 出块工具：每个历史事件占一个区块 ----------------
  let bn = 0;
  const block = (ts) => {
    bn += 1;
    st.blocks[bn] = ts;
    const hash = randHash();
    st.txs[hash] = { blockNumber: bn };
    return { blockNumber: bn, transactionHash: hash };
  };
  // 追加一条历史事件（args 顺序与 mockChain.EVENT_ABI 一致）。
  // ★ 事件先收集、不出块：真实链上「区块号」必然随时间递增，若按书写顺序出块，
  //   证据链会出现「区块 #13 之后是 #12」这种链上不可能的情形（曾经真实存在）。
  //   全部收集完再按时间排序出块，见文件末尾。
  const pending = [];
  const ev = (name, ts, args) => pending.push({ name, ts, args });

  // ---------------- 字段确权（5 个，dataRef 指向链下真实数据文件） ----------------
  const fields = [
    { name: '出行习惯·通勤路线', ref: '出行习惯' },
    { name: '运动健康·心率记录', ref: '运动健康' },
    { name: '消费偏好·月度账单', ref: '消费偏好' },
    { name: '兴趣娱乐·内容偏好', ref: '兴趣娱乐' },
    { name: '社交活跃·互动特征', ref: '社交活跃' },
  ];
  fields.forEach((f, i) => {
    const ts = at(7) + i * 600;
    // ★ 链上 commitment = Poseidon(secret, owner)（与 zk.js commitmentOf / 合约 registerField 同口径）。
    //   权属密钥采用与 scripts/deploy.js 一致的确定性演示值（1000001+i），
    //   与真实链确权写入的承诺类型完全一致，不再使用占位整数。
    const commitment = BigInt(commitmentOf(1000001n + BigInt(i), USER));
    st.fields.push({
      id: i, owner: USER, name: f.name, callCount: 0,
      createdAt: ts, commitment, dataRef: f.ref,
    });
    ev('FieldRegistered', ts, [BigInt(i), USER, f.name]);
    ev('FieldVerified', ts, [BigInt(i), USER, commitment]);
  });

  // ---------------- 押金充值（合计 3.5 ETH） ----------------
  // ★ 时间必须落在「授权之后、最早一笔调用之前」：
  //   合约 callData 要求押金余额 ≥ 调用费用，充值若晚于调用则链上根本不可能成交；
  //   同时证据链的展示顺序是 确权 → 授权 → 充值 → 调用，充值也必须晚于授权。
  const dep1 = eth(2);
  st.deposits[ENT] = dep1;
  ev('DepositMade', at(6) + 900, [ENT, dep1, st.deposits[ENT]]);
  const dep2 = eth(1.5);
  st.deposits[ENT] += dep2;
  ev('DepositMade', at(6) + 1500, [ENT, dep2, st.deposits[ENT]]);

  // ---------------- 授权与申请 ----------------
  // f0 → 企业：永久授权（6 天前）
  st.permissions['0:' + ENT] = { active: true, expiry: 0, maxCalls: 0, usedCalls: 0 };
  st.totalAuthorizations += 1n;
  ev('PermissionGranted', at(6), [0n, USER, ENT, 0n, 0n]);
  // f1 → 企业：按次 2 次（6 天前）—— 与下方 2 笔 f1 调用刚好用尽，
  //   这样后面那条「次数已用尽」的拦截记录才在链上成立
  st.permissions['1:' + ENT] = { active: true, expiry: 0, maxCalls: 2, usedCalls: 0 };
  st.totalAuthorizations += 1n;
  ev('PermissionGranted', at(6) + 300, [1n, USER, ENT, 0n, 2n]);

  // 申请单：req0 / req1 已同意（与上面两条授权对应），req3 被拒，req2 待审批（通知红点）
  const mkReq = (id, fieldId, periodType, units, resolved, ts) => {
    const unitPrice = periodType === 0 ? eth(0.05) : eth(0.5);
    const r = {
      requestId: id, fieldId, user: USER, enterprise: ENT,
      periodType, units, unitPrice, totalPrice: unitPrice * BigInt(units), resolved,
    };
    st.authRequests.push(r);
    ev('AuthorizationRequested', ts, [BigInt(id), BigInt(fieldId), USER, ENT, periodType, BigInt(units), unitPrice, r.totalPrice]);
    return r;
  };
  mkReq(0, 0, 0, 1, true, at(6) + 100);
  st.authRequests[0].resolved = true;
  ev('AuthorizationApproved', at(6) + 180, [0n, 0n, USER, ENT, 0, 1n, eth(0.05), eth(0.05)]);
  mkReq(1, 1, 0, 2, true, at(6) + 400);
  st.authRequests[1].resolved = true;
  ev('AuthorizationApproved', at(6) + 480, [1n, 1n, USER, ENT, 0, 2n, eth(0.05), eth(0.1)]);
  mkReq(2, 2, 0, 5, false, at(0, -7200));              // ★ 待审批：用户端红点直达
  mkReq(3, 3, 1, 7, false, at(4) + 900);
  st.authRequests[3].resolved = true;
  ev('AuthorizationDenied', at(4) + 960, [3n, 3n, USER, ENT, 1, 7n, eth(0.5), eth(3.5)]);

  // ---------------- 历史托管单（覆盖完整状态机） ----------------
  const price = eth(0.05);
  const mkEscrow = (id, fieldId, ts) => {
    st.escrows.push({
      id, fieldId, user: USER, enterprise: ENT, amount: price,
      deliveryHash: '0x' + String(1000 + id).padStart(64, '0'),
      createdAt: ts, confirmedAt: 0,
      disputed: false, settled: false, refunded: false, disputeReason: '',
    });
    st.deposits[ENT] -= price;
    st.fields[fieldId].callCount += 1;
    st.permissions[`${fieldId}:${ENT}`].usedCalls += 1;
    st.successCalls[ENT] = (st.successCalls[ENT] || 0) + 1;
    st.totalDistributed += price;
    ev('EscrowCreated', ts, [BigInt(id), BigInt(fieldId), USER, ENT, price, st.escrows[id].deliveryHash, BigInt(ts + 600)]);
  };
  // 用户提现（90% 到账 + 平台 10% 服务费，口径与合约 withdrawRevenue 一致）
  const withdraw = (id, ts) => {
    const e = st.escrows[id];
    e.settled = true;
    const u = toUser(0.05);
    const p = e.amount - u;
    st.totalWithdrawn += u;
    st.totalPlatformRevenue += p;
    ev('PlatformRevenuePaid', ts, [BigInt(id), platformTreasury, p]);
    ev('RevenueWithdrawn', ts, [BigInt(id), USER, u]);
    ev('RevenueDistributed', ts, [BigInt(e.fieldId), USER, ENT, u]);
  };

  // esc0：f0 · 6 天前调用 → 当天确认收货 → 5.5 天前提现（已完成闭环）
  mkEscrow(0, 0, at(6) + 3600);
  st.escrows[0].confirmedAt = at(6) + 4000;
  ev('DeliveryConfirmed', at(6) + 4000, [0n, ENT, 0n, st.escrows[0].deliveryHash]);
  withdraw(0, at(5.5));

  // esc1：f1 · 5 天前调用 → 未确认，争议窗口自然结束 → 4.8 天前用户提现
  mkEscrow(1, 1, at(5) + 1800);
  withdraw(1, at(4.8));

  // esc2：f0 · 3 天前调用 → 争议中（企业已申诉，等监管裁决）
  mkEscrow(2, 0, at(3));
  st.escrows[2].disputed = true;
  // 申诉理由取「授权范围 / 口径」类争议：摘要校验必然是「一致」的，
  // 若理由写成「摘要与链上凭证不一致」，会与凭证校验结果自相矛盾
  st.escrows[2].disputeReason = '交付数据的统计口径与授权范围不符，申请复核';
  ev('DisputeRaised', at(2.9), [2n, ENT, 0n, st.escrows[2].disputeReason]);

  // esc3：f0 · 2 天前调用 → 企业已确认收货 → 待用户提现（解锁倒计时可见）
  mkEscrow(3, 0, at(2));
  st.escrows[3].confirmedAt = at(2) + 300;
  ev('DeliveryConfirmed', at(2) + 300, [3n, ENT, 0n, st.escrows[3].deliveryHash]);

  // esc4：f1 · 1 天前调用 → 托管中（争议窗口未结束，挑战期倒计时可见）
  mkEscrow(4, 1, at(1));

  // ---------------- 合约级拦截留痕（3 条，企业信誉分按公式扣减） ----------------
  // [几天前, 字段, 拦截原因]；原因与合约 _checkCall 的判定一一对应：
  //   f2 从未授权（申请待审批）、f3 授权被拒 → 「未获得授权」；
  //   f1 共 2 次授权已被 esc1 / esc4 用尽 → 「次数已用尽」，故时间必须晚于 esc4
  const blocked = [
    [5, 2, '未获得授权，请先申请授权'],
    [4, 3, '未获得授权，请先申请授权'],
    [0.5, 1, '该授权调用次数已用尽，请重新申请'],
  ];
  blocked.forEach(([d, fieldId, reason]) => {
    const ts = at(d);
    st.blockedAttempts.push({ id: st.blockedAttempts.length, fieldId, enterprise: ENT, reason, timestamp: ts });
    st.blockedCount[ENT] = (st.blockedCount[ENT] || 0) + 1;
    ev('AccessAttemptBlocked', ts, [ENT, BigInt(fieldId), reason]);
  });

  // ---------------- 统一出块：按时间递增（区块号与时间严格同序） ----------------
  // 真实链上区块号必然随时间递增，事件先收集后排序，保证前端证据链
  // 逐节点读到的「区块 #n」是递增的，绝不出现 #13 之后跟 #12。
  // （同秒事件保持收集顺序：确权先于验证，注册先于验证）
  pending.sort((a, b) => a.ts - b.ts);
  pending.forEach((p) => {
    st.events.push({ name: p.name, args: p.args, ts: p.ts, ...block(p.ts) });
  });

  // ---------------- 汇总口径 ----------------
  // 企业信誉：600 + 5×8 − 3×60 = 460（>300，调用权限正常）
  // 押金余额：3.5 − 5×0.05 = 3.25 ETH
  // totalDistributed 0.25 / totalWithdrawn 0.09 / totalPlatformRevenue 0.01
  st.blockNumber = bn;
  return st;
}
