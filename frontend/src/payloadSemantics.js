// ============================================================
// payloadSemantics.js —— 链下数据「值语义」判定的唯一来源
// ------------------------------------------------------------
// 链下数据文件（public/data/*.json）里的字段值形态差异很大：
//   百分比 / 双值比值 / 时段 / 多值枚举 / 计数 / 区间 / 纯文本
// 「图表视图」（DataPayloadView）用这套判定规则挑选图形；数据文件里内置的
// 「图表」节（文本图表，供在线查看）也按同一套语义生成，两边形态一致。
//
// ⚠️ 判定顺序是这套规则的核心，**不可调换**：
//      时段 → 斜杠比值 → a:b 比值 → 单百分比 → 区间 → 文本
//    最典型的坑：`22:00 - 02:00` 会被 `\d+:\d+` 当成「22 比 0」，
//    所以时段必须排在 a:b 比值**之前**判定。
//
// ⚠️ 带 g 标志的正则会持有 lastIndex，跨组件共用会互相污染
//    （A 组件 test 一次，B 组件 match 就从中间开始）。
//    所以：本模块导出的**判定用**正则一律不带 g；需要遍历时在函数内部
//    现造一个带 g 的字面量（parsePcts / parseTimeRanges 就是这么做的）。
// ============================================================

// ---------- 判定用正则（不带 g，可安全共享） ----------
export const PCT_ONE_RE = /(\d+(?:\.\d+)?)\s*%/;
// 斜杠比值：两侧百分比之间可能夹着标签文字（「Android 占 58% / iOS 占 42%」），
// 所以用 \D*? 允许中间出现非数字字符，而不是只允许空白。
export const RATIO_RE = /(\d+(?:\.\d+)?)\s*%(?:\D*?)\/(?:\D*?)(\d+(?:\.\d+)?)\s*%/;
export const RATIO_ALT_RE = /(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/;
export const RANGE_RE = /^(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)\s*%?$/;
// 时段：独立的判定正则，只要求「以 hh:mm - hh:mm 开头」
export const IS_TIME_RE = /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/;

// ---------- 类型工具 ----------
export const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
export const fmtVal = (v) => (Array.isArray(v) ? v.join('、') : String(v));

/// JSON 节点类型（供结构图打类型徽标用）
export const typeOf = (v) => (
  v === null ? 'null'
    : Array.isArray(v) ? 'array'
      : typeof v === 'object' ? 'object'
        : typeof v
);

// ---------- 解析函数 ----------
/// 抽出字符串里所有百分比数值
export const parsePcts = (s) => [...String(s).matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
  .map((m) => parseFloat(m[1]));

/// 把「活跃时段」这类字符串解析成若干 24 小时区间
export function parseTimeRanges(str) {
  const out = [];
  for (const m of String(str).matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)) {
    const sh = +m[1] + +m[2] / 60;
    let eh = +m[3] + +m[4] / 60;
    if (eh <= sh) eh += 24;            // 跨零点（如 22:00 - 02:00）
    out.push([sh, eh]);
  }
  return out;
}

/// 单值百分比：整串就是一个百分比（可带「约」前缀）时返回数值，否则 null
export function asSoloPct(s) {
  const v = String(s).trim();
  const bare = v.replace(/^约\s*/, '');
  if (!/^\d+(?:\.\d+)?\s*%$/.test(bare)) return null;
  // ⚠️ 必须 parse 剥掉「约」之后的字符串：直接 parseFloat('约 62%') 会得到 NaN，
  //    界面上就会出现「NaN%」和一条宽度 NaN 的空进度条。
  const n = parseFloat(bare);
  return Number.isFinite(n) ? n : null;
}

/// 百分比之外的那段描述文字（作为进度条下方的补充说明）
///   「稳健型为主（约 54%）」→ 稳健型为主
///   「每年 1 次占 68%」    → 每年 1 次
export function pctPrefix(str) {
  const bracket = String(str).search(/[\[（(【]/);
  return (bracket >= 0
    ? String(str).slice(0, bracket)
    : String(str).replace(/[占为]?\s*约?\s*\d+(?:\.\d+)?\s*%\s*$/, '')
  ).trim();
}

// ------------------------------------------------------------
// 比值两侧的标签抽取
// ------------------------------------------------------------
// 「Android 占 58% / iOS 占 42%」  → 两侧各有名字：Android / iOS
// 「男女比例接近（51% / 49%）」    → 按斜杠切出来是「…（」和「）」这种碎片，
//                                   抽不出名字时**退回用数值当标签**，
//                                   并把括号前那段话留作补充说明（note）。
// ⚠️ 不要用字符类 [占约为占比] —— 那会连「比」「例」两个字一起删掉，
//    把「男女比例接近」削成「男女接近」。连接词要用整词的备选式。
const cleanLabel = (half) => String(half || '')
  .replace(/(\d+(?:\.\d+)?)\s*%/g, ' ')          // 去掉百分比
  .replace(/(?:占比|占|约|为)/g, ' ')             // 去掉连接词（整词）
  .replace(/[：:，,。、（）()【】\[\]／/]/g, ' ')   // 去掉标点与括号
  .replace(/\s+/g, ' ')
  .trim();

/// 去掉标签两端残留的裸数字（「男女比例接近 1」→「男女比例接近」）
const stripEdgeDigits = (s) => String(s || '')
  .replace(/^\d+(?:\.\d+)?\s*/, '')
  .replace(/\s*\d+(?:\.\d+)?$/, '')
  .trim();

/// 括号（或方括号）之前的那段描述文字
const noteOf = (str) => {
  const i = String(str).search(/[（(【[]/);
  return i >= 0 ? cleanLabel(String(str).slice(0, i)) : '';
};

/// 把「a 侧 / b 侧」两侧的标签抽出来；抽不出有效名字就退回数值标签
function pairLabels(str, a, b, sep, suffix) {
  const [rawA, rawB] = String(str).split(sep);
  const la = stripEdgeDigits(cleanLabel(rawA));
  const lb = stripEdgeDigits(cleanLabel(rawB));
  const named = Boolean(la) && Boolean(lb) && la !== lb;
  return {
    labels: named ? [la, lb] : [`${a}${suffix}`, `${b}${suffix}`],
    // 退回数值标签时，标签里已经含了数值，渲染方不要再重复印一遍
    numeric: !named,
    note: named ? '' : (noteOf(str) || la || lb || ''),
  };
}

// ------------------------------------------------------------
// 值语义判定：返回一个描述符，渲染方只管照着画
// kind ∈ array | number | time | ratio | ratioAlt | pct | range | text
// ------------------------------------------------------------
export function classifyValue(value) {
  // ① 数组 → 多值枚举
  if (Array.isArray(value)) return { kind: 'array', items: value.map(fmtVal) };
  // ② 纯数字 → 计数
  if (typeof value === 'number') return { kind: 'number', value };

  const str = String(fmtVal(value));

  // ③ 时段（必须先于「:」比值，否则 22:00-02:00 会被当成 22:0 比值）
  if (IS_TIME_RE.test(str)) {
    const ranges = parseTimeRanges(str);
    if (ranges.length) return { kind: 'time', str, ranges };
  }

  // ④ 双值比值：58% / 42%（中间可夹标签）  或  32 : 68
  const rm = str.match(RATIO_RE);
  if (rm) {
    const a = parseFloat(rm[1]);
    const b = parseFloat(rm[2]);
    const { labels, numeric, note } = pairLabels(str, a, b, '/', '%');
    return {
      kind: 'ratio',
      str,
      unit: '%',
      note,
      parts: [
        { label: labels[0], value: a, numeric },
        { label: labels[1], value: b, numeric },
      ],
    };
  }
  const alt = str.match(RATIO_ALT_RE);
  if (alt && !PCT_ONE_RE.test(str)) {
    const a = parseFloat(alt[1]);
    const b = parseFloat(alt[2]);
    // ⚠️ a:b 比值的单位不是 %，别把 32 : 68 印成「32%」
    const { labels, numeric, note } = pairLabels(str, a, b, ':', '');
    return {
      kind: 'ratioAlt',
      str,
      unit: '',
      note,
      parts: [
        { label: labels[0], value: a, numeric },
        { label: labels[1], value: b, numeric },
      ],
    };
  }

  // ⑤ 单百分比（含「约」前缀）
  const pcts = parsePcts(str);
  if (pcts.length === 1) {
    const solo = asSoloPct(str);
    return {
      kind: 'pct',
      str,
      value: solo !== null ? solo : pcts[0],
      solo: solo !== null,
      prefix: solo !== null ? '' : pctPrefix(str),
    };
  }

  // ⑥ 区间（如 3000-5000）
  if (RANGE_RE.test(str)) return { kind: 'range', str };

  // ⑦ 其余文本
  return { kind: 'text', str };
}
