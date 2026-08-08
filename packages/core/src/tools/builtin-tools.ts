/**
 * 内置 Agent 工具
 * 所有工具的执行都必须经过 ToolExecutor 安全接口或等价的路径校验，
 * 禁止智能体直接访问任意文件系统路径。
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ToolExecutor } from "./ToolExecutor.js";
import type { AgentTool } from "../agent/react.js";
import { createMethodologyTools } from "../agent/methodology.js";
import { isWslPath, toWslPath, wslReadFile, wslGrep } from "./wsl.js";

/** 纯 JS 递归 grep（不依赖外部命令，规避 Windows 无 rg 问题） */
function grepTree(
  dir: string,
  pattern: RegExp,
  include?: RegExp,
  maxMatches = 50,
  depth = 0
): string[] {
  const out: string[] = [];
  if (depth > 6) return out;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === ".git" || e === "node_modules" || e.startsWith(".")) continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...grepTree(p, pattern, include, maxMatches, depth + 1));
    } else if (st.isFile()) {
      if (include && !include.test(e)) continue;
      try {
        const content = readFileSync(p, "utf8");
        for (const line of content.split("\n")) {
          if (pattern.test(line)) {
            out.push(`${p.replace(/\\/g, "/")}: ${line.trim().slice(0, 300)}`);
            if (out.length >= maxMatches) return out;
          }
        }
      } catch {
        /* 忽略二进制/不可读文件 */
      }
    }
    if (out.length >= maxMatches) return out;
  }
  return out;
}

export interface ContextBridge {
  getContext: () => import("../agent/audit-context.js").AuditContext;
  setContext: (ctx: import("../agent/audit-context.js").AuditContext) => void;
}

export function createBuiltinTools(
  toolExecutor: ToolExecutor,
  skills?: import("../skills/registry.js").SkillRegistry,
  contextBridge?: ContextBridge
): AgentTool[] {
  const tools: AgentTool[] = [
    {
      definition: {
        name: "read",
        description: "读取授权目录内的文件内容。参数: {path: string}",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
      execute: async (args) => {
        const path = String(args.path ?? "");
        if (!path) return "错误: 缺少 path 参数";
        try {
          // WSL 路径走 wsl 通道
          if (isWslPath(path)) {
            const wslPath = toWslPath(path);
            const f = wslReadFile(wslPath);
            return f.content + (f.truncated ? "\n...（已截断）" : "");
          }
          const abs = toolExecutor.checkPath(path);
          if (!existsSync(abs)) return `错误: 文件不存在 ${abs}`;
          const content = readFileSync(abs, "utf8");
          return content.slice(0, 20000) + (content.length > 20000 ? "\n...（已截断）" : "");
        } catch (e) {
          return `错误: ${(e as Error).message}`;
        }
      },
    },
    {
      definition: {
        name: "grep",
        description: "在授权目录内用 grep 搜索文本。参数: {pattern: string, path: string, include?: string}",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string" },
            path: { type: "string" },
            include: { type: "string" },
          },
          required: ["pattern", "path"],
        },
      },
      execute: async (args) => {
        const pattern = String(args.pattern ?? "");
        const path = String(args.path ?? "");
        const include = args.include ? String(args.include) : undefined;
        if (!pattern || !path) return "错误: 缺少 pattern 或 path";
        try {
          if (isWslPath(path)) {
            const wslPath = toWslPath(path);
            const hits = wslGrep(wslPath, pattern, include, 50);
            return hits.length ? hits.join("\n") : "无匹配";
          }
          const abs = toolExecutor.checkPath(path);
          let re: RegExp;
          try {
            re = new RegExp(pattern);
          } catch {
            return `错误: 无效正则 ${pattern}`;
          }
          const inc = include ? new RegExp(include.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) : undefined;
          const matches = grepTree(abs, re, inc, 50);
          return matches.length ? matches.join("\n") : "无匹配";
        } catch (e) {
          return `错误: ${(e as Error).message}`;
        }
      },
    },
  ];

  // load_skill 工具：按需加载技能详情（技能作为可发现资源）
  if (skills) {
    tools.push({
      definition: {
        name: "load_skill",
        description: `加载技能详情（审计指南）。可用技能: ${skills.list().map((s) => s.id).join(", ")}。参数: {skill: string}`,
        parameters: {
          type: "object",
          properties: { skill: { type: "string" } },
          required: ["skill"],
        },
      },
      execute: async (args) => {
        const id = String(args.skill ?? "");
        if (!id) return "错误: 缺少 skill 参数";
        const body = skills.getBody(id);
        if (body === undefined) {
          return `错误: 技能不存在 "${id}"。可用: ${skills.list().map((s) => s.id).join(", ")}`;
        }
        return body;
      },
    });
  }

  // 方法论工具（借鉴 CyberStrike Methodology Engine）
  if (contextBridge) {
    tools.push(...createMethodologyTools(contextBridge.getContext, contextBridge.setContext));
  }

  // 代码探索工具（借鉴 IVAgent get_function_def/get_callee）
  tools.push({
    definition: {
      name: "find_function_def",
      description: "在源码中查找函数的定义位置。参数: {func: string, path: string, maxResults?: number}",
      parameters: {
        type: "object",
        properties: {
          func: { type: "string" },
          path: { type: "string" },
          maxResults: { type: "number" },
        },
        required: ["func", "path"],
      },
    },
    execute: async (args) => {
      const func = String(args.func ?? "");
      const path = String(args.path ?? "");
      if (!func || !path) return "错误: 缺少 func 或 path";
      try {
        // 构造函数签名匹配：函数名后跟 ( 且前一行或本行是返回类型
        const pattern = `(?:^|\\n)(?:[A-Za-z_][\\w:<>*& ]*\\s+)?${escapeRe(func)}\\s*\\(`;
        const maxResults = Number(args.maxResults ?? 5);
        if (isWslPath(path)) {
          const wslPath = toWslPath(path);
          const hits = wslGrep(wslPath, `\\b${escapeRe(func)}\\s*\\(`, undefined, maxResults);
          return hits.length ? hits.join("\n") : `未找到函数 ${func} 的定义`;
        }
        const abs = toolExecutor.checkPath(path);
        const re = new RegExp(pattern, "g");
        const matches = grepTree(abs, re, /\.(c|cpp|cc|h|hpp)$/, maxResults);
        return matches.length ? matches.join("\n") : `未找到函数 ${func} 的定义`;
      } catch (e) {
        return `错误: ${(e as Error).message}`;
      }
    },
  });
  tools.push({
    definition: {
      name: "find_callers",
      description: "查找调用某函数的所有位置。参数: {func: string, path: string, maxResults?: number}",
      parameters: {
        type: "object",
        properties: {
          func: { type: "string" },
          path: { type: "string" },
          maxResults: { type: "number" },
        },
        required: ["func", "path"],
      },
    },
    execute: async (args) => {
      const func = String(args.func ?? "");
      const path = String(args.path ?? "");
      if (!func || !path) return "错误: 缺少 func 或 path";
      try {
        const maxResults = Number(args.maxResults ?? 10);
        if (isWslPath(path)) {
          const wslPath = toWslPath(path);
          const hits = wslGrep(wslPath, `\\b${escapeRe(func)}\\s*\\(`, undefined, maxResults);
          return hits.length ? hits.join("\n") : `未找到 ${func} 的调用者`;
        }
        const abs = toolExecutor.checkPath(path);
        const re = new RegExp(`\\b${escapeRe(func)}\\s*\\(`, "g");
        const matches = grepTree(abs, re, /\.(c|cpp|cc|h|hpp)$/, maxResults);
        return matches.length ? matches.join("\n") : `未找到 ${func} 的调用者`;
      } catch (e) {
        return `错误: ${(e as Error).message}`;
      }
    },
  });
  return tools;
}

/** 转义正则特殊字符 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
