/**
 * 验证闭环命令
 * xuanwo verify <file> [--type <类型>] [--all]
 */
import { AgentRuntime, summarizeVerification, type VerificationInput } from "@xuanwo/core";

export async function runVerifyCommand(file: string, opts: { type?: string; all?: boolean }) {
  const runtime = await AgentRuntime.create();
  if (!runtime.config.isAuthorized(file)) {
    console.error(`❌ 路径未授权: ${file}`);
    process.exit(1);
  }

  console.log(`分析 ${file} 并验证可疑点...\n`);
  const { context } = await runtime.runTask(
    `对文件 ${file} 进行深度漏洞分析，输出所有 suspiciousPoints（必须带 evidence: codeSnippet/callChain/triggerCondition）`,
    { targetFile: file },
    (step) => {
      if (step.type === "tool") process.stdout.write(`  🛠 ${String(step.content).slice(0, 60)}...\n`);
    }
  );

  let points = context.suspiciousPoints;
  if (opts.type) {
    points = points.filter((p) => p.type === opts.type);
  }
  if (points.length === 0) {
    console.log("未发现可疑点（或类型不匹配）。");
    return;
  }

  console.log(`\n发现 ${points.length} 个可疑点，开始验证...\n`);
  const inputs: VerificationInput[] = points.map((p) => ({
    file,
    location: p.location,
    type: p.type,
    description: p.description,
    codeSnippet: p.evidence?.codeSnippet,
    callChain: p.evidence?.callChain,
    triggerCondition: p.evidence?.triggerCondition,
  }));

  const results = await runtime.verifyFindings(inputs, {
    onLog: (msg) => console.log(`  ${msg}`),
  });

  console.log(`\n${summarizeVerification(results)}`);

  // 保存复现程序（已确认的）
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = join(homedir(), ".xuanwo", "pocs");
  mkdirSync(dir, { recursive: true });
  results.forEach((r, i) => {
    if (r.status === "verified" && r.reproCode) {
      const name = `poc_${i + 1}_${r.point.type}.cpp`;
      writeFileSync(join(dir, name), r.reproCode, "utf8");
      console.log(`📄 已保存 PoC: ${join(dir, name)}`);
    }
  });
}
