/**
 * 智能体配置解析器
 * 读取 Markdown 配置文件（YAML frontmatter + 提示词主体），
 * 并用运行时上下文替换模板变量（{{KNOWLEDGE_SUMMARY}} 等）。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  description: string;
  /** 何时使用该智能体（借鉴 opencode whenToUse，主控调度决策依据） */
  whenToUse?: string;
  model?: string;
  tools: string[];
  subagents: string[];
  systemPrompt: string;
  sourcePath: string;
}

export interface TemplateContext {
  DEFAULT_MODEL: string;
  KNOWLEDGE_SUMMARY: string;
  [k: string]: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/** 简易 YAML frontmatter 解析（仅处理扁平键值 + 数组） */
export function parseFrontmatter(yaml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const line of yaml.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].trim();
    if (val.startsWith("[")) {
      out[key] = val
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    } else if (val === "true") {
      out[key] = true;
    } else if (val === "false") {
      out[key] = false;
    } else if (/^".*"$/.test(val) || /^'.*'$/.test(val)) {
      out[key] = val.slice(1, -1);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/** 模板变量替换 */
export function renderTemplate(prompt: string, ctx: TemplateContext): string {
  return prompt.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (full, key: string) => {
    if (key in ctx) return ctx[key];
    return full; // 保留未替换的占位符，便于发现配置遗漏
  });
}

export function parseAgentFile(
  filePath: string,
  ctx: TemplateContext
): AgentConfig {
  const source = readFileSync(filePath, "utf8");
  const m = source.match(FRONTMATTER_RE);
  if (!m) {
    throw new Error(`智能体配置缺少 frontmatter: ${filePath}`);
  }
  const meta = parseFrontmatter(m[1]);
  const body = m[2];

  const id = String(meta.id ?? "");
  if (!id) throw new Error(`智能体配置缺少 id: ${filePath}`);

  return {
    id,
    name: String(meta.name ?? id),
    role: String(meta.role ?? "子智能体"),
    description: String(meta.description ?? ""),
    whenToUse: meta.whenToUse ? renderTemplate(String(meta.whenToUse), ctx) : undefined,
    model: meta.model ? renderTemplate(String(meta.model), ctx) : undefined,
    tools: Array.isArray(meta.tools) ? (meta.tools as string[]) : [],
    subagents: Array.isArray(meta.subagents) ? (meta.subagents as string[]) : [],
    systemPrompt: renderTemplate(body.trim(), ctx),
    sourcePath: filePath,
  };
}

/** 从目录加载所有智能体配置 */
export function loadAgentsFromDir(
  dir: string,
  ctx: TemplateContext
): Map<string, AgentConfig> {
  const map = new Map<string, AgentConfig>();
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const cfg = parseAgentFile(join(dir, f), ctx);
    map.set(cfg.id, cfg);
  }
  return map;
}
