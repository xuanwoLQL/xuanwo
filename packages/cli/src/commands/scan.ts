import { AgentRuntime, runScan, renderReport, collectSourceFiles, quickRiskScan } from "@xuanwo/core";
import { join } from "node:path";
import { homedir } from "node:os";
import { writeFileSync, mkdirSync } from "node:fs";

function reportDir(): string {
  return join(homedir(), ".xuanwo", "reports");
}

/** 进度条渲染 */
function renderProgress(p: { totalFiles: number; analyzed: number; currentFile?: string }): string {
  const pct = p.totalFiles ? Math.round((p.analyzed / p.totalFiles) * 100) : 0;
  const bar = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));
  return `[${bar}] ${pct}% (${p.analyzed}/${p.totalFiles}) ${p.currentFile ?? ""}`;
}

/** xuanwo scan <path> */
export async function runScanCommand(path: string, opts: { maxFiles?: string; concurrency?: string; report?: boolean }) {
  const runtime = await AgentRuntime.create();

  if (!runtime.config.isAuthorized(path)) {
    console.error(`❌ 路径未授权: ${path}`);
    console.error(`   请运行: xuanwo config --authorize "${path}"`);
    process.exit(1);
  }

  console.log(`开始扫描: ${path}`);
  console.log(`知识库模式: ${runtime.knowledge.size} 条\n`);

  const maxFiles = Number(opts.maxFiles ?? 10);
  const concurrency = Number(opts.concurrency ?? 3);

  // 先展示文件发现
  const allFiles = collectSourceFiles(path);
  console.log(`发现源码文件: ${allFiles.length} 个`);
  const riskMap = quickRiskScan(allFiles);
  console.log(`高风险特征文件: ${riskMap.size} 个\n`);

  const report = await runScan(
    runtime,
    path,
    { maxFiles, concurrency },
    (p) => {
      process.stdout.write(`\r${renderProgress(p)}   `);
    },
    runtime.skills.toTaintRules()
  );
  process.stdout.write("\n");

  console.log(`\n${report.summary}`);
  if (report.intel.length > 0) {
    console.log("\n===== 审计情报 =====");
    report.intel.slice(0, 10).forEach((i) => {
      console.log(`  [${i.kind}/${i.severity}] ${i.target}: ${i.detail.slice(0, 100)}`);
    });
  }
  console.log("\n===== 可疑点 =====");
  if (report.suspiciousPoints.length === 0) {
    console.log("  未发现可疑点");
  }
  report.suspiciousPoints.forEach((p, i) => {
    console.log(`  ${i + 1}. [${p.type}] ${p.location} (conf=${p.confidence})`);
    console.log(`     ${p.description.slice(0, 150)}`);
    if (p.evidence?.callChain?.length) {
      console.log(`     调用链: ${p.evidence.callChain.join(" → ")}`);
    }
    if (p.evidence?.triggerCondition) {
      console.log(`     触发: ${p.evidence.triggerCondition.slice(0, 100)}`);
    }
  });

  if (opts.report || report.suspiciousPoints.length > 0) {
    const dir = reportDir();
    mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(dir, `scan-${ts}.md`);
    writeFileSync(file, renderReport(report), "utf8");
    console.log(`\n📄 报告已保存: ${file}`);
  }
}

/** xuanwo analyze <file> */
export async function runAnalyzeCommand(file: string) {
  const runtime = await AgentRuntime.create();
  if (!runtime.config.isAuthorized(file)) {
    console.error(`❌ 路径未授权: ${file}`);
    process.exit(1);
  }
  console.log(`深度分析: ${file}`);
  try {
    const { conclusion, context } = await runtime.runTask(
      `深度分析文件 ${file} 的所有安全风险，结合知识库 Nday 模式，输出 suspiciousPoints 与修复建议`,
      { targetFile: file },
      (step) => {
        if (step.type === "tool") process.stdout.write(`  🛠 ${String(step.content).slice(0, 80)}...\n`);
      },
      { maxIterations: 15 }
    );
    console.log("\n===== 结论 =====");
    console.log(conclusion);
    console.log("\n===== 可疑点 =====");
    context.suspiciousPoints.forEach((p, i) => {
      console.log(`  ${i + 1}. [${p.type}] ${p.location} (conf=${p.confidence})`);
      console.log(`     ${p.description}`);
      if (p.evidence?.callChain?.length) {
        console.log(`     调用链: ${p.evidence.callChain.join(" → ")}`);
      }
      if (p.evidence?.triggerCondition) {
        console.log(`     触发: ${p.evidence.triggerCondition.slice(0, 120)}`);
      }
    });
  } catch (e) {
    console.error(`\n❌ 分析失败: ${(e as Error).message}`);
    process.exit(1);
  }
}

/** xuanwo report <scan-report-file> */
export async function runReportCommand(file?: string) {
  if (file) {
    const { readFileSync, existsSync } = await import("node:fs");
    if (!existsSync(file)) {
      console.error(`报告不存在: ${file}`);
      process.exit(1);
    }
    console.log(readFileSync(file, "utf8"));
    return;
  }
  console.log("用法: xuanwo report <报告文件>  或查看 ~/.xuanwo/reports/");
  const { readdirSync } = await import("node:fs");
  const dir = reportDir();
  try {
    const files = readdirSync(dir);
    if (files.length === 0) {
      console.log("暂无报告。运行 xuanwo scan <path> 生成。");
    } else {
      console.log("已有报告:");
      files.forEach((f) => console.log(`  ${join(dir, f)}`));
    }
  } catch {
    console.log("暂无报告目录。");
  }
}
