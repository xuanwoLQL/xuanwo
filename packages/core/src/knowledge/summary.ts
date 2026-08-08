/**
 * 知识摘要生成器
 * 将知识库中的 Nday 模式压缩为智能体提示词可注入的文本摘要。
 */
import type { NdayPattern } from "../knowledge/knowledge.js";

export function buildKnowledgeSummary(
  patterns: NdayPattern[],
  targetModule?: string
): string {
  if (patterns.length === 0) return "（知识库为空，暂无 Nday 模式）";

  const relevant = targetModule
    ? patterns.filter((p) => {
        const pm = (p.modulePath ?? "").replace(/\/+$/, "");
        const tm = targetModule.replace(/\/+$/, "");
        return pm === tm || pm.startsWith(tm) || tm.startsWith(pm);
      })
    : [];

  const list = (relevant.length ? relevant : patterns).slice(0, 20);

  const lines = list.map((p, i) => {
    const reviewed = p.needsReview ? " ⚠️需复核" : "";
    return `${i + 1}. [${p.vulnerabilityType}] ${p.modulePath} (${p.severity}${reviewed})
   - 函数链: ${p.functionChain?.join(" → ") || "N/A"}
   - 修复: ${p.fixDescription || "N/A"}
   - 置信度: ${p.confidence ?? "N/A"}`;
  });

  const count = patterns.length;
  const relNote = relevant.length
    ? `\n（已按目标模块过滤，命中 ${relevant.length}/${count} 条）`
    : `\n（知识库共 ${count} 条模式，无精确模块命中，列出通用样本）`;

  return `知识库 Nday 模式摘要（共 ${count} 条）：${relNote}\n${lines.join("\n")}`;
}
