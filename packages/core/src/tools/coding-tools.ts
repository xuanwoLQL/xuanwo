/**
 * 编程模式工具集（借鉴 opencode write/glob/todo 等）
 * 供编程模式智能体使用。所有写操作经 ToolExecutor 授权路径校验。
 */
import { writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import type { ToolExecutor } from "./ToolExecutor.js";
import type { AgentTool } from "../agent/react.js";
import { applyEdit } from "./edit.js";

export function createCodingTools(toolExecutor: ToolExecutor): AgentTool[] {
  return [
    {
      definition: {
        name: "write",
        description: "写文件（覆盖或创建）。参数: {path: string, content: string}",
        parameters: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
      execute: async (args) => {
        const path = String(args.path ?? "");
        const content = String(args.content ?? "");
        if (!path) return "错误: 缺少 path";
        try {
          const abs = toolExecutor.checkPath(path);
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, content, "utf8");
          return `✅ 已写入 ${abs} (${content.length} 字符)`;
        } catch (e) {
          return `错误: ${(e as Error).message}`;
        }
      },
    },
    {
      definition: {
        name: "edit",
        description: "编辑文件（精确替换）。参数: {path: string, oldString: string, newString: string, replaceAll?: boolean}。多策略匹配容错。",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            oldString: { type: "string" },
            newString: { type: "string" },
            replaceAll: { type: "boolean" },
          },
          required: ["path", "oldString", "newString"],
        },
      },
      execute: async (args) => {
        const path = String(args.path ?? "");
        const oldString = String(args.oldString ?? "");
        const newString = String(args.newString ?? "");
        if (!path) return "错误: 缺少 path";
        try {
          const abs = toolExecutor.checkPath(path);
          const { readFileSync } = await import("node:fs");
          const content = readFileSync(abs, "utf8");
          const r = applyEdit(content, oldString, newString, Boolean(args.replaceAll));
          if (!r.applied) return `❌ ${r.error ?? "编辑失败"}`;
          writeFileSync(abs, r.newContent, "utf8");
          return `✅ 已编辑 ${abs}`;
        } catch (e) {
          return `错误: ${(e as Error).message}`;
        }
      },
    },
    {
      definition: {
        name: "glob",
        description: "按模式查找文件。参数: {pattern: string, path?: string}",
        parameters: {
          type: "object",
          properties: { pattern: { type: "string" }, path: { type: "string" } },
          required: ["pattern"],
        },
      },
      execute: async (args) => {
        const pattern = String(args.pattern ?? "");
        const path = args.path ? String(args.path) : undefined;
        if (!pattern) return "错误: 缺少 pattern";
        try {
          const base = path ? toolExecutor.checkPath(path) : undefined;
          // 简化 glob：用 readdirSync 递归匹配
          const { findFiles } = await import("./file-utils.js");
          const root = base ?? (await findCwdRoot());
          const matches = findFiles(root, pattern, 200);
          return matches.length ? matches.join("\n") : `无匹配: ${pattern}`;
        } catch (e) {
          return `错误: ${(e as Error).message}`;
        }
      },
    },
    {
      definition: {
        name: "todo",
        description: "管理任务清单。参数: {action: list|add|complete, items?: string[], id?: number}",
        parameters: {
          type: "object",
          properties: { action: { type: "string" }, items: { type: "array", items: { type: "string" } }, id: { type: "number" } },
          required: ["action"],
        },
      },
      execute: async (args) => {
        const action = String(args.action ?? "list");
        // 简易内存 todo（单次会话）
        const key = "__xuanwo_todo__";
        const g = globalThis as unknown as Record<string, unknown>;
        const list = (g[key] as { text: string; done: boolean }[]) ?? [];
        if (action === "add") {
          for (const it of (args.items as string[]) ?? []) list.push({ text: it, done: false });
          g[key] = list;
          return `已添加 ${(args.items as string[])?.length ?? 0} 项任务`;
        }
        if (action === "complete") {
          const id = Number(args.id ?? 0);
          if (list[id]) list[id].done = true;
          g[key] = list;
          return `已完成任务 #${id}`;
        }
        if (list.length === 0) return "任务清单为空";
        return list.map((t, i) => `${t.done ? "✅" : "⬜"} ${i}. ${t.text}`).join("\n");
      },
    },
  ];
}

async function findCwdRoot(): Promise<string> {
  return resolve(process.cwd());
}
