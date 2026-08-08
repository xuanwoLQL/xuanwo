/**
 * 验证闭环（借鉴 AutoYara 验证模块 + IVAgent 证据要求）
 * 
 * 对可疑点生成最小复现程序，用 WSL gcc + ASAN 编译运行，
 * 检测是否真正崩溃（区分真漏洞 vs 误报）。
 * 
 * 流程：
 * 1. 输入可疑点的触发代码 + 污点输入描述
 * 2. LLM 生成最小可复现 C 程序
 * 3. WSL gcc -fsanitize=address 编译
 * 4. 运行，解析 ASAN 崩溃
 */
import type { LlmClient } from "../llm/client.js";
import { wslExec } from "../tools/wsl.js";

export interface VerificationInput {
  file: string;
  location: string;
  type: string;
  description: string;
  codeSnippet?: string;
  callChain?: string[];
  triggerCondition?: string;
}

export interface VerificationResult {
  point: VerificationInput;
  status: "verified" | "failed" | "no-crash" | "compile-error" | "skipped";
  /** ASAN 崩溃详情 */
  crashDetail?: string;
  /** 复现程序源码 */
  reproCode?: string;
  output?: string;
}

const VERIFY_SYSTEM = `你是一个漏洞复现专家。给定一个可疑漏洞的描述和代码片段，生成一个最小的 C/C++ 程序来验证该漏洞是否能被触发。

要求：
1. 程序必须自包含（单文件，main 函数）
2. 包含触发漏洞的关键代码（复制原始可疑代码，或构造最小复现）
3. 用恶意/越界输入触发漏洞
4. 输出必须是合法 C/C++ 代码，不要其他文字

规则：
- 只生成能触发所述漏洞类型的代码，不添加无关逻辑
- 如果代码片段是 C++（有 class/napi 等），用 C++ 并包含必要头文件
- 对于 NAPI 类漏洞：用纯 C/C++ 模拟其不安全操作（如未校验长度直接 strcpy）
- 程序应能被 gcc/g++ 编译（g++ 用于 C++）`;

const VERIFY_USER = `## 目标漏洞
- 文件: {file}
- 位置: {location}
- 类型: {type}
- 描述: {description}
- 调用链: {chain}
- 触发条件: {trigger}

## 关键代码
\`\`\`
{code}
\`\`\`

请生成最小复现程序（gcc/g++ 可编译），用能触发漏洞的输入调用它。只输出代码。`;

/** 用 LLM 生成复现程序 */
async function generateRepro(llm: LlmClient, input: VerificationInput): Promise<string> {
  const user = VERIFY_USER
    .replace("{file}", input.file)
    .replace("{location}", input.location)
    .replace("{type}", input.type)
    .replace("{description}", input.description.slice(0, 500))
    .replace("{chain}", (input.callChain ?? []).join(" → ") || "N/A")
    .replace("{trigger}", input.triggerCondition ?? "N/A")
    .replace("{code}", (input.codeSnippet ?? "// 无代码片段，请基于描述构造").slice(0, 1500));

  const resp = await llm.chat(
    [
      { role: "system", content: VERIFY_SYSTEM },
      { role: "user", content: user },
    ],
    { temperature: 0.2, maxTokens: 2000 }
  );

  // 提取代码（去掉 markdown 围栏）
  let code = resp.content.trim();
  code = code.replace(/^```(?:c|cpp|cc)?\s*/i, "").replace(/\s*```$/, "").trim();
  return code;
}

/** WSL 编译 + 运行 + 检测 ASAN */
async function compileAndRun(code: string): Promise<{ crash: boolean; detail?: string; output: string; compileError?: string }> {
  // 写入临时文件
  wslExec(`mkdir -p /tmp/xuanwo-verify && cat > /tmp/xuanwo-verify/repro.cpp << 'REPROEOF'\n${code}\nREPROEOF`);

  // 编译（先试 g++，失败试 gcc）
  const compile = wslExec(`cd /tmp/xuanwo-verify && g++ -fsanitize=address -g -O0 -o repro repro.cpp 2>&1`);
  if (compile.includes("error:")) {
    // 尝试 gcc
    const compile2 = wslExec(`cd /tmp/xuanwo-verify && gcc -fsanitize=address -g -O0 -o repro repro.cpp 2>&1`);
    if (compile2.includes("error:")) {
      return { crash: false, output: "", compileError: compile2.slice(0, 500) };
    }
  }

  // 运行（ASAN 崩溃时返回非零 + 报告）
  const run = wslExec(`cd /tmp/xuanwo-verify && timeout 10 ./repro 2>&1 || true`);
  const isCrash = /ERROR: AddressSanitizer|AddressSanitizer:|heap-buffer-overflow|stack-buffer-overflow|use-after-free|SEGV|runtime error|SIGSEGV/.test(run);
  const detail = isCrash ? run.match(/ERROR: AddressSanitizer:[\s\S]{0,600}/)?.[0] ?? run.slice(0, 600) : undefined;
  return { crash: isCrash, detail, output: run.slice(0, 1000) };
}

/**
 * 验证单个可疑点
 */
export async function verifyFinding(
  llm: LlmClient,
  input: VerificationInput,
  opts: { onLog?: (msg: string) => void } = {}
): Promise<VerificationResult> {
  try {
    opts.onLog?.(`生成复现程序 (${input.location})...`);
    const reproCode = await generateRepro(llm, input);
    if (!reproCode || reproCode.length < 20) {
      return { point: input, status: "skipped", reproCode, output: "复现程序生成失败" };
    }

    opts.onLog?.("WSL 编译 + ASAN 运行...");
    const { crash, detail, output, compileError } = await compileAndRun(reproCode);

    if (compileError) {
      return { point: input, status: "compile-error", reproCode, output: compileError };
    }
    if (crash) {
      return { point: input, status: "verified", crashDetail: detail, reproCode, output };
    }
    return { point: input, status: "no-crash", reproCode, output };
  } catch (e) {
    return { point: input, status: "skipped", output: (e as Error).message };
  }
}

/** 批量验证并汇总 */
export async function verifyFindings(
  llm: LlmClient,
  points: VerificationInput[],
  opts: { onLog?: (msg: string) => void } = {}
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  for (const p of points) {
    results.push(await verifyFinding(llm, p, opts));
  }
  return results;
}

/** 汇总验证结果文本 */
export function summarizeVerification(results: VerificationResult[]): string {
  if (results.length === 0) return "无验证项";
  const verified = results.filter((r) => r.status === "verified");
  const noCrash = results.filter((r) => r.status === "no-crash");
  const compileErr = results.filter((r) => r.status === "compile-error");
  const skipped = results.filter((r) => r.status === "skipped");

  const lines: string[] = [];
  lines.push(`验证闭环结果（${results.length} 项）:`);
  lines.push(`  ✅ 确认漏洞: ${verified.length}`);
  lines.push(`  ⚪ 未触发崩溃(可能误报): ${noCrash.length}`);
  lines.push(`  ⚠ 编译失败: ${compileErr.length}`);
  lines.push(`  ⏭ 跳过: ${skipped.length}`);

  verified.forEach((v, i) => {
    lines.push(`\n【确认 ${i + 1}】${v.point.type} @ ${v.point.location}`);
    if (v.crashDetail) lines.push(`  ASAN: ${v.crashDetail.slice(0, 200)}`);
  });
  return lines.join("\n");
}
