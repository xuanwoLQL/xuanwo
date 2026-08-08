/**
 * 上下文标准化协议（AuditContext）
 * 阶段三设计智能体框架时固定的跨智能体数据传递标准。
 * 所有智能体（主控 + 子智能体）都通过该结构交换审计状态。
 */
export interface SuspiciousPoint {
  location: string; // 文件:行号
  type: string; // 可疑类型（如 "UAF"、"缓冲区溢出"）
  description: string;
  confidence: number; // 置信度 0-1
}

export interface KnowledgeMatch {
  patternId: string;
  similarity: number; // 0-1
}

export interface CodeSnippet {
  path: string;
  content: string;
}

export interface AuditContext {
  targetModule: string; // 当前审计的目标模块
  targetFile: string; // 当前审计的目标文件
  suspiciousPoints: SuspiciousPoint[];
  analysisStack: string[]; // 分析链记录（决策路径）
  knowledgeMatches: KnowledgeMatch[];
  codeSnippets: CodeSnippet[];
}

export function createEmptyContext(targetModule = "", targetFile = ""): AuditContext {
  return {
    targetModule,
    targetFile,
    suspiciousPoints: [],
    analysisStack: [],
    knowledgeMatches: [],
    codeSnippets: [],
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
