/**
 * 攻击链生成命令
 * xuanwo chain <file> [--module <m>] [--from-report <path>]
 */
import { AgentRuntime, renderChain, chainOneLine, type ChainBuildInput } from "@xuanwo/core";
import { readFileSync, existsSync } from "node:fs";

export async function runChainCommand(file: string, opts: { module?: string; fromReport?: string }) {
  const runtime = await AgentRuntime.create();

  let input: ChainBuildInput;
  if (opts.fromReport) {
    // 从 scan 报告 JSON 读取（报告保存的是 renderReport 的 markdown，这里从会话或临时文件）
    if (!existsSync(opts.fromReport)) {
      console.error(`报告不存在: ${opts.fromReport}`);
      process.exit(1);
    }
    const raw = readFileSync(opts.fromReport, "utf8");
    try {
      const data = JSON.parse(raw);
      input = {
        targetModule: opts.module ?? data.target ?? "",
        targetFile: file,
        suspiciousPoints: data.suspiciousPoints ?? [],
        intel: data.intel ?? [],
      };
    } catch {
      console.error("报告不是有效 JSON（目前 chain 需要结构化数据，请用 --module 直接指定）");
      process.exit(1);
    }
  } else {
    // 直接对文件跑一次 analyze 拿可疑点
    if (!runtime.config.isAuthorized(file)) {
      console.error(`❌ 路径未授权: ${file}`);
      process.exit(1);
    }
    console.log(`分析 ${file} 并构建攻击链...`);
    const { context } = await runtime.runTask(
      `对文件 ${file} 进行 0day 漏洞挖掘，输出所有 suspiciousPoints（含证据）和审计情报`,
      { targetFile: file }
    );
    input = {
      targetModule: opts.module ?? "",
      targetFile: file,
      suspiciousPoints: context.suspiciousPoints,
      intel: context.intel,
    };
  }

  console.log(`输入: ${input.suspiciousPoints.length} 个可疑点, ${input.intel.length} 条情报\n`);
  const chain = await runtime.buildChain(input);

  console.log("===== 攻击链 =====");
  console.log(renderChain(chain));
  console.log(`\n${chainOneLine(chain)}`);

  // 保存 JSON
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = join(homedir(), ".xuanwo", "chains");
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const out = join(dir, `chain-${ts}.json`);
  writeFileSync(out, JSON.stringify(chain, null, 2), "utf8");
  console.log(`\n📄 攻击链已保存: ${out}`);
}
