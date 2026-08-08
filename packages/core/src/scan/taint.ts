/**
 * 污点分析引擎（借鉴 IVAgent 的 taint_sources + dangerous_apis 机制）
 * 纯静态扫描：在目标代码中查找"污点源"和"危险API"的共现，
 * 输出候选污点路径，供 LLM 深度确认。
 *
 * 核心思路：
 * 1. 技能 SKILL.md 声明 taint_sources（污点源）与 dangerous_apis（危险汇点）
 * 2. 引擎在源码中定位污点源数据流向危险API的位置
 * 3. 输出 {file, line, source, sink, distance} 候选，避免 LLM 盲目猜测
 */

export interface TaintRule {
  /** 污点源 API 模式（正则字符串，匹配函数调用） */
  sources: string[];
  /** 危险 API（汇点）模式 */
  sinks: string[];
  /** 入口点模式（可选，限定分析范围） */
  entryPoints?: string[];
  /** 漏洞类型标签 */
  vulnerabilityType: string;
}

export interface TaintCandidate {
  file: string;
  sourceLine: number;
  sourcePattern: string;
  sinkLine: number;
  sinkPattern: string;
  /** 源与汇在同一函数的近似距离（行差） */
  distance: number;
  vulnerabilityType: string;
  /** 同一作用域内源和汇共同出现 */
  sameScope: boolean;
}

const MAX_MATCHES = 200;

/** 行级源码切分 */
export interface SourceLine {
  num: number;
  text: string;
}

/**
 * 在源码内容中执行污点匹配
 * @param filePath 文件路径（用于输出）
 * @param lines 带行号的源码行
 * @param rule 污点规则
 */
export function taintScanLines(
  filePath: string,
  lines: SourceLine[],
  rule: TaintRule
): TaintCandidate[] {
  const sourceHits: SourceLine[] = [];
  const sinkHits: SourceLine[] = [];

  for (const line of lines) {
    for (const sp of rule.sources) {
      if (new RegExp(sp).test(line.text)) {
        sourceHits.push({ ...line, text: line.text.trim() });
        break;
      }
    }
    for (const dp of rule.sinks) {
      if (new RegExp(dp).test(line.text)) {
        sinkHits.push({ ...line, text: line.text.trim() });
        break;
      }
    }
  }

  if (sourceHits.length === 0 || sinkHits.length === 0) return [];

  const candidates: TaintCandidate[] = [];
  // 对每个 sink，找最近的 source（近似流距离）
  for (const sink of sinkHits) {
    let best: { s: SourceLine; dist: number } | null = null;
    for (const src of sourceHits) {
      const dist = Math.abs(sink.num - src.num);
      if (!best || dist < best.dist) {
        best = { s: src, dist };
      }
    }
    if (best && best.dist <= 40) {
      candidates.push({
        file: filePath,
        sourceLine: best.s.num,
        sourcePattern: best.s.text.slice(0, 80),
        sinkLine: sink.num,
        sinkPattern: sink.text.slice(0, 80),
        distance: best.dist,
        vulnerabilityType: rule.vulnerabilityType,
        sameScope: best.dist <= 15,
      });
    }
  }

  // 去重（sink 可能匹配多个源）
  const seen = new Set<string>();
  return candidates
    .filter((c) => {
      const key = `${c.sinkLine}:${c.sinkPattern}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_MATCHES);
}

/** 从文件内容构造带行号的行 */
export function toSourceLines(content: string): SourceLine[] {
  return content.split("\n").map((text, i) => ({ num: i + 1, text }));
}

/**
 * 聚合多个规则的污点扫描
 */
export function aggregateTaintScan(
  filePath: string,
  content: string,
  rules: TaintRule[]
): TaintCandidate[] {
  const lines = toSourceLines(content);
  const out: TaintCandidate[] = [];
  for (const rule of rules) {
    out.push(...taintScanLines(filePath, lines, rule));
  }
  return out;
}

/** 将污点候选格式化为文本摘要（供 LLM 确认） */
export function formatTaintCandidates(candidates: TaintCandidate[]): string {
  if (candidates.length === 0) return "未发现明显的污点源→危险API 路径。";
  const lines = candidates.slice(0, 10).map((c, i) => {
    return `${i + 1}. [${c.vulnerabilityType}] ${c.file}:${c.sourceLine} → :${c.sinkLine} (距离${c.distance}行, ${c.sameScope ? "同作用域" : "跨作用域"})
  源: ${c.sourcePattern}
  汇: ${c.sinkPattern}`;
  });
  return `发现 ${candidates.length} 个候选污点路径:\n${lines.join("\n")}`;
}
