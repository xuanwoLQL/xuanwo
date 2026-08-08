/**
 * ReAct 循环：思考(Reason) → 行动(Act) → 观察(Observe) → 循环
 * 是每个智能体的核心执行循环。
 */
import type { LlmClient, ChatMessage, CompletionOptions } from "../llm/client.js";
import type { AgentConfig } from "./config.js";
import { dedupePoints, type AuditContext, type SuspiciousPoint } from "./audit-context.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface AgentTool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<string>;
}

export interface AgentRunOptions {
  maxIterations?: number;
  temperature?: number;
  onStep?: (step: { type: "think" | "tool" | "observe" | "final"; content: string; toolName?: string }) => void;
}

export interface AgentResult {
  conclusion: string;
  iterations: number;
  tokensIn: number;
  tokensOut: number;
  context: AuditContext;
  rawFinal?: { conclusion?: unknown; dispatch?: { agent: string; task: string }[]; suspiciousPoints?: unknown[] };
}

const REACT_SCHEMA = `你是一个基于 ReAct（Reason-Act-Observe）循环工作的智能体。

严格按以下格式输出每一步（JSON）：
{"thought":"你的推理","action":{"tool":"工具名或"final"","input":{...}}}
- 若已能得出结论，action.tool 设为 "final"，input 为 final 对象
- 若需要调用工具，action.tool 为工具名，input 为参数对象
每次只输出一个 JSON 对象，不要包含其他文字。

final 对象格式：
{
  "conclusion": "结论文本（含漏洞分析、file:line、修复建议）",
  "dispatch": [{"agent":"子智能体id","task":"子任务描述"}],
  "suspiciousPoints": [
    {"location":"文件:行号","type":"UAF|缓冲区溢出|权限绕过|条件竞争|整数溢出|其他","description":"描述","confidence":0-1}
  ]
}
- dispatch 可选：主控智能体需要派发子任务时填写，子智能体填 []`;

export class ReActAgent {
  constructor(
    private llm: LlmClient,
    private tools: Map<string, AgentTool>,
    private config: AgentConfig
  ) {}

  private buildSystemPrompt(context: AuditContext): string {
    const toolDesc = [...this.tools.values()]
      .map((t) => `- ${t.definition.name}: ${t.definition.description}`)
      .join("\n");
    return `${this.config.systemPrompt}

${REACT_SCHEMA}

## 可用工具
${toolDesc || "- 无工具（仅推理）"}

## 当前审计上下文（AuditContext）
目标模块: ${context.targetModule || "未指定"}
目标文件: ${context.targetFile || "未指定"}
已发现可疑点: ${context.suspiciousPoints.length ? JSON.stringify(context.suspiciousPoints) : "无"}
分析链: ${context.analysisStack.length ? context.analysisStack.join(" → ") : "空"}`;
  }

  async run(
    task: string,
    context: AuditContext,
    options: AgentRunOptions = {}
  ): Promise<AgentResult> {
    const maxIter = options.maxIterations ?? 10;
    const messages: ChatMessage[] = [
      { role: "system", content: this.buildSystemPrompt(context) },
      { role: "user", content: task },
    ];

    let iterations = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    const workingContext: AuditContext = {
      ...context,
      analysisStack: [...context.analysisStack, this.config.id],
    };

    while (iterations < maxIter) {
      iterations++;
      const opts: CompletionOptions = { temperature: options.temperature ?? 0.2, jsonMode: true };
      const resp = await this.llm.chat(messages, opts);
      tokensIn += resp.tokensIn;
      tokensOut += resp.tokensOut;

      let step: { thought: string; action: { tool: string; input: unknown } };
      try {
        const parsed = JSON.parse(resp.content);
        // 防御性校验：兼容模型输出缺少 action 的情况
        if (!parsed || typeof parsed !== "object" || !parsed.action) {
          options.onStep?.({ type: "observe", content: `模型输出缺少 action 字段，原始: ${resp.content.slice(0, 300)}` });
          messages.push({ role: "user", content: `输出格式错误：缺少 action。必须输出 {"thought":"...","action":{"tool":"..."}}。请重试。` });
          continue;
        }
        step = parsed;
      } catch {
        options.onStep?.({ type: "observe", content: `无法解析模型输出，重试。原始: ${resp.content.slice(0, 200)}` });
        continue;
      }

      options.onStep?.({ type: "think", content: step.thought });

      if (step.action.tool === "final") {
        const input = step.action.input as {
          conclusion?: unknown;
          suspiciousPoints?: { location: string; type: string; description: string; confidence: number }[];
        };
        const conclusion =
          typeof input === "string"
            ? input
            : typeof input?.conclusion === "string"
              ? input.conclusion
              : JSON.stringify(input);
        const points = Array.isArray(input?.suspiciousPoints)
          ? input.suspiciousPoints.map((p) => ({
              location: String(p.location ?? ""),
              type: String(p.type ?? "其他"),
              description: String(p.description ?? ""),
              confidence: typeof p.confidence === "number" ? p.confidence : 0.5,
            }))
          : [];
        workingContext.suspiciousPoints = dedupePoints([
          ...workingContext.suspiciousPoints,
          ...points.filter((p) => p.location),
        ]);
        const rawFinal =
          typeof input === "object" && input !== null
            ? {
                conclusion: input.conclusion,
                dispatch: Array.isArray((input as { dispatch?: unknown }).dispatch)
                  ? ((input as { dispatch: { agent: string; task: string }[] }).dispatch).filter(
                      (d) => d && typeof d.agent === "string" && typeof d.task === "string"
                    )
                  : [],
                suspiciousPoints: input.suspiciousPoints,
              }
            : undefined;
        options.onStep?.({ type: "final", content: conclusion });
        return { conclusion, iterations, tokensIn, tokensOut, context: workingContext, rawFinal };
      }

      const tool = this.tools.get(step.action.tool);
      if (!tool) {
        messages.push({
          role: "assistant",
          content: JSON.stringify(step),
        });
        messages.push({
          role: "user",
          content: `工具 "${step.action.tool}" 不存在。可用: ${[...this.tools.keys()].join(", ")}。请修正。`,
        });
        continue;
      }

      options.onStep?.({ type: "tool", content: step.thought, toolName: step.action.tool });
      const input = (step.action.input ?? {}) as Record<string, unknown>;
      const result = await tool.execute(input);
      options.onStep?.({ type: "observe", content: result, toolName: step.action.tool });
      messages.push({ role: "assistant", content: JSON.stringify(step) });
      messages.push({ role: "user", content: `工具 ${step.action.tool} 输出:\n${result.slice(0, 8000)}` });
    }

    throw new Error(`ReAct 循环超过最大迭代次数 ${maxIter}`);
  }
}
