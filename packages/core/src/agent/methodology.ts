/**
 * 方法论工具集（借鉴 CyberStrike Methodology Engine）
 * 为审计智能体提供：
 * - add_intel: 情报记录（数据流线索、入口点、攻击面）
 * - coverage_status: 覆盖追踪（已审计文件/函数，避免重复）
 * - record_coverage: 记录审计结果
 */
import type { AuditContext, IntelEntry, CoverageEntry, SuspiciousPoint } from "../agent/audit-context.js";
import type { AgentTool } from "../agent/react.js";

/** 从 AuditContext 生成覆盖状态摘要 */
export function coverageSummary(ctx: AuditContext): string {
  if (ctx.coverage.length === 0) {
    return "覆盖: 尚未审计任何文件（建议先 grep 搜索目标模块入口点）";
  }
  const lines = ctx.coverage.map((c) => {
    const funcs = c.functions.length ? ` [${c.functions.join(", ")}]` : "";
    return `  ${c.file}${funcs} — ${c.result}`;
  });
  const intelCount = ctx.intel.length;
  return `覆盖追踪（${ctx.coverage.length} 文件审计, ${intelCount} 条情报）:\n${lines.join("\n")}`;
}

/** 从 AuditContext 生成情报摘要 */
export function intelSummary(ctx: AuditContext): string {
  if (ctx.intel.length === 0) {
    return "情报: 暂无记录。发现入口点/数据流/敏感配置时请使用 add_intel。";
  }
  return ctx.intel
    .map((i) => `  [${i.kind}/${i.severity}/${i.confidence}] ${i.target}: ${i.detail}`)
    .join("\n");
}

/**
 * 创建方法论工具（依赖外部返回最新 context 的 getter）
 * @param getContext 获取当前 AuditContext
 * @param setContext 更新 AuditContext（触发 UI 刷新）
 */
export function createMethodologyTools(
  getContext: () => AuditContext,
  setContext: (ctx: AuditContext) => void
): AgentTool[] {
  return [
    {
      definition: {
        name: "add_intel",
        description:
          "记录审计情报。发现入口点、可疑数据流、敏感配置、凭据线索时立即调用。参数: {kind: endpoint|entry|dataflow|credential|config|hint, target: string, detail: string, severity?: critical|high|medium|low|informational, confidence?: confirmed|high|medium|low}",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["endpoint", "entry", "dataflow", "credential", "config", "hint"] },
            target: { type: "string" },
            detail: { type: "string" },
            severity: { type: "string" },
            confidence: { type: "string" },
          },
          required: ["kind", "target", "detail"],
        },
      },
      execute: async (args) => {
        const entry: IntelEntry = {
          kind: (args.kind as IntelEntry["kind"]) ?? "hint",
          target: String(args.target ?? ""),
          detail: String(args.detail ?? ""),
          severity: (args.severity as IntelEntry["severity"]) ?? "informational",
          confidence: (args.confidence as IntelEntry["confidence"]) ?? "medium",
        };
        const ctx = getContext();
        setContext({ ...ctx, intel: [...ctx.intel, entry] });
        return `✅ 已记录情报 [${entry.kind}/${entry.severity}]: ${entry.target}`;
      },
    },
    {
      definition: {
        name: "coverage_status",
        description:
          "查看当前审计覆盖进度（已审计文件、可疑点、情报数）。在开始新目标或审计完成后调用。参数: {}",
        parameters: { type: "object", properties: {} },
      },
      execute: async () => {
        const ctx = getContext();
        return coverageSummary(ctx);
      },
    },
    {
      definition: {
        name: "record_coverage",
        description:
          "记录一个文件的审计结果。参数: {file: string, functions?: string[], result: clean|suspicious|verified|excluded}",
        parameters: {
          type: "object",
          properties: {
            file: { type: "string" },
            functions: { type: "array", items: { type: "string" } },
            result: { type: "string", enum: ["clean", "suspicious", "verified", "excluded"] },
          },
          required: ["file", "result"],
        },
      },
      execute: async (args) => {
        const entry: CoverageEntry = {
          file: String(args.file ?? ""),
          functions: Array.isArray(args.functions) ? (args.functions as string[]) : [],
          checkedAt: new Date().toISOString(),
          result: (args.result as CoverageEntry["result"]) ?? "clean",
        };
        const ctx = getContext();
        const others = ctx.coverage.filter((c) => c.file !== entry.file);
        setContext({ ...ctx, coverage: [...others, entry] });
        return `✅ 已记录 ${entry.file} 审计结果: ${entry.result}`;
      },
    },
  ];
}

/** 检查可疑点是否满足证据要求（缺证据的标记为需验证） */
export function requireEvidence(points: SuspiciousPoint[]): SuspiciousPoint[] {
  return points.map((p) => {
    const hasCode = Boolean(p.evidence?.codeSnippet);
    const hasChain = p.evidence?.callChain && p.evidence.callChain.length > 0;
    const hasTrigger = Boolean(p.evidence?.triggerCondition);
    if (!hasCode || !hasChain || !hasTrigger) {
      return { ...p, evidence: { ...p.evidence, needsVerification: true } };
    }
    return p;
  });
}

/**
 * 漏洞链检测（借鉴 CyberStrike Chain Awareness）
 * 当多个可疑点位于同一数据流/调用链上时，标记为潜在漏洞链并升级严重度。
 */
export interface ChainCandidate {
  chain: string[]; // 参与链的可疑点 location
  description: string;
  baseSeverity: string;
  boostedSeverity: string;
  patterns: string[]; // 命中的知识模式 id
}

export function detectChains(
  points: SuspiciousPoint[],
  matches: { patternId: string; similarity: number }[] = []
): ChainCandidate[] {
  const chains: ChainCandidate[] = [];

  // 1. 相同调用链的可疑点 → 数据流链
  const byChain = new Map<string, SuspiciousPoint[]>();
  for (const p of points) {
    const chainKey = (p.evidence?.callChain ?? []).join(">");
    if (!chainKey) continue;
    const arr = byChain.get(chainKey) ?? [];
    arr.push(p);
    byChain.set(chainKey, arr);
  }
  for (const [key, arr] of byChain) {
    if (arr.length >= 2) {
      const sevs = arr.map((p) => p.evidence?.severity ?? "medium");
      const hasHigh = sevs.some((s) => s === "critical" || s === "high");
      chains.push({
        chain: arr.map((p) => p.location),
        description: `同一数据流链（${key}）上 ${arr.length} 个可疑点，存在组合利用可能`,
        baseSeverity: sevs.join(","),
        boostedSeverity: hasHigh ? "CRITICAL" : "HIGH",
        patterns: [],
      });
    }
  }

  // 2. 知识模式间的 chainsWith 联动
  if (matches.length >= 2) {
    const matchedIds = matches.map((m) => m.patternId);
    // 若命中模式的 tags 有重叠（如同一模块），提示链
    chains.push({
      chain: matchedIds,
      description: `命中 ${matchedIds.length} 条知识模式（${matchedIds.join(", ")}），建议检查是否构成组合利用`,
      baseSeverity: "medium",
      boostedSeverity: "HIGH",
      patterns: matchedIds,
    });
  }

  return chains;
}
