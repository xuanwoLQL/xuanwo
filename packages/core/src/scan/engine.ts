/**
 * 0day 自动挖掘引擎
 * 流程：发现源码文件 → 按知识库匹配风险 → 并发深度分析 → 汇总报告
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import type { AgentRuntime } from "../runtime.js";
import type { SuspiciousPoint } from "../agent/audit-context.js";

const SOURCE_EXTS = new Set([
  ".c", ".cpp", ".cc", ".h", ".hpp", ".java",
  ".js", ".ts", ".ets", ".tsx",
]);

export interface ScanFile {
  path: string;
  size: number;
}

export interface ScanOptions {
  maxFiles?: number;
  maxDepth?: number;
  concurrency?: number;
  onlyHighRisk?: boolean;
}

export interface ScanProgress {
  totalFiles: number;
  analyzed: number;
  currentFile?: string;
}

export interface ScanReport {
  scannedAt: string;
  target: string;
  filesScanned: number;
  filesAnalyzed: number;
  suspiciousPoints: SuspiciousPoint[];
  byModule: Record<string, number>;
  summary: string;
}

/** 收集源码文件（跳过 .git/.hvigor/node_modules 等） */
export function collectSourceFiles(root: string, maxDepth = 8, maxFiles = 500): ScanFile[] {
  const out: ScanFile[] = [];
  const skip = new Set([".git", ".hvigor", "node_modules", "oh_modules", "out", ".preview", ".cppbuild", "build"]);
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e)) continue;
      const p = join(dir, e);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(p, depth + 1);
      } else if (st.isFile() && SOURCE_EXTS.has(extname(e).toLowerCase())) {
        out.push({ path: p, size: st.size });
      }
      if (out.length >= maxFiles) return;
    }
  };
  walk(root, 0);
  return out;
}

/** 快速特征扫描：无需 LLM，先识别高风险信号文件 */
export function quickRiskScan(files: ScanFile[]): Map<string, string[]> {
  const riskyKeywords = [
    /napi_get_value_string/i,
    /memcpy|strcpy|strncpy|sprintf|snprintf/i,
    /napi_get_cb_info/i,
    /napi_create_reference|napi_ref/i,
    /napi_create_async_work/i,
    /CheckPermission|CheckCallingPermission/i,
    /Parcel.*Read/,
    /parcel/i,
  ];
  const hits = new Map<string, string[]>();
  for (const f of files.slice(0, 300)) {
    try {
      const content = readFileSync(f.path, "utf8");
      const found = riskyKeywords.filter((re) => re.test(content)).map((re) => re.source);
      if (found.length > 0) {
        hits.set(f.path, found);
      }
    } catch {
      /* 二进制等不可读 */
    }
  }
  return hits;
}

/** 并发执行异步任务 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * 执行扫描：对目标目录中的源码文件进行 0day 挖掘
 */
export async function runScan(
  runtime: AgentRuntime,
  target: string,
  options: ScanOptions = {},
  onProgress?: (p: ScanProgress) => void
): Promise<ScanReport> {
  const maxFiles = options.maxFiles ?? 30;
  const concurrency = options.concurrency ?? 3;
  const depth = options.maxDepth ?? 6;

  // 阶段1：收集源码文件
  const files = collectSourceFiles(target, depth, maxFiles);
  onProgress?.({ totalFiles: files.length, analyzed: 0 });

  // 阶段2：快速特征扫描（优先分析高风险文件）
  const riskMap = quickRiskScan(files);
  const prioritized = [...files].sort((a, b) => {
    const ra = riskMap.get(a.path)?.length ?? 0;
    const rb = riskMap.get(b.path)?.length ?? 0;
    return rb - ra;
  });

  // 阶段3：对选中的文件做深度分析
  const analyzeTargets = prioritized.slice(0, options.maxFiles ?? 10);
  const points: SuspiciousPoint[] = [];
  const byModule: Record<string, number> = {};
  let analyzed = 0;

  await mapLimit(analyzeTargets, concurrency, async (f) => {
    onProgress?.({ totalFiles: analyzeTargets.length, analyzed, currentFile: f.path });
    const signals = riskMap.get(f.path);
    try {
      const task = signals?.length
        ? `对文件 ${f.path} 进行 0day 漏洞挖掘。该文件含高风险特征: ${signals.join(", ")}。请结合知识库模式分析所有可疑点，输出 suspiciousPoints 并给出 file:line。`
        : `对文件 ${f.path} 进行快速安全检查，输出发现的 suspiciousPoints 或空数组。`;
      const { context } = await runtime.runTask(task, {
        targetFile: f.path,
        targetModule: moduleOf(f.path),
      }, undefined, { maxIterations: 12 });
      const newPoints = context.suspiciousPoints.filter(
        (p) => !points.some((x) => x.location === p.location && x.type === p.type)
      );
      points.push(...newPoints);
      for (const p of newPoints) {
        const m = moduleOf(f.path) || "unknown";
        byModule[m] = (byModule[m] ?? 0) + 1;
      }
    } catch (e) {
      // 单个文件失败不中断整体扫描
    }
    analyzed++;
    onProgress?.({ totalFiles: analyzeTargets.length, analyzed, currentFile: f.path });
  });

  const report: ScanReport = {
    scannedAt: new Date().toISOString(),
    target,
    filesScanned: files.length,
    filesAnalyzed: analyzed,
    suspiciousPoints: points,
    byModule,
    summary: `扫描 ${target}：发现 ${files.length} 个源码文件，深度分析 ${analyzed} 个，确认 ${points.length} 个可疑点`,
  };
  return report;
}

/** 从路径提取模块名 */
export function moduleOf(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const idx = parts.findIndex((p) => p === "foundation" || p === "drivers" || p === "arkcompiler");
  if (idx >= 0 && idx + 1 < parts.length) {
    return `${parts[idx]}/${parts[idx + 1]}`;
  }
  return parts.slice(-2).join("/");
}

/** 生成 Markdown 审计报告 */
export function renderReport(report: ScanReport): string {
  const lines: string[] = [];
  lines.push(`# xuanwo 审计报告`);
  lines.push(``);
  lines.push(`- 扫描时间: ${report.scannedAt}`);
  lines.push(`- 目标: ${report.target}`);
  lines.push(`- 源码文件: ${report.filesScanned}`);
  lines.push(`- 深度分析: ${report.filesAnalyzed}`);
  lines.push(`- 可疑点: ${report.suspiciousPoints.length}`);
  lines.push(``);
  lines.push(`## 可疑点汇总`);
  lines.push(``);
  if (report.suspiciousPoints.length === 0) {
    lines.push(`未发现可疑点。`);
  } else {
    report.suspiciousPoints.forEach((p, i) => {
      lines.push(`### ${i + 1}. [${p.type}] ${p.location}`);
      lines.push(`- 类型: ${p.type}`);
      lines.push(`- 置信度: ${p.confidence}`);
      lines.push(`- 描述: ${p.description}`);
      lines.push(``);
    });
  }
  lines.push(`## 模块分布`);
  lines.push(``);
  Object.entries(report.byModule)
    .sort((a, b) => b[1] - a[1])
    .forEach(([m, c]) => lines.push(`- ${m}: ${c}`));
  lines.push(``);
  lines.push(`> 本报告由 xuanwo 自动生成，所有结论需人工复核。`);
  return lines.join("\n");
}
