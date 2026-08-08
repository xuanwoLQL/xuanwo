/**
 * 上下文标准化协议（AuditContext）
 * 阶段三设计智能体框架时固定的跨智能体数据传递标准。
 * 借鉴 CyberStrike Methodology Engine，扩展验证闭环所需字段：
 * - evidence: 每个可疑点的证据要求（代码片段/调用链/触发条件）
 * - intel: 情报记录（数据流线索、入口点、攻击面）
 * - coverage: 覆盖追踪（已审计文件/函数）
 */

export interface SuspiciousPoint {
  location: string; // 文件:行号
  type: string; // 可疑类型（如 "UAF"、"缓冲区溢出"）
  description: string;
  confidence: number; // 置信度 0-1
  /** 证据要求（借鉴 CyberStrike Evidence Requirements） */
  evidence?: {
    codeSnippet?: string; // 关键代码片段
    callChain?: string[]; // 调用链（入口 → 处理函数）
    triggerCondition?: string; // 触发条件（如何被外部输入到达）
    severity?: "critical" | "high" | "medium" | "low" | "informational";
    needsVerification?: boolean; // 是否需编译/运行验证
  };
}

export interface KnowledgeMatch {
  patternId: string;
  similarity: number; // 0-1
}

export interface CodeSnippet {
  path: string;
  content: string;
}

/** 情报记录（借鉴 CyberStrike add_intel） */
export interface IntelEntry {
  kind: "endpoint" | "entry" | "dataflow" | "credential" | "config" | "hint";
  target: string; // 位置/对象
  detail: string;
  severity: "critical" | "high" | "medium" | "low" | "informational";
  confidence: "confirmed" | "high" | "medium" | "low";
}

/** 覆盖追踪（借鉴 CyberStrike coverage tracking） */
export interface CoverageEntry {
  file: string;
  functions: string[];
  checkedAt: string;
  result: "clean" | "suspicious" | "verified" | "excluded";
}

export interface AuditContext {
  targetModule: string; // 当前审计的目标模块
  targetFile: string; // 当前审计的目标文件
  suspiciousPoints: SuspiciousPoint[];
  analysisStack: string[]; // 分析链记录（决策路径）
  knowledgeMatches: KnowledgeMatch[];
  codeSnippets: CodeSnippet[];
  /** 情报记录 */
  intel: IntelEntry[];
  /** 覆盖追踪 */
  coverage: CoverageEntry[];
}

export function createEmptyContext(targetModule = "", targetFile = ""): AuditContext {
  return {
    targetModule,
    targetFile,
    suspiciousPoints: [],
    analysisStack: [],
    knowledgeMatches: [],
    codeSnippets: [],
    intel: [],
    coverage: [],
  };
}

export function mergeContext(base: AuditContext, patch: Partial<AuditContext>): AuditContext {
  return {
    ...base,
    ...patch,
    suspiciousPoints: dedupePoints([...base.suspiciousPoints, ...(patch.suspiciousPoints ?? [])]),
    analysisStack: [...base.analysisStack, ...(patch.analysisStack ?? [])],
    knowledgeMatches: [...base.knowledgeMatches, ...(patch.knowledgeMatches ?? [])],
    codeSnippets: [...base.codeSnippets, ...(patch.codeSnippets ?? [])],
    intel: dedupeIntel([...base.intel, ...(patch.intel ?? [])]),
    coverage: [...base.coverage, ...(patch.coverage ?? [])],
  };
}

/** 可疑点去重：按 location+type 合并，保留置信度最高者 */
export function dedupePoints(points: SuspiciousPoint[]): SuspiciousPoint[] {
  const map = new Map<string, SuspiciousPoint>();
  for (const p of points) {
    const key = `${p.location}|${p.type}`;
    const existing = map.get(key);
    if (!existing || (p.confidence ?? 0) > (existing.confidence ?? 0)) {
      map.set(key, p);
    }
  }
  return [...map.values()];
}

/** 情报去重：按 kind+target 合并 */
export function dedupeIntel(intel: IntelEntry[]): IntelEntry[] {
  const map = new Map<string, IntelEntry>();
  for (const i of intel) {
    const key = `${i.kind}|${i.target}`;
    map.set(key, i);
  }
  return [...map.values()];
}

/** 汇总已覆盖的文件列表 */
export function coveredFiles(ctx: AuditContext): string[] {
  return [...new Set(ctx.coverage.map((c) => c.file))];
}

/** 计算覆盖进度 */
export function coverageStats(ctx: AuditContext): { total: number; suspicious: number; verified: number; clean: number } {
  const total = ctx.coverage.length;
  const suspicious = ctx.coverage.filter((c) => c.result === "suspicious").length;
  const verified = ctx.coverage.filter((c) => c.result === "verified").length;
  const clean = ctx.coverage.filter((c) => c.result === "clean").length;
  return { total, suspicious, verified, clean };
}
