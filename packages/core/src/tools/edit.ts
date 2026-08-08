/**
 * 多策略编辑（借鉴 opencode edit.ts 的 9 种替换策略）
 * AI 生成的 oldString/newString 往往与文件实际内容有细微差异
 * （行尾、缩进、空白），直接 indexOf 会失败。
 * 这组策略让编辑可靠应用。
 */

/** 规范化行尾 */
export function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n");
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function convertToLineEnding(text: string, ending: "\n" | "\r\n"): string {
  if (ending === "\n") return text;
  return text.replaceAll("\n", "\r\n");
}

interface Replacer {
  (content: string, oldString: string): string[];
}

/** 策略1：精确匹配 */
const SimpleReplacer: Replacer = (_c, old) => [old];

/** 策略2：按行 trim 匹配（每行去掉首尾空白） */
const LineTrimmedReplacer: Replacer = (content, old) => {
  const oldLines = old.split("\n").map((l) => l.trim());
  const candidates: string[] = [];
  const contentLines = content.split("\n");
  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    let ok = true;
    for (let j = 0; j < oldLines.length; j++) {
      if (contentLines[i + j].trim() !== oldLines[j]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      candidates.push(contentLines.slice(i, i + oldLines.length).join("\n"));
    }
  }
  return candidates;
};

/** 策略3：空白规范化（多个空白 → 单个，忽略行尾） */
const WhitespaceNormalizedReplacer: Replacer = (content, old) => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const oldNorm = norm(old);
  if (oldNorm.length < 8) return [];
  const candidates: string[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let acc = lines[i];
    for (let j = i + 1; j < lines.length; j++) {
      const normAcc = norm(acc);
      if (normAcc === oldNorm) {
        candidates.push(acc);
        break;
      }
      if (normAcc.length > oldNorm.length * 3) break;
      acc += "\n" + lines[j];
    }
  }
  return candidates;
};

/** 策略4：缩进灵活匹配（首尾行忽略缩进） */
const IndentationFlexibleReplacer: Replacer = (content, old) => {
  const oldLines = old.split("\n");
  if (oldLines.length < 2) return [];
  const candidates: string[] = [];
  const contentLines = content.split("\n");
  for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
    let ok = true;
    for (let j = 0; j < oldLines.length; j++) {
      const cl = contentLines[i + j].trim();
      const ol = oldLines[j].trim();
      // 首尾行可容忍缩进差异，中间行必须一致
      if (j === 0 || j === oldLines.length - 1) {
        if (cl !== ol && !cl.startsWith(ol) && !ol.startsWith(cl)) {
          ok = false;
          break;
        }
      } else {
        if (cl !== ol) {
          ok = false;
          break;
        }
      }
    }
    if (ok) candidates.push(contentLines.slice(i, i + oldLines.length).join("\n"));
  }
  return candidates;
};

/** 策略5：边界 trim（去掉首尾空行/空白） */
const TrimmedBoundaryReplacer: Replacer = (content, old) => {
  const trimmed = old.trim();
  if (trimmed === old) return [];
  return [trimmed];
};

/** 组合所有策略 */
const REPLACERS = [
  SimpleReplacer,
  LineTrimmedReplacer,
  WhitespaceNormalizedReplacer,
  IndentationFlexibleReplacer,
  TrimmedBoundaryReplacer,
];

/** 防比例失衡：匹配的 span 远大于 oldString 时拒绝（可能匹配错位置） */
function isDisproportionateMatch(search: string, oldString: string): boolean {
  return search.length > oldString.length * 4 + 40;
}

/**
 * 应用编辑（多策略）
 * @returns {newContent, applied} applied=false 表示所有策略都失败
 */
export function applyEdit(content: string, oldString: string, newString: string, replaceAll = false): { newContent: string; applied: boolean; error?: string } {
  if (oldString === newString) {
    return { newContent: content, applied: false, error: "oldString 与 newString 相同" };
  }
  if (oldString === "") {
    return { newContent: content, applied: false, error: "oldString 不能为空（已有文件编辑）" };
  }

  const old = normalizeLineEndings(oldString);
  const replacement = normalizeLineEndings(newString);
  const ending = detectLineEnding(content);
  // 统一到 \n 搜索，避免 \r\n 干扰 indexOf
  const searchContent = normalizeLineEndings(content);

  for (const replacer of REPLACERS) {
    for (const search of replacer(searchContent, old)) {
      const index = searchContent.indexOf(search);
      if (index === -1) continue;
      if (isDisproportionateMatch(search, old)) {
        return {
          newContent: content,
          applied: false,
          error: "拒绝替换：匹配范围远大于 oldString，请重新读取文件提供精确的 oldString",
        };
      }
      let result: string;
      if (replaceAll) {
        result = searchContent.replaceAll(search, replacement);
      } else {
        const lastIndex = searchContent.lastIndexOf(search);
        if (index !== lastIndex) continue; // 多处匹配且非 replaceAll，跳过
        result = searchContent.substring(0, index) + replacement + searchContent.substring(index + search.length);
      }
      return { newContent: convertToLineEnding(result, ending), applied: true };
    }
  }

  return {
    newContent: content,
    applied: false,
    error: "未找到 oldString（所有匹配策略均失败）。请重新读取文件，提供精确的原文。",
  };
}
