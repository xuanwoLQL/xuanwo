/**
 * 多智能体编排器
 * 主控（openharmony-hunter）负责分解任务、调度子智能体、汇总结果。
 * 子智能体之间通过 AuditContext 传递审计状态。
 */
import type { LlmClient } from "../llm/client.js";
import type { AgentConfig } from "./config.js";
import { createEmptyContext, mergeContext, type AuditContext } from "./audit-context.js";
import { ReActAgent, type AgentTool, type AgentRunOptions, type AgentResult } from "./react.js";

export interface OrchestratorOptions {
  maxSubagentDepth?: number;
}

export interface OrchestratorStep {
  agentId: string;
  type: "dispatch" | "result" | "merge" | "final" | "think" | "tool" | "observe";
  content: string;
  context?: AuditContext;
}

export class AgentOrchestrator {
  private agents = new Map<string, AgentConfig>();
  private tools = new Map<string, AgentTool>();
  private llm: LlmClient;

  constructor(
    llm: LlmClient,
    agentConfigs: Iterable<AgentConfig>,
    tools: Iterable<AgentTool>,
    private options: OrchestratorOptions = {}
  ) {
    this.llm = llm;
    for (const a of agentConfigs) this.agents.set(a.id, a);
    for (const t of tools) this.tools.set(t.definition.name, t);
  }

  listAgents(): { id: string; name: string; role: string; description: string; whenToUse?: string }[] {
    return [...this.agents.values()].map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      description: a.description,
      whenToUse: a.whenToUse,
    }));
  }

  /** 动态注册工具（如 MCP 工具） */
  addTool(tool: AgentTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  listTools(): string[] {
    return [...this.tools.keys()];
  }

  hasAgent(id: string): boolean {
    return this.agents.has(id);
  }

  private createAgent(agentId: string): ReActAgent {
    const cfg = this.agents.get(agentId);
    if (!cfg) throw new Error(`智能体不存在: ${agentId}`);
    return new ReActAgent(this.llm, this.tools, cfg);
  }

  /**
   * 主控调度流程
   * @param task 用户任务
   * @param onStep 进度回调
   */
  async run(
    task: string,
    initialContext?: Partial<AuditContext>,
    onStep?: (step: OrchestratorStep) => void,
    runOptions: AgentRunOptions = {}
  ): Promise<{ conclusion: string; context: AuditContext }> {
    const master = this.agents.get("openharmony-hunter");
    if (!master) throw new Error("缺少主控智能体 openharmony-hunter");

    let context: AuditContext = mergeContext(createEmptyContext(), initialContext ?? {});
    onStep?.({ agentId: master.id, type: "dispatch", content: `主控接收任务: ${task}` });

    // 主控 ReAct 循环决定如何调度
    const masterAgent = new ReActAgent(this.llm, this.tools, master);
    const result = await masterAgent.run(task, context, {
      ...runOptions,
      onStep: (s) => {
        onStep?.({ agentId: master.id, type: s.type as OrchestratorStep["type"], content: s.content, context });
      },
    });

    context = mergeContext(context, result.context);

    // 从 rawFinal 解析主控的 dispatch 调度指令
    const dispatch = result.rawFinal?.dispatch ?? [];
    if (dispatch.length > 0) {
      onStep?.({ agentId: master.id, type: "dispatch", content: `主控派发 ${dispatch.length} 个子任务`, context });
      const subResults: string[] = [];
      for (const d of dispatch) {
        if (!this.agents.has(d.agent)) {
          onStep?.({ agentId: master.id, type: "observe", content: `子智能体不存在，跳过: ${d.agent}`, context });
          continue;
        }
        onStep?.({ agentId: d.agent, type: "dispatch", content: d.task, context });
        try {
          const sub = await this.runSubagent(d.agent, d.task, context, onStep, runOptions);
          context = mergeContext(context, sub.context);
          subResults.push(`### ${d.agent} 子任务「${d.task}」\n${sub.conclusion}`);
        } catch (e) {
          subResults.push(`### ${d.agent} 子任务「${d.task}」执行失败\n${(e as Error).message}`);
        }
      }
      // 汇总
      const merged = result.conclusion + "\n\n## 子智能体汇总\n" + subResults.join("\n\n");
      onStep?.({ agentId: master.id, type: "merge", content: `汇总 ${subResults.length} 个子智能体结果`, context });
      return { conclusion: merged, context };
    }

    onStep?.({ agentId: master.id, type: "final", content: result.conclusion, context });
    return { conclusion: result.conclusion, context };
  }

  /** 从主控 final 文本中提取 dispatch 调度指令 */
  private extractDispatch(conclusion: string): { agent: string; task: string }[] {
    try {
      const parsed = JSON.parse(conclusion) as {
        dispatch?: { agent: string; task: string }[];
      };
      if (Array.isArray(parsed.dispatch)) {
        return parsed.dispatch
          .filter((d) => d && typeof d.agent === "string" && typeof d.task === "string")
          .map((d) => ({ agent: d.agent, task: d.task }));
      }
    } catch {
      /* 非 JSON，无调度 */
    }
    return [];
  }

  /**
   * 直接运行子智能体（供主控或用户显式调用）
   */
  async runSubagent(
    agentId: string,
    task: string,
    context: AuditContext,
    onStep?: (s: OrchestratorStep) => void,
    runOptions: AgentRunOptions = {}
  ): Promise<AgentResult> {
    const agent = this.createAgent(agentId);
    const result = await agent.run(task, context, {
      ...runOptions,
      onStep: (s) => onStep?.({ agentId, type: s.type as OrchestratorStep["type"], content: s.content, context }),
    });
    onStep?.({ agentId, type: "result", content: result.conclusion, context: mergeContext(context, result.context) });
    return result;
  }
}
