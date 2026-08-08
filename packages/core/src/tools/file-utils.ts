/**
 * 文件工具：glob 查找（递归）
 */
import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
export function findFiles(root: string, pattern: string, maxResults = 200): string[] {
  const out: string[] = [];
  const skip = new Set([".git", "node_modules", "dist", "build", "out", ".hvigor"]);

  // 拆分 pattern：如果含 **/ 前缀，匹配所有子目录
  const hasGlobstar = pattern.startsWith("**/");
  const suffix = hasGlobstar ? pattern.slice(3) : pattern;
  const extMatch = suffix.includes(".") ? extname(suffix) : null;
  const namePart = suffix.split("/").pop() ?? suffix;

  // 转换为正则
  const re = new RegExp(
    "^" +
      namePart
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$"
  );

  const walk = (dir: string, allowAll: boolean) => {
    if (out.length >= maxResults) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e)) continue;
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(p, allowAll || hasGlobstar);
      } else {
        // 匹配文件名或后缀
        const matched = allowAll || hasGlobstar ? re.test(e) : re.test(e);
        if (matched && (extMatch === null || extname(e) === extMatch)) {
          out.push(p.replace(/\\/g, "/"));
        }
      }
      if (out.length >= maxResults) return;
    }
  };

  walk(root, false);
  return out;
}
