/**
 * 知识库重建：规范化 modulePath + 重新生成稳定 id + 去重 + 排序
 * 用法: node scripts/rebuild-knowledge.js
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeModulePath } from "./normalize-knowledge.js";

const KB = join(process.cwd(), "packages", "resources", "knowledge", "nday-patterns.json");

function stableId(p) {
  const src = `${p.modulePath}|${p.vulnerabilityType}|${(p.functionChain || []).slice(0, 2).join(">")}`;
  let h = 0;
  for (const c of src) {
    h = (h * 31 + c.charCodeAt(0)) | 0;
  }
  return `ohos-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

const kb = JSON.parse(readFileSync(KB, "utf8"));
const map = new Map();

for (const p of kb.patterns) {
  const np = { ...p, modulePath: normalizeModulePath(p.modulePath) };
  np.id = stableId(np);
  const old = map.get(np.id);
  if (!old || (np.confidence ?? 0) > (old.confidence ?? 0)) {
    map.set(np.id, np);
  }
}

kb.patterns = [...map.values()].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
kb.patternCount = kb.patterns.length;
kb.needsReview = kb.patterns.filter((p) => p.needsReview).length;
writeFileSync(KB, JSON.stringify(kb, null, 2), "utf8");

console.log(`知识库重建完成: ${kb.patterns.length} 条（去重后）`);
