// ============================================================
// ai.js —— AI 辅助能力（★ 只做辅助解读，不参与任何链上决策）
// ------------------------------------------------------------
// 设计边界（既是技术约束，也是合规要点）：
//   1. AI 只做三件事：理解自然语言、解释数据、提示风险；
//   2. 定价、扣款、拦截、放款、裁决全部由智能合约的**确定性规则**执行，
//      AI 既不参与、也无法影响任何资金流向与权限变更；
//   3. 所有链上写操作仍需人工在钱包中确认（human-in-the-loop）；
//   4. 本文件是**本地确定性实现**（规则 + 同义词表 + 区间比较），
//      不依赖外部大模型、结果可复现可审计 —— 演示环境不会"翻车"；
//      生产环境可将 requestIntent() / summarize() 换成大模型接口，
//      函数签名与返回结构保持不变，调用方无需改动。
//
// 为什么这样设计：链上共识的价值在于**规则透明可验证**，
// 若让 AI 直接参与资金与权限决策，反而会引入不可审计的黑盒。
// 因此本项目的立场是「可验证的确定性规则 + 可解释的 AI 助手」。
// ============================================================
import { getDataPayload } from './config.js';

// ---------- 同义词 / 关键词表 ----------
const AGE_BUCKETS = [
  { label: '18-25 岁', lo: 18, hi: 25 },
  { label: '25-30 岁', lo: 25, hi: 30 },
  { label: '30-40 岁', lo: 30, hi: 40 },
  { label: '40 岁以上', lo: 40, hi: 200 },
];

const SPEND_BUCKETS = [
  { label: '月消费 1000 以下', lo: 0, hi: 1000 },
  { label: '月消费 1000-3000', lo: 1000, hi: 3000 },
  { label: '月消费 3000-5000', lo: 3000, hi: 5000 },
  { label: '月消费 5000 以上', lo: 5000, hi: 9999999 },
];

const INTEREST_ALIASES = [
  { label: '运动户外', words: ['运动', '户外', '健身', '跑步', '瑜伽', '爬山', '骑行', '球'] },
  { label: '美食旅游', words: ['美食', '旅游', '旅行', '吃', '餐厅', '咖啡', '烘焙'] },
  { label: '数码电竞', words: ['数码', '电竞', '游戏', '手机', '电脑', '外设', '宅'] },
  { label: '文化艺术', words: ['文化', '艺术', '阅读', '书', '电影', '音乐', '展览', '学习'] },
  { label: '健康养生', words: ['健康', '养生', '保健', '医疗', '体检', '睡眠'] },
];

// 数据集里的兴趣标签与筛选选项的对应关系（用于真实匹配打分）
export const TAG_TO_OPTION = {
  运动户外: '运动户外', 健身: '运动户外', 跑步: '运动户外',
  美食旅游: '美食旅游', 咖啡: '美食旅游',
  数码电竞: '数码电竞', 游戏: '数码电竞',
  阅读: '文化艺术', 文化艺术: '文化艺术',
  健康养生: '健康养生',
};

const AGE_KEYWORDS = [
  { words: ['中老年', '老年', '退休'], range: [50, 200] },
  { words: ['中年', '成熟'], range: [35, 50] },
  { words: ['白领', '职场'], range: [25, 35] },
  { words: ['学生', '大学生'], range: [18, 25] },
  { words: ['年轻'], range: [18, 25] },
];

const SPEND_KEYWORDS = [
  { words: ['高消费', '高端', '消费能力强', '有钱'], range: [5000, 9999999] },
  { words: ['中等消费', '普通消费'], range: [1000, 3000] },
  { words: ['低消费', '价格敏感', '省'], range: [0, 1000] },
];

// ---------- 区间工具 ----------
const overlap = (a, b, c, d) => Math.max(0, Math.min(b, d) - Math.max(a, c));

function pickBucket(buckets, lo, hi, dir = null) {
  // 开区间"X 以上"：选"下界最贴近 X 且能覆盖 X"的桶（如 3000 以上 -> 3000-5000，而不是 5000 以上）
  if (dir === 'up') {
    const cands = buckets.filter((bk) => bk.hi > lo);
    const pool = cands.length ? cands : buckets;
    return pool.reduce((p, c) => (c.hi < p.hi ? c : p)).label;
  }
  // 开区间"X 以下"：选"上界不超过 X 且最贴近 X"的桶
  if (dir === 'down') {
    const cands = buckets.filter((bk) => bk.lo < hi);
    const pool = cands.length ? cands : buckets;
    return pool.reduce((p, c) => (c.lo > p.lo ? c : p)).label;
  }
  // 闭区间：取重叠最大者，重叠相同时用"中点是否落在桶内"决胜
  let best = null;
  let bestScore = -1;
  const mid = (lo + hi) / 2;
  for (const bk of buckets) {
    const score = overlap(lo, hi, bk.lo, bk.hi) * 1000 + (mid >= bk.lo && mid <= bk.hi ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = bk; }
  }
  return best ? best.label : null;
}

// 从自由文本里抽区间：支持 "25-30"、"25到30"、"3000以上"、"1000以下"
// 返回 { lo, hi, dir }，dir ∈ {'up' | 'down' | null} —— 开区间需要单独处理，
// 否则"3000 以上"会因为和"5000 以上"重叠更大而被错误归类。
function extractRanges(text) {
  const ranges = [];
  let m;
  const re = /(\d{1,6})\s*(?:-|~|—|到|至)\s*(\d{1,6})/g;
  while ((m = re.exec(text))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a !== b) ranges.push({ lo: Math.min(a, b), hi: Math.max(a, b), dir: null });
  }
  const reUp = /(\d{1,6})\s*(?:岁|元|块|人|个)?\s*(以上|往上|起)/g;
  while ((m = reUp.exec(text))) {
    ranges.push({ lo: Number(m[1]), hi: Infinity, dir: 'up' });
  }
  const reDown = /(\d{1,6})\s*(?:岁|元|块|人|个)?\s*(以下|以内|之内)/g;
  while ((m = reDown.exec(text))) {
    ranges.push({ lo: 0, hi: Number(m[1]), dir: 'down' });
  }
  return ranges;
}

// 把"月消费 3000-5000" / "25-30 岁" / "5000 以上" 这类标签解析成数值区间
export function parseRangeLabel(label) {
  const s = String(label || '');
  const nums = s.match(/\d+/g);
  if (!nums) return null;
  if (s.includes('以上')) return [Number(nums[0]), Infinity];
  if (s.includes('以下')) return [0, Number(nums[0])];
  return nums.length >= 2 ? [Number(nums[0]), Number(nums[1])] : null;
}

// 两个区间标签是否相交（用于筛选与匹配打分，避免被字符串格式差异误导）
export function rangesIntersect(labelA, labelB) {
  const a = parseRangeLabel(labelA);
  const b = parseRangeLabel(labelB);
  if (!a || !b) return false;
  return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 0;
}

// ============================================================
// ① 自然语言需求解析：把"一句话需求"转成结构化筛选条件
// ------------------------------------------------------------
// 返回 { age, interest, spend, keywords, confidence, hits, summary }
// confidence = 命中的维度数 / 3，用于向用户如实表明解析可信度。
// ============================================================
export function requestIntent(rawText) {
  const text = String(rawText || '').trim();
  const hits = [];
  if (!text) return { age: '不限', interest: '不限', spend: '不限', keywords: '', confidence: 0, hits, summary: '' };

  const ranges = extractRanges(text);

  // --- 年龄 ---
  let age = null;
  for (const r of ranges) {
    const ageLike = (r.dir === 'up' && r.lo >= 15 && r.lo <= 80)
      || (r.dir === 'down' && r.hi >= 15 && r.hi <= 80)
      || (r.dir === null && r.lo >= 15 && r.hi <= 60);
    if (!ageLike) continue;
    age = pickBucket(AGE_BUCKETS, r.lo, r.hi, r.dir);
    if (age) break;
  }
  if (!age) {
    // 取"最具体/优先级最高"的那个年龄关键词（数组顺序即优先级），
    // 避免"年轻白领"同时命中 18-25 与 25-35 后取并集，反而模糊了意图。
    const kw = AGE_KEYWORDS.find((k) => k.words.some((w) => text.includes(w)));
    if (kw) age = pickBucket(AGE_BUCKETS, kw.range[0], kw.range[1]);
  }
  if (age) hits.push({ dim: '年龄', value: age });

  // --- 兴趣 ---
  let interest = null;
  for (const a of INTEREST_ALIASES) {
    const hitWord = a.words.find((w) => text.includes(w));
    if (hitWord) { interest = a.label; hits.push({ dim: '兴趣', value: a.label, via: hitWord }); break; }
  }

  // --- 消费 ---
  let spend = null;
  for (const r of ranges) {
    const spendLike = (r.dir === 'up' && r.lo >= 300)
      || (r.dir === 'down' && r.hi >= 300)
      || (r.dir === null && r.hi >= 1000);
    if (!spendLike) continue;
    spend = pickBucket(SPEND_BUCKETS, r.lo, r.hi, r.dir);
    if (spend) break;
  }
  if (!spend) {
    const kw = SPEND_KEYWORDS.find((k) => k.words.some((w) => text.includes(w)));
    if (kw) spend = pickBucket(SPEND_BUCKETS, kw.range[0], kw.range[1]);
  }
  if (spend) hits.push({ dim: '消费', value: spend });

  // --- 关键词兜底（去掉已识别的数字区间，保留中文词） ---
  const keywords = text
    .replace(/(\d{1,6})\s*(?:-|~|—|到|至)\s*(\d{1,6})/g, ' ')
    .replace(/(\d{1,6})\s*(?:元|块)?\s*(以上|以下|以内|之内|往上|起)/g, ' ')
    .replace(/[，,。、；;：:（）()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !['我要找', '帮我找', '需要', '用户', '人群', '的人群', '以上', '以下'].includes(w))
    .slice(0, 4)
    .join(' ');

  const confidence = hits.length / 3;
  // ★ 只输入「购物」这类字段名关键词时，如实说明「没有结构化条件、改按字段名匹配」，
  //   而不是笼统报「未能识别出明确条件」——后者会让用户以为搜索失效。
  const summary = hits.length
    ? `已识别 ${hits.length}/3 个维度：` + hits.map((h) => `${h.dim}=${h.value}`).join(' · ')
    : keywords
      ? `未识别出结构化条件，按字段名关键词「${keywords}」匹配`
      : '未能识别出明确条件，请补充年龄区间、兴趣或消费水平';

  return { age: age || '不限', interest: interest || '不限', spend: spend || '不限', keywords, confidence, hits, summary };
}

// ============================================================
// ② 需求与字段数据集的真实匹配打分
// ------------------------------------------------------------
// 注意：这里不是"装作在匹配"——它真的读取该字段的链下数据集属性
// （年龄段 / 兴趣标签 / 月均消费区间），与需求逐项比对后再打分。
// ============================================================
export function scoreField(fieldId, fieldName, intent, dataRef) {
  // ★ 真实读取该字段的链下数据文件（由 loadAllData 预加载到内存，这里同步取用）
  const p = getDataPayload(dataRef) || {};
  const reasons = [];
  if (Object.keys(p).length === 0) {
    return {
      fieldId, fieldName, score: 0, hit: 0, total: 0, matched: false,
      reasons: ['· 链下数据文件不可用，无法比对'], sampleSize: 0,
    };
  }
  let total = 0;
  let hit = 0;

  if (intent.age && intent.age !== '不限') {
    total += 1;
    if (rangesIntersect(p.年龄段, intent.age)) { hit += 1; reasons.push(`✓ 年龄段「${p.年龄段}」命中需求`); }
    else reasons.push(`· 年龄段「${p.年龄段}」与需求「${intent.age}」不同`);
  }
  if (intent.interest && intent.interest !== '不限') {
    total += 1;
    const tags = Array.isArray(p.兴趣标签) ? p.兴趣标签 : [];
    const ok = tags.some((t) => (TAG_TO_OPTION[t] || t) === intent.interest);
    if (ok) { hit += 1; reasons.push(`✓ 兴趣标签「${tags.join('、')}」覆盖需求「${intent.interest}」`); }
    else reasons.push(`· 兴趣标签「${tags.join('、')}」未覆盖需求「${intent.interest}」`);
  }
  if (intent.spend && intent.spend !== '不限') {
    total += 1;
    if (rangesIntersect(p.月均消费区间, intent.spend)) { hit += 1; reasons.push(`✓ 消费区间「${p.月均消费区间}」命中需求`); }
    else reasons.push(`· 消费区间「${p.月均消费区间}」与需求「${intent.spend}」不同`);
  }

  // ★ 字段名关键词命中，两个作用：
  //   ① 兜底打分：需求里没写年龄/兴趣/消费时（如只输入「购物」），把关键词当作一个维度参与打分，
  //      否则「购物」会被判 0 分、推荐列表只能按样本量默认排序，出现「搜购物却推荐社交活跃」的错配；
  //   ② 排序加权：结构化查询里也保留 nameHit 作为排序优先级（见 recommendFields），
  //      让「运动健康」这类字段名精确命中的字段排在前面。
  const kws = String(intent.keywords || '').split(/\s+/).filter(Boolean);
  const name = String(fieldName || '');
  const hitKws = kws.filter((w) => name.includes(w) || w.includes(name));
  const hasStructured = Array.isArray(intent.hits) && intent.hits.length > 0;
  if (kws.length && !hasStructured) {
    // 仅「无结构化条件」时计入分母，避免稀释结构化匹配的百分比
    total += 1;
    if (hitKws.length) { hit += 1; reasons.push(`✓ 字段名命中需求关键词「${hitKws.join('、')}」`); }
    else reasons.push(`· 字段名未包含需求关键词「${kws.join('、')}」`);
  } else if (hitKws.length) {
    reasons.push(`✓ 字段名命中需求关键词「${hitKws.join('、')}」`);
  }

  const score = total === 0 ? 0 : hit / total;
  return {
    fieldId,
    fieldName,
    score,
    hit,
    total,
    nameHit: hitKws.length > 0,
    matched: total > 0 && hit === total,
    reasons: reasons.length ? reasons : ['· 未指定条件，按默认排序展示'],
    sampleSize: Number(p.记录条数) || 0,
  };
}

// 对字段列表整体排序推荐：
// 先按「字段名是否精确命中需求关键词」分层（搜「运动健康」时该字段必须排第一），
// 再按条件匹配度，最后按样本量。
export function recommendFields(fields, intent) {
  return fields
    .map((f) => ({ ...scoreField(f.id, f.name, intent, f.dataRef), owner: f.owner, callCount: f.callCount }))
    .sort((a, b) => (b.nameHit ? 1 : 0) - (a.nameHit ? 1 : 0) || b.score - a.score || (b.sampleSize - a.sampleSize));
}

// ============================================================
// ③ 监管端：把链上事件转成人类可读的审计摘要与关注点
// ------------------------------------------------------------
// 输入全部来自链上真实统计，AI 只负责"翻译成人话 + 提示关注点"，
// 不改变任何结论、不触发任何操作。
// ============================================================
export function auditSummary({ stats = {}, settlement = {}, blockedAttempts = [], escrows = [] } = {}) {
  const points = [];
  const risks = [];

  const authTotal = Number(stats.authTotal || 0);
  const fieldCount = Number(stats.fieldCount || 0);
  const distributeTotal = Number(stats.distributeTotal || 0);
  const pending = Number(settlement.pending || 0);
  const withdrawn = Number(settlement.withdrawn || 0);
  const refunded = Number(settlement.refunded || 0);
  const disputePending = Number(settlement.disputePending || 0);

  points.push(`链上已确权 ${fieldCount} 个数据字段，累计授权 ${authTotal} 次，分账总额 ${distributeTotal.toFixed(4)} ETH。`);
  points.push(`托管资金中 ${pending.toFixed(4)} ETH 尚在挑战期，已放款 ${withdrawn.toFixed(4)} ETH，已退款 ${refunded.toFixed(4)} ETH。`);

  // 拦截分析
  const reasons = blockedAttempts.map((b) => b.reason || '');
  const uniq = [...new Set(reasons)];
  if (blockedAttempts.length > 0) {
    points.push(`累计拦截 ${blockedAttempts.length} 次违规调用，原因类型 ${uniq.length} 种：${uniq.slice(0, 3).join('、')}。`);
    const byEnt = {};
    blockedAttempts.forEach((b) => { const k = (b.enterprise || '').toLowerCase(); byEnt[k] = (byEnt[k] || 0) + 1; });
    const top = Object.entries(byEnt).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= 2) risks.push(`企业 ${top[0].slice(0, 10)}… 触发 ${top[1]} 次拦截，建议核查其授权与押金状态。`);
    risks.push('拦截记录由合约自动落账、原因由合约判定，企业无法不上报或篡改理由。');
  } else {
    points.push('未发生违规调用拦截，全链授权行为合规。');
  }

  // 争议分析
  if (disputePending > 0) {
    risks.push(`当前有 ${disputePending} 笔托管处于争议待裁决状态，资金已锁定，请及时处理。`);
  } else {
    points.push('当前无待裁决争议，托管资金链路畅通。');
  }

  // 结算时效
  const settledCount = escrows.filter((e) => e.settled).length;
  if (escrows.length > 0) {
    points.push(`共 ${escrows.length} 笔托管结算单，已完成结算 ${settledCount} 笔，结算率 ${((settledCount / escrows.length) * 100).toFixed(0)}%。`);
  }

  // 风险等级
  let level = 'low';
  if (disputePending > 0 || blockedAttempts.length >= 5) level = 'medium';
  if (disputePending >= 3) level = 'high';

  const headline = level === 'high'
    ? `需要重点处理：${disputePending} 笔待裁决争议`
    : level === 'medium'
      ? '存在需要关注的事项，整体运行正常'
      : '全链运行正常，未发现异常';

  return { headline, level, points, risks, generatedAt: Date.now() };
}

// ============================================================
// ④ 用户端：授权前的合规风险提示（对应 PIPL 的"告知—同意"）
// ============================================================
export function authorizationTips({ fieldName, enterprise, mode = 'forever', days = 30, maxCalls = 10, known = false } = {}) {
  const tips = [];
  if (mode === 'forever') {
    tips.push('你选择的时效是「永久」：授权不会自动到期，需要你手动撤销才会失效。建议改为指定天数，最小化暴露面。');
  } else {
    tips.push(`授权将在 ${days} 天后自动失效，到期后企业无法再调用该字段。`);
  }
  if (maxCalls === 'unlimited') {
    tips.push('你选择的次数是「不限」：企业与你的每次调用都会单独扣款并进入托管，请定期查看「取用凭证」。');
  } else {
    tips.push(`授权上限 ${maxCalls} 次，达到上限后合约会自动拒绝该企业的后续调用。`);
  }
  if (!known) {
    tips.push(`该企业 ${String(enterprise || '').slice(0, 10)}… 在本机没有历史调用记录，属于首次交互，建议先小范围授权。`);
  } else {
    tips.push('该企业与你已有历史调用记录，可在「取用凭证」中查看其过往调用是否正常结算。');
  }
  tips.push(`你随时可以撤销授权；撤销后合约会立即拦截该企业的后续调用，并留下不可篡改的拦截记录。`);
  return tips;
}

// 统一的 AI 能力声明（界面上如实告知用户，避免过度声称）
export const AI_DISCLAIMER =
  'AI 仅用于理解需求、解释数据与提示风险；定价、扣款、拦截、放款与裁决均由智能合约的确定性规则执行，AI 不参与、也无法影响链上结果。';
