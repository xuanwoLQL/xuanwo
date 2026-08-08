import { KnowledgeBase, resolveResourcePaths } from "@xuanwo/core";

export function getKnowledgeDir(): string {
  return process.env.XUANWO_KNOWLEDGE_DIR ?? resolveResourcePaths().knowledgeDir;
}

export async function runKnowledgeCommand(opts: { list?: boolean; search?: string; stats?: boolean; module?: string }) {
  const kb = new KnowledgeBase(getKnowledgeDir());
  kb.load();
  console.log(`知识库: ${getKnowledgeDir()}\n模式总数: ${kb.size}`);

  if (opts.stats) {
    const P = kb.all();
    const types: Record<string, number> = {};
    const mods: Record<string, number> = {};
    P.forEach((p) => {
      types[p.vulnerabilityType] = (types[p.vulnerabilityType] ?? 0) + 1;
      const top = (p.modulePath ?? "").split("/").slice(0, 2).join("/");
      mods[top] = (mods[top] ?? 0) + 1;
    });
    console.log("\n=== 类型分布 ===");
    Object.entries(types).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    console.log("\n=== 模块分布 (Top 10) ===");
    Object.entries(mods).sort((a, b) => b[1] - a[1]).slice(0, 10).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    console.log(`\n平均置信度: ${(P.reduce((a, p) => a + (p.confidence ?? 0), 0) / (P.length || 1)).toFixed(2)}`);
    console.log(`需复核: ${P.filter((p) => p.needsReview).length}`);
    return;
  }

  if (opts.search) {
    const retriever = kb.retriever();
    const results = retriever.search(opts.search, opts.module);
    console.log(`\n检索 "${opts.search}"${opts.module ? ` in ${opts.module}` : ""}: ${results.length} 条命中`);
    results.slice(0, 10).forEach((r, i) => {
      const p = r.pattern;
      console.log(`  ${i + 1}. [${p.vulnerabilityType}] ${p.modulePath} (score=${r.score.toFixed(3)})`);
      console.log(`     ${p.fixDescription || ""}`);
      console.log(`     conf=${p.confidence}${p.needsReview ? " ⚠️" : ""} ${r.reason}`);
    });
    return;
  }

  if (opts.list) {
    kb.all().slice(0, 30).forEach((p, i) => {
      console.log(`  ${i + 1}. [${p.id}] ${p.vulnerabilityType} ${p.modulePath} conf=${p.confidence}${p.needsReview ? " ⚠️" : ""}`);
    });
    return;
  }
}
