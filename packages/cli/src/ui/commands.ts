/**
 * TUI 快捷命令处理器
 * 支持: /help /scan /analyze /nday /report /knowledge /session /status /quit
 */
import { AgentRuntime } from "@xuanwo/core";
import type { LightTui } from "./tui.js";

export interface CommandHandlerContext {
  tui: LightTui;
  runtime: AgentRuntime;
  onStatusChange: () => void;
  setMode: (mode: string) => void;
}

const HELP_TEXT = `
可用命令:
  /help                显示帮助
  /status              查看当前状态
  /scan <path>         启动源码扫描（主控智能体）
  /analyze <file>      深度分析单个文件
  /nday                进入 Nday 学习模式（检索知识库）
  /report              生成当前审计报告
  /knowledge [q]       查询知识库（/knowledge use-after-free）
  /session list|load   会话管理
  /quit                退出
快捷键:
  Ctrl+P  命令面板  |  Ctrl+T  切换变体  |  Tab  切换智能体
`;

export async function handleCommand(
  input: string,
  ctx: CommandHandlerContext
): Promise<void> {
  const { tui, runtime } = ctx;
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case "/help":
      tui.write(HELP_TEXT);
      return;

    case "/status": {
      const status = `模式: ${statusOf(ctx)}\n知识库模式数: ${runtime.knowledge.size}\n可用智能体: ${runtime.availableAgents().map((a) => a.id).join(", ")}`;
      tui.write(status);
      return;
    }

    case "/scan": {
      const path = parts[1];
      if (!path) {
        tui.write("用法: /scan <path>");
        return;
      }
      if (!runtime.config.isAuthorized(path)) {
        tui.write(`❌ 路径未授权: ${path}。请运行 xuanwo config --authorize "${path}"`);
        return;
      }
      ctx.setMode(`scan:${path}`);
      tui.write(`开始扫描 ${path}（主控调度）...`);
      await runAgentTask(tui, runtime, "openharmony-hunter", `全面审计源码目录 ${path}，识别所有安全漏洞`, ctx);
      return;
    }

    case "/analyze": {
      const file = parts[1];
      if (!file) {
        tui.write("用法: /analyze <file>");
        return;
      }
      if (!runtime.config.isAuthorized(file)) {
        tui.write(`❌ 路径未授权: ${file}`);
        return;
      }
      ctx.setMode(`analyze:${file}`);
      tui.write(`深度分析 ${file}...`);
      await runAgentTask(tui, runtime, "openharmony-hunter", `深度分析文件 ${file} 的所有安全风险，调度合适子智能体`, ctx);
      return;
    }

    case "/nday": {
      ctx.setMode("nday");
      tui.write("Nday 学习模式。可用: /knowledge <关键词> 检索已提取的 214 条模式");
      tui.write("知识库统计：");
      const kbStats = await statsText(runtime);
      tui.write(kbStats);
      return;
    }

    case "/report": {
      tui.write("审计报告将在阶段六提供完整版本。当前会话上下文见 /status");
      return;
    }

    case "/knowledge": {
      const query = parts.slice(1).join(" ");
      if (!query) {
        tui.write("用法: /knowledge <关键词>  如 /knowledge use-after-free");
        return;
      }
      const retriever = runtime.knowledge.retriever();
      const results = retriever.search(query);
      tui.write(`检索 "${query}": ${results.length} 条命中`);
      results.slice(0, 8).forEach((r, i) => {
        const p = r.pattern;
        tui.write(`  ${i + 1}. [${p.vulnerabilityType}] ${p.modulePath} (score=${r.score.toFixed(2)}) conf=${p.confidence}`);
        tui.write(`     ${p.fixDescription || ""}`);
      });
      return;
    }

    case "/session": {
      if (parts[1] === "list") {
        const list = runtime.sessionList?.() ?? [];
        if (list.length === 0) {
          tui.write("暂无会话");
        } else {
          list.forEach((s) => tui.write(`  ${s.id} — ${s.title} (${s.updatedAt})`));
        }
      } else {
        tui.write("用法: /session list   (save/load 请用命令行 xuanwo session)");
      }
      return;
    }

    case "/quit":
    case "/exit":
      tui.write("再见。");
      tui.close();
      process.exit(0);
      return;

    default:
      tui.write(`未知命令: ${cmd}. 输入 /help 查看。`);
  }
}

function statusOf(ctx: CommandHandlerContext): string {
  return (ctx as unknown as { currentMode: string }).currentMode ?? "interactive";
}

async function statsText(runtime: AgentRuntime): Promise<string> {
  const P = runtime.knowledge.all();
  const types: Record<string, number> = {};
  P.forEach((p) => {
    types[p.vulnerabilityType] = (types[p.vulnerabilityType] ?? 0) + 1;
  });
  return `类型分布: ${Object.entries(types).map(([k, v]) => `${k}=${v}`).join(", ")}`;
}

async function runAgentTask(
  tui: LightTui,
  runtime: AgentRuntime,
  agentId: string,
  task: string,
  ctx: CommandHandlerContext
): Promise<void> {
  tui.write("执行中...");
  try {
    const { conclusion, context } = await runtime.runTask(task, {}, (step) => {
      if (step.type === "tool" || step.type === "final") {
        ctx.onStatusChange();
      }
    });
    tui.write("\n===== 结论 =====");
    tui.write(conclusion);
    tui.write("\n===== 可疑点 =====");
    context.suspiciousPoints.forEach((p, i) => {
      tui.write(`  ${i + 1}. [${p.type}] ${p.location} (conf=${p.confidence})`);
    });
  } catch (e) {
    tui.write(`❌ 执行失败: ${(e as Error).message}`);
  }
}
