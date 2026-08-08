/**
 * 函数索引器（借鉴 SCOUT function_index + file_graph）
 * 用 tree-sitter 解析 C/C++ 源码，构建：
 * - 函数索引：函数名/签名/行范围/函数体/文件内调用关系
 * - 支持 Agent 受限探索（view_index/view_function），解决大规模源码浏览问题
 */
import * as ts from "web-tree-sitter";
import { readFileSync } from "node:fs";
import { join, extname, relative } from "node:path";

export interface IndexedFunction {
  name: string;
  signature: string;
  startLine: number;
  endLine: number;
  body: string;
  /** 文件内被调用的函数名 */
  callees: string[];
}

export interface FileIndex {
  path: string;
  language: "c" | "cpp";
  functions: IndexedFunction[];
}

let langCache: { c: ts.Language | null; cpp: ts.Language | null } = { c: null, cpp: null };
let initialized = false;

async function ensureInit(): Promise<void> {
  if (initialized) return;
  await ts.Parser.init();
  initialized = true;
}

/** 加载语言语法（缓存） */
async function loadLanguage(kind: "c" | "cpp"): Promise<ts.Language> {
  await ensureInit();
  if (langCache[kind]) return langCache[kind];
  const wasmPath = join(process.cwd(), "node_modules", "tree-sitter-wasm", "out", kind, `tree-sitter-${kind}.wasm`);
  const wasm = readFileSync(wasmPath);
  const lang = await ts.Language.load(wasm);
  langCache[kind] = lang;
  return lang;
}

/** 判断文件语言 */
export function detectLanguage(file: string): "c" | "cpp" | null {
  const ext = extname(file).toLowerCase();
  if (ext === ".c" || ext === ".h") return "c";
  if (ext === ".cpp" || ext === ".cc" || ext === ".cxx" || ext === ".hpp" || ext === ".hh") return "cpp";
  return null;
}

/** 从函数体节点提取被调用的函数名 */
function extractCallees(node: unknown): string[] {
  const callees = new Set<string>();
  const stack: unknown[] = [node];
  while (stack.length) {
    const cur = stack.pop() as { type?: string; children?: unknown[]; text?: string };
    if (!cur) continue;
    if (cur.type === "call_expression" && cur.children) {
      // 第一个子节点是函数名
      const first = cur.children[0] as { type?: string; text?: string } | undefined;
      if (first && first.type === "identifier" && first.text) {
        callees.add(first.text.trim());
      }
    }
    if (cur.children) stack.push(...cur.children);
  }
  return [...callees];
}

/**
 * 索引单个文件
 * @returns FileIndex 或 null（非 C/C++ 或解析失败）
 */
export async function indexFile(filePath: string, sourceRoot?: string): Promise<FileIndex | null> {
  const lang = detectLanguage(filePath);
  if (!lang) return null;
  try {
    const language = await loadLanguage(lang);
    const parser = new ts.Parser();
    parser.setLanguage(language);
    const content = readFileSync(filePath, "utf8");
    const tree = parser.parse(content);
    if (!tree) return null;

    const funcs: IndexedFunction[] = [];
    const root = tree.rootNode as unknown as { children?: unknown[]; type: string };

    // 遍历顶层找 function_definition
    const walk = (node: unknown) => {
      const n = node as { type?: string; children?: unknown[]; startIndex?: number; endIndex?: number; startPosition?: { row: number }; endPosition?: { row: number } };
      if (!n || typeof n !== "object") return;
      if (n.type === "function_definition") {
        const fn = extractFunction(n, content);
        if (fn) funcs.push(fn);
      }
      // 只深入顶层函数体内部找嵌套定义（如 lambda 少见，这里不深入嵌套避免重复）
      if (n.children) {
        for (const c of n.children) walk(c);
      }
    };
    walk(root);

    if (funcs.length === 0) return null;
    return {
      path: sourceRoot ? relative(sourceRoot, filePath).replace(/\\/g, "/") : filePath,
      language: lang,
      functions: funcs,
    };
  } catch {
    return null;
  }
}

function extractFunction(
  node: { children?: unknown[]; startIndex?: number; endIndex?: number; startPosition?: { row: number }; endPosition?: { row: number } },
  content: string
): IndexedFunction | null {
  // 函数名：找 declarator > function_declarator > declarator > identifier
  let name = "";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bodyNode: any = null;
  let nameIndex = -1;

  const findName = (n: unknown, depth: number) => {
    if (depth > 6 || name) return;
    const nd = n as { type?: string; children?: unknown[]; text?: string; startIndex?: number };
    if (!nd || typeof nd !== "object") return;
    if (nd.type === "function_declarator" && nd.children) {
      // function_declarator 的第一个子节点通常是 identifier（函数名）
      const first = nd.children[0] as { type?: string; text?: string; startIndex?: number };
      if (first && first.type === "identifier" && first.text) {
        name = first.text.trim();
        nameIndex = first.startIndex ?? -1;
        return;
      }
      // 也可能有 declarator 包装
      const declarator = nd.children.find((c) => (c as { type?: string }).type === "declarator") as
        | { children?: unknown[]; type?: string }
        | undefined;
      if (declarator?.children) {
        const id = declarator.children.find((c) => (c as { type?: string }).type === "identifier") as
          | { text?: string; startIndex?: number }
          | undefined;
        if (id?.text && typeof id.startIndex === "number") {
          name = id.text.trim();
          nameIndex = id.startIndex;
          return;
        }
      }
      // qualified_identifier 情况
      const qid = nd.children.find((c) => (c as { type?: string }).type === "qualified_identifier") as
        | { children?: unknown[]; text?: string }
        | undefined;
      if (qid?.children) {
        const last = qid.children[qid.children.length - 1] as { type?: string; text?: string };
        if (last.type === "identifier" && last.text) {
          name = last.text.trim();
          return;
        }
      }
    }
    if (nd.children) {
      for (const c of nd.children) findName(c, depth + 1);
    }
  };

  // 找 body（compound_statement）
  const findBody = (n: unknown, depth: number) => {
    if (depth > 8 || bodyNode) return;
    const nd = n as { type?: string; children?: unknown[]; startIndex?: number; endIndex?: number; startPosition?: { row: number }; endPosition?: { row: number } };
    if (!nd || typeof nd !== "object") return;
    if (nd.type === "compound_statement") {
      bodyNode = nd;
      return;
    }
    if (nd.children) {
      for (const c of nd.children) findBody(c, depth + 1);
    }
  };

  if (node.children) {
    for (const c of node.children) {
      findName(c, 0);
      findBody(c, 0);
    }
  }

  if (!name || !bodyNode) return null;
  const startLine = (bodyNode.startPosition?.row ?? 0) + 1;
  const endLine = (bodyNode.endPosition?.row ?? 0) + 1;
  const body = content.slice(bodyNode.startIndex ?? 0, bodyNode.endIndex ?? 0);
  const signature = content.slice(nameIndex >= 0 ? nameIndex : 0, bodyNode.startIndex ?? 0).split("\n").map((l) => l.trim()).join(" ").slice(-200);

  return {
    name,
    signature,
    startLine,
    endLine,
    body,
    callees: extractCallees(bodyNode),
  };
}

/** 索引目录下所有 C/C++ 文件 */
export async function indexDirectory(dir: string, maxFiles = 500, depth = 6): Promise<FileIndex[]> {
  const { readdirSync, statSync } = await import("node:fs");
  const out: FileIndex[] = [];
  const skip = new Set([".git", "node_modules", "build", "out", "third_party", "test", "tests"]);
  const paths: string[] = [];
  const collect = (d: string, lv: number) => {
    if (lv > depth || paths.length >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const e of entries) {
      if (skip.has(e)) continue;
      const p = join(d, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) collect(p, lv + 1);
      else if (detectLanguage(p)) paths.push(p);
      if (paths.length >= maxFiles) return;
    }
  };
  collect(dir, 0);
  for (const p of paths) {
    const idx = await indexFile(p, dir);
    if (idx) out.push(idx);
  }
  return out;
}

/** 从文件索引生成 SCOUT 风格的 VIEW_INDEX 输出 */
export function formatViewIndex(fileIdx: FileIndex): string {
  const lines = fileIdx.functions.map((f) => {
    return `${f.name} (${f.signature || "?"}) [L${f.startLine}-${f.endLine}]`;
  });
  return `文件 ${fileIdx.path} 的函数索引 (${fileIdx.functions.length} 个):\n${lines.join("\n")}`;
}

/** 从文件索引生成 VIEW_FUNCTION 输出 */
export function formatViewFunction(fileIdx: FileIndex, funcName: string): string {
  const fn = fileIdx.functions.find((f) => f.name === funcName);
  if (!fn) return `函数 ${funcName} 不在 ${fileIdx.path} 中`;
  const calleeStr = fn.callees.length ? `\n调用: ${fn.callees.join(", ")}` : "";
  return `函数 ${fn.name}${fn.signature ? ` ${fn.signature}` : ""} [L${fn.startLine}-${fn.endLine}]${calleeStr}\n\`\`\`\n${fn.body}\n\`\`\``;
}
