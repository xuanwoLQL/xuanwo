/**
 * 跨函数污点追踪器（借鉴 IVAgent 调用链深度 3-5 层策略）
 * 
 * 从污点预扫描的候选点出发，用 LLM 驱动跨函数追踪：
 * 1. 读取当前函数代码，识别污点变量如何传播
 * 2. 若污点传入被调用函数 → 用 find_function_def 定位该函数，继续追踪
 * 3. 若污点来自调用方 → 用 find_callers 找调用者，向上追踪
 * 4. 深度限制（默认 4 层），循环检测
 * 
 * 输出：完整污点调用链（source → ... → sink）
 */
import type { LlmClient } from "../llm/client.js";
import type { AgentTool } from "../agent/react.js";

/** 近似 token 估算（字符/4，用于工具输入统计） */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface TaintTraceStep {
  depth: number;
  function: string;
  file: string;
  /** 当前追踪的污点变量 */
  taintedVars: string[];
  /** 本层分析（LLM 输出） */
  analysis: string;
  /** 污点是否继续传播 */
  continues: boolean;
  /** 下一跳：被调用函数 or 调用者 or null(到汇点/终止) */
  next?: { type: "callee" | "caller"; func: string } | null;
  /** 是否到达危险汇点 */
  reachedSink: boolean;
  sinkDetail?: string;
}

export interface TaintTraceResult {
  path: string[]; // 函数调用链
  steps: TaintTraceStep[];
  reachedSink: boolean;
  sinkDetail?: string;
  summary: string;
  tokensIn: number;
  tokensOut: number;
}

export interface TaintTracerOptions {
  maxDepth?: number; // 默认 4（IVAgent 建议 3-5）
  maxIterations?: number;
  onStep?: (step: TaintTraceStep) => void;
}

const TRACE_SYSTEM = `你是一个跨函数污点分析器。你的任务是从一个函数出发，追踪污点数据（外部不可信输入）如何跨函数传播，最终是否到达危险操作（sink）。
每次给你一段函数代码和当前污点变量，你需要分析并输出 JSON：
{
  "analysis": "本层分析：污点如何进入/传播/离开本函数",
  "continues": true/false,          // 污点是否继续传播
  "next": {"type":"callee","func":"被调用函数名"} 或 {"type":"caller","func":"调用者函数名"} 或 null,
  "reachedSink": true/false,        // 是否到达危险操作（memcpy/strcpy/权限判断等）
  "sinkDetail": "到达汇点的具体描述（如 memcpy(dst, tainted, len) 未校验长度）"
}
规则：
- callee：本函数将污点变量作为参数传入某个被调用函数，继续追踪该函数
- caller：本函数是入口/被外部调用，且污点可能从调用方传入，向上追踪调用者
- reachedSink=true 时 next=null（追踪结束）
- 只输出 JSON，不要其他文字`;

/** 从工具结果中提取代码块（read 工具输出） */
function extractCode(toolOutput: string): string {
  return toolOutput.slice(0, 8000);
}

export class TaintTracer {
  constructor(
    private llm: LlmClient,
    private tools: Map<string, AgentTool>,
    private options: TaintTracerOptions = {}
  ) {}

  private async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `工具 ${name} 不存在`;
    return tool.execute(args);
  }

  /**
   * 从起点追踪污点
   * @param startFunction 起始函数
   * @param startFile 起始文件
   * @param taintedVars 起始污点变量
   * @param sinkHint 期望到达的汇点提示
   */
  async trace(
    startFunction: string,
    startFile: string,
    taintedVars: string[],
    sinkHint?: string
  ): Promise<TaintTraceResult> {
    const maxDepth = this.options.maxDepth ?? 4;
    const steps: TaintTraceStep[] = [];
    const path: string[] = [];
    const visited = new Set<string>();
    let tokensIn = 0;
    let tokensOut = 0;
    let curFunc = startFunction;
    let curFile = startFile;
    let curVars = taintedVars;

    for (let depth = 0; depth < maxDepth; depth++) {
      const visitKey = `${curFunc}@${curFile}`;
      if (visited.has(visitKey)) {
        // 循环检测：在已有链上，说明追踪循环，停止
        steps.push({
          depth,
          function: curFunc,
          file: curFile,
          taintedVars: curVars,
          analysis: "检测到循环调用，停止追踪",
          continues: false,
          next: null,
          reachedSink: false,
        });
        break;
      }
      visited.add(visitKey);
      path.push(curFunc);

      // 读取当前函数所在文件
      const fileContent = await this.callTool("read", { path: curFile });
      tokensIn += approxTokens(fileContent);

      // 用 LLM 分析当前层的污点传播
      const userPrompt = `当前文件: ${curFile}
需要追踪的函数: ${curFunc}
当前污点变量: ${curVars.join(", ")}
${sinkHint ? `期望汇点: ${sinkHint}` : ""}

文件内容:
${extractCode(fileContent)}

请分析污点在函数 ${curFunc} 中的传播。若污点传入被调用函数，用 find_function_def 需先告诉我函数名；若需要找调用者用 find_callers。`;

      const resp = await this.llm.chat(
        [
          { role: "system", content: TRACE_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        { jsonMode: true, temperature: 0.2 }
      );
      tokensIn += resp.tokensIn;
      tokensOut += resp.tokensOut;

      let parsed: {
        analysis: string;
        continues: boolean;
        next?: { type: "callee" | "caller"; func: string } | null;
        reachedSink: boolean;
        sinkDetail?: string;
      };
      try {
        parsed = JSON.parse(resp.content) as typeof parsed;
      } catch {
        // 解析失败，尝试宽松提取
        const m = resp.content.match(/\{[\s\S]*\}/);
        parsed = m ? (JSON.parse(m[0]) as typeof parsed) : { analysis: "解析失败", continues: false, next: null, reachedSink: false };
      }

      const step: TaintTraceStep = {
        depth,
        function: curFunc,
        file: curFile,
        taintedVars: curVars,
        analysis: parsed.analysis ?? "",
        continues: Boolean(parsed.continues),
        next: parsed.next ?? null,
        reachedSink: Boolean(parsed.reachedSink),
        sinkDetail: parsed.sinkDetail,
      };
      steps.push(step);
      this.options.onStep?.(step);

      if (parsed.reachedSink || !parsed.continues || !parsed.next) {
        // 到达汇点或追踪终止
        return {
          path,
          steps,
          reachedSink: Boolean(parsed.reachedSink),
          sinkDetail: parsed.sinkDetail,
          summary: this.buildSummary(steps),
          tokensIn,
          tokensOut,
        };
      }

      // 跨函数跳转
      if (parsed.next.type === "callee") {
        // 定位被调用函数定义
        const def = await this.callTool("find_function_def", { func: parsed.next.func, path: curFile });
        tokensIn += approxTokens(def);
        // 从 def 结果提取文件路径
        const defFile = extractFileFromResult(def) ?? curFile;
        curFunc = parsed.next.func;
        curFile = defFile;
        // 污点变量：传给被调用函数的参数（简化为函数名，LLM 会再分析）
        curVars = [parsed.next.func + " 参数"];
      } else if (parsed.next.type === "caller") {
        // 找调用者
        const callers = await this.callTool("find_callers", { func: curFunc, path: curFile });
        tokensIn += approxTokens(callers);
        const callerFile = extractFileFromResult(callers) ?? curFile;
        curFunc = parsed.next.func;
        curFile = callerFile;
        curVars = [...curVars, "（来自调用方）"];
      }
    }

    return {
      path,
      steps,
      reachedSink: steps.some((s) => s.reachedSink),
      sinkDetail: steps.find((s) => s.reachedSink)?.sinkDetail,
      summary: this.buildSummary(steps),
      tokensIn,
      tokensOut,
    };
  }

  private buildSummary(steps: TaintTraceStep[]): string {
    const chain = steps.map((s) => s.function).join(" → ");
    const sink = steps.find((s) => s.reachedSink);
    if (sink) {
      return `污点追踪到汇点: ${chain} → [SINK] ${sink.sinkDetail ?? ""}`;
    }
    return `污点追踪未达汇点: ${chain}${steps.length > 0 ? "（" + steps[steps.length - 1].analysis.slice(0, 80) + "）" : ""}`;
  }
}

/** 从 find_function_def/find_callers 结果提取文件路径 */
function extractFileFromResult(result: string): string | null {
  // 匹配 file:line 或 file(line) 格式
  const m = result.match(/([A-Za-z0-9_/\\\-.]+\.[ch]pp?):\d+/);
  if (m) return m[1].replace(/\\/g, "/");
  const m2 = result.match(/([A-Za-z0-9_/\\\-.]+\.[ch]pp?)\(\d+/);
  if (m2) return m2[1].replace(/\\/g, "/");
  return null;
}
