/**
 * ReAct 循环：思考(Reason) → 行动(Act) → 观察(Observe) → 循环
 * 是每个智能体的核心执行循环。
 */
import type { LlmClient, ChatMessage, CompletionOptions } from "../llm/client.js";
import type { AgentConfig } from "./config.js";
import { dedupePoints, createEmptyContext, type AuditContext, type SuspiciousPoint } from "./audit-context.js";
import { createMethodologyTools } from "./methodology.js";

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

【重要规则】（借鉴 AutoYara 证据前置原则）
1. 不得在未读取目标文件/代码前就输出 final。必须先调用 read/grep 等工具获取真实代码证据。
2. final 中每个 suspiciousPoint 必须带证据：location(file:line)、description、confidence，
   并尽量包含 codeSnippet（关键代码片段）与 callChain（调用链）。
3. 没有代码证据支撑的结论属于猜测，confidence 不得超过 0.5。
4. 每次只调用一个工具，观察结果后再决定下一步。

final 对象格式：
{
  "conclusion": "结论文本（含漏洞分析、file:line、修复建议）",
  "dispatch": [{"agent":"子智能体id","task":"子任务描述"}],
  "suspiciousPoints": [
    {
      "location":"文件:行号",
      "type":"UAF|缓冲区溢出|权限绕过|条件竞争|整数溢出|其他",
      "description":"描述（含证据与触发条件）",
      "confidence":0-1,
      "evidence": {
        "codeSnippet":"关键代码片段",
        "callChain":["入口函数","处理函数","危险操作"],
        "triggerCondition":"触发条件",
        "severity":"critical|high|medium|low"
      }
    }
  ]
}
- dispatch 可选：主控智能体需要派发子任务时填写，子智能体填 []
- 只有拿到代码证据的可疑点才给高置信度（>0.5）`;

/**
 * 宽松 JSON 提取：从模型输出中提取第一个完整 JSON 对象。
 * 兼容模型输出包含多余文本/被截断/前后有说明文字的情况。
 */
function extractJson(text: string): unknown {
  const s = text.trim();
  // 去掉可能的 ```json 围栏
  const fenced = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(fenced);
  } catch {
    /* fallthrough */
  }
  // 查找第一个 { 到匹配的 }，处理嵌套
  const start = fenced.indexOf("{");
  if (start === -1) throw new Error("no json object");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < fenced.length; i++) {
    const c = fenced[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(fenced.slice(start, i + 1));
      }
    }
  }
  throw new Error("incomplete json");
}

export class ReActAgent {
  private toolCache = new Map<string, string>();
  private ctxRef: { current: AuditContext } = { current: createEmptyContext() };
  private tools: Map<string, AgentTool>;

  constructor(
    private llm: LlmClient,
    baseTools: Map<string, AgentTool>,
    private config: AgentConfig
  ) {
    // 将方法论工具绑定到本 agent 的 ctxRef（contextBridge）
    this.tools = new Map();
    for (const [name, tool] of baseTools) {
      if (name === "add_intel" || name === "coverage_status" || name === "record_coverage") {
        const bridge = this.contextBridge;
        // 用 createMethodologyTools 重新创建，绑定当前 ctxRef
        const bound = createMethodologyTools(bridge.getContext, bridge.setContext);
        for (const b of bound) this.tools.set(b.definition.name, b);
      } else {
        this.tools.set(name, tool);
      }
    }
  }

  /** 供方法论工具访问当前 AuditContext（contextBridge） */
  get contextBridge(): { getContext: () => AuditContext; setContext: (ctx: AuditContext) => void } {
    return {
      getContext: () => this.ctxRef.current,
      setContext: (ctx: AuditContext) => {
        this.ctxRef.current = ctx;
      },
    };
  }

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
    this.ctxRef.current = workingContext;

    while (iterations < maxIter) {
      iterations++;
      const opts: CompletionOptions = { temperature: options.temperature ?? 0.2, jsonMode: true };
      const resp = await this.llm.chat(messages, opts);
      tokensIn += resp.tokensIn;
      tokensOut += resp.tokensOut;

      let step: { thought: string; action: { tool: string; input: unknown } };
      try {
        const content = resp.content?.trim();
        if (!content) {
          // 模型返回空内容（deepseek reasoning 模型可能 content 为空）
          options.onStep?.({ type: "observe", content: "模型返回空内容，请求重试" });
          messages.push({ role: "user", content: "你上次返回了空内容。请直接输出 JSON: {\"thought\":\"...\",\"action\":{\"tool\":\"...\",\"input\":{...}}}。若已完成分析请使用 tool:\"final\"。" });
          continue;
        }
        const raw = extractJson(content);
        const parsed = raw as { thought?: string; action?: { tool?: string; input?: unknown } } | null;
        // 防御性校验：兼容模型输出缺少 action 的情况
        if (!parsed || typeof parsed !== "object" || !parsed.action?.tool) {
          options.onStep?.({ type: "observe", content: `模型输出缺少 action 字段，原始: ${content.slice(0, 300)}` });
          messages.push({ role: "user", content: `输出格式错误：缺少 action。必须输出 {"thought":"...","action":{"tool":"..."}}。请重试。` });
          continue;
        }
        step = {
          thought: parsed.thought ?? "",
          action: { tool: parsed.action.tool, input: parsed.action.input },
        };
      } catch {
        options.onStep?.({ type: "observe", content: `无法解析模型输出，重试。原始: ${resp.content?.slice(0, 200)}` });
        // 向模型反馈解析失败，帮助纠正
        messages.push({ role: "user", content: "你的输出无法解析为合法 JSON。请严格只输出一个 JSON 对象，不要包含 markdown 围栏或额外文字。" });
        continue;
      }

      options.onStep?.({ type: "think", content: step.thought });

      if (step.action.tool === "final") {
        const input = step.action.input as {
          conclusion?: unknown;
          suspiciousPoints?: {
            location: string;
            type: string;
            description: string;
            confidence: number;
            evidence?: {
              codeSnippet?: string;
              callChain?: string[];
              triggerCondition?: string;
              severity?: string;
            };
          }[];
        };
        const conclusion =
          typeof input === "string"
            ? input
            : typeof input?.conclusion === "string"
              ? input.conclusion
              : JSON.stringify(input);
        const points = Array.isArray(input?.suspiciousPoints)
          ? input.suspiciousPoints.map((p): SuspiciousPoint => {
              const ev = p.evidence;
              return {
                location: String(p.location ?? ""),
                type: String(p.type ?? "其他"),
                description: String(p.description ?? ""),
                confidence: typeof p.confidence === "number" ? p.confidence : 0.5,
                evidence: ev
                  ? {
                      codeSnippet: typeof ev.codeSnippet === "string" ? ev.codeSnippet : undefined,
                      callChain: Array.isArray(ev.callChain) ? ev.callChain.map(String) : undefined,
                      triggerCondition: typeof ev.triggerCondition === "string" ? ev.triggerCondition : undefined,
                      severity: (ev.severity as "critical" | "high" | "medium" | "low" | "informational" | undefined) ?? undefined,
                    }
                  : undefined,
              };
            })
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
      const cacheKey = `${step.action.tool}:${JSON.stringify(input)}`;
      let result: string;
      if (this.toolCache.has(cacheKey)) {
        result = this.toolCache.get(cacheKey) as string;
      } else {
        result = await tool.execute(input);
        this.toolCache.set(cacheKey, result);
        if (this.toolCache.size > 50) this.toolCache.clear();
      }
      options.onStep?.({ type: "observe", content: result, toolName: step.action.tool });
      messages.push({ role: "assistant", content: JSON.stringify(step) });
      messages.push({ role: "user", content: `工具 ${step.action.tool} 输出:\n${result.slice(0, 8000)}` });
    }

    throw new Error(`ReAct 循环超过最大迭代次数 ${maxIter}`);
  }
}
