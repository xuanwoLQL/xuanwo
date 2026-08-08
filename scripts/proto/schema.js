export const VULN_TYPES = new Set(["UAF", "缓冲区溢出", "权限绕过", "条件竞争", "整数溢出", "其他"]);
export const SEVERITIES = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

export function validatePatterns(data) {
  const errors = [];
  if (!Array.isArray(data)) return { ok: false, errors: ["顶层必须是数组"] };
  data.forEach((item, i) => {
    if (typeof item !== "object" || item === null) {
      errors.push(`[${i}] 必须是对象`);
      return;
    }
    if (typeof item.id !== "string") errors.push(`[${i}] id 缺失`);
    if (typeof item.modulePath !== "string") errors.push(`[${i}] modulePath 缺失`);
    if (typeof item.confidence !== "number" || item.confidence < 0 || item.confidence > 1)
      errors.push(`[${i}] confidence 必须是 0-1 数字`);
    if (!VULN_TYPES.has(item.vulnerabilityType)) errors.push(`[${i}] vulnerabilityType 非法: ${item.vulnerabilityType}`);
    if (item.severity !== undefined && !SEVERITIES.has(item.severity)) errors.push(`[${i}] severity 非法`);
  });
  return { ok: errors.length === 0, errors };
}

const CWE_TO_TYPE = {
  "78": "其他",
  "79": "其他",
  "89": "其他",
  "120": "缓冲区溢出",
  "121": "缓冲区溢出",
  "122": "缓冲区溢出",
  "125": "缓冲区溢出",
  "190": "整数溢出",
  "191": "整数溢出",
  "287": "权限绕过",
  "295": "权限绕过",
  "362": "条件竞争",
  "416": "UAF",
  "476": "UAF",
  "787": "缓冲区溢出",
  "788": "缓冲区溢出",
  "1068": "权限绕过",
};

/**
 * 将模型输出的 vulnerabilityType 归一化为 schema 枚举。
 * 兼容 "CWE-787: Out-of-bounds Write"、"CWE-78"、"缓冲区溢出" 等写法。
 */
export function normalizeType(raw) {
  if (VULN_TYPES.has(raw)) return raw;
  const m = String(raw).match(/CWE-?(\d+)/i);
  if (m && CWE_TO_TYPE[m[1]]) return CWE_TO_TYPE[m[1]];
  const s = String(raw);
  if (/use[- ]?after[- ]?free/i.test(s)) return "UAF";
  if (/buffer|overflow|越界|溢出|out[- ]?of[- ]?bounds/i.test(s)) return "缓冲区溢出";
  if (/permission|bypass|越权|权限/i.test(s)) return "权限绕过";
  if (/race|竞争|TOCTOU/i.test(s)) return "条件竞争";
  if (/integer|整数/i.test(s)) return "整数溢出";
  return "其他";
}

/** 清洗模型输出：归一化类型/严重度，填充缺失字段 */
export function normalizePatterns(data) {
  return (Array.isArray(data) ? data : []).map((p, i) => ({
    ...p,
    id: p.id || `p${i + 1}`,
    vulnerabilityType: normalizeType(p.vulnerabilityType),
    severity: SEVERITIES.has(p.severity) ? p.severity : guessSeverity(p.vulnerabilityType, p.confidence),
    functionChain: Array.isArray(p.functionChain) ? p.functionChain : [],
    tags: Array.isArray(p.tags) ? p.tags : [],
    needsReview: p.needsReview === true || (typeof p.confidence === "number" && p.confidence < 0.7),
  }));
}

function guessSeverity(rawType, confidence) {
  const t = normalizeType(rawType);
  const c = typeof confidence === "number" ? confidence : 0.5;
  if (t === "UAF" || t === "缓冲区溢出") return c >= 0.8 ? "CRITICAL" : "HIGH";
  if (t === "权限绕过" || t === "条件竞争") return "HIGH";
  return "MEDIUM";
}
