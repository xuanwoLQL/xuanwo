/**
 * Ink TUI 启动器：装配 runtime + 命令处理 + 工具调用可视化
 */
import type { AgentRuntime } from "@xuanwo/core";
import { launchInkTui } from "./ink-chat.js";

export async function runInkTui(): Promise<void> {
  const { AgentRuntime } = await import("@xuanwo/core");
  const runtime = await AgentRuntime.create();

  const onTask = async (
    input: string,
    addAssistant: (content: string) => void,
    setBusy: (b: boolean) => void
  ): Promise<string> => {
    const trimmed = input.trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    // 快捷命令
    switch (cmd) {
      case "/help":
        return helpText();
      case "/status": {
        const agents = runtime.availableAgents();
        return `智能体: ${agents.map((a) => a.id).join(", ")}\n知识库模式: ${runtime.knowledge.size}\n技能: ${runtime.skills.list().map((s) => s.id).join(", ")}`;
      }
      case "/scan": {
        const path = parts[1];
        if (!path) return "用法: /scan <path>";
        if (!runtime.config.isAuthorized(path)) {
          return `❌ 路径未授权: ${path}\n运行: xuanwo config --authorize "${path}"`;
        }
        addAssistant(`📡 开始扫描 ${path}（主控调度，这可能耗时较长）...`);
        return await runAgentTask(runtime, `全面审计源码目录 ${path}，识别所有安全漏洞`);
      }
      case "/analyze": {
        const file = parts[1];
        if (!file) return "用法: /analyze <file>";
        if (!runtime.config.isAuthorized(file)) {
          return `❌ 路径未授权: ${file}`;
        }
        addAssistant(`🔬 深度分析 ${file}...`);
        return await runAgentTask(runtime, `深度分析文件 ${file} 的所有安全风险，调度合适子智能体`);
      }
      case "/knowledge": {
        const q = parts.slice(1).join(" ");
        if (!q) return "用法: /knowledge <关键词>";
        const retriever = runtime.knowledge.retriever();
        const results = retriever.search(q);
        if (results.length === 0) return `无匹配: ${q}`;
        return results
          .slice(0, 6)
          .map((r, i) => `${i + 1}. [${r.pattern.vulnerabilityType}] ${r.pattern.modulePath} (score=${r.score.toFixed(2)}) conf=${r.pattern.confidence}\n   ${r.pattern.fixDescription ?? ""}`)
          .join("\n");
      }
      case "/nday":
        return "Nday 学习模式：知识库含 214 条模式。用 /knowledge <关键词> 检索。";
      case "/quit":
      case "/exit":
        process.exit(0);
        return "";
      default:
        if (cmd.startsWith("/")) {
          return `未知命令: ${cmd}\n${helpText()}`;
        }
        // 普通消息 → 主控智能体
        return await runAgentTask(runtime, trimmed);
    }
  };

  launchInkTui(runtime, onTask);
}

function helpText(): string {
  return [
    "可用命令:",
    "  /scan <path>         启动源码扫描（主控调度）",
    "  /analyze <file>      深度分析单个文件",
    "  /knowledge <关键词>   RAG 检索知识库",
    "  /nday                Nday 学习模式",
    "  /status              查看状态",
    "  /help                帮助",
    "  /quit                退出",
    "任意文本 → 直接与主控智能体对话",
  ].join("\n");
}

async function runAgentTask(runtime: AgentRuntime, task: string): Promise<string> {
  try {
    const { conclusion, context } = await runtime.runTask(task, {}, (step) => {
      // 工具调用可视化（可选：这里简化为最终结论，工具过程在消息区展示）
    });
    const points = context.suspiciousPoints;
    let out = conclusion;
    if (points.length > 0) {
      out += `\n\n【可疑点 ${points.length} 个】`;
      points.forEach((p, i) => {
        out += `\n  ${i + 1}. [${p.type}] ${p.location} (conf=${p.confidence})`;
        out += `\n     ${p.description.slice(0, 120)}`;
      });
    }
    return out;
  } catch (e) {
    return `❌ 执行失败: ${(e as Error).message}`;
  }
}
