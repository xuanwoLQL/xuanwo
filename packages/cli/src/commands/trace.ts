/**
 * 跨函数污点追踪命令
 * xuanwo trace <file> <func> [--var <污点变量>] [--sink <汇点提示>] [--depth <n>]
 */
import { AgentRuntime } from "@xuanwo/core";

export async function runTraceCommand(
  file: string,
  func: string,
  opts: { var?: string; sink?: string; depth?: string }
) {
  const runtime = await AgentRuntime.create();
  if (!runtime.config.isAuthorized(file)) {
    console.error(`❌ 路径未授权: ${file}`);
    console.error(`   请运行: xuanwo config --authorize "${file}"`);
    process.exit(1);
  }

  const taintedVars = opts.var ? opts.var.split(",").map((s) => s.trim()).filter(Boolean) : ["外部输入"];
  const sinkHint = opts.sink;
  const depth = opts.depth ? Number(opts.depth) : undefined;

  console.log(`跨函数污点追踪:`);
  console.log(`  起点函数: ${func}`);
  console.log(`  文件: ${file}`);
  console.log(`  污点变量: ${taintedVars.join(", ")}`);
  console.log(`  ${sinkHint ? `期望汇点: ${sinkHint}` : ""}`);
  console.log(`  最大深度: ${depth ?? 4}\n`);

  try {
    const result = await runtime.traceTaint(
      func,
      file,
      taintedVars,
      sinkHint,
      {
        maxDepth: depth,
        onStep: (s) => {
          const mark = s.reachedSink ? "🔴" : s.continues ? "🔵" : "⚪";
          console.log(`  ${mark} [深度${s.depth}] ${s.function} (${s.file})`);
          console.log(`       ${s.analysis.slice(0, 150)}`);
          if (s.reachedSink) console.log(`       ⚠ SINK: ${s.sinkDetail ?? ""}`);
        },
      }
    );

    console.log(`\n===== 污点追踪结果 =====`);
    console.log(result.summary);
    console.log(`调用链: ${result.path.join(" → ") || "无"}`);
    console.log(`到达汇点: ${result.reachedSink ? "是 ✅" : "否"}`);
    if (result.reachedSink) {
      console.log(`汇点详情: ${result.sinkDetail}`);
      console.log(`\n⚠️  污点到达危险操作，建议人工复核并检查是否需要深度审计。`);
    } else {
      console.log(`未到达汇点，可能是误报或需要更深的追踪。`);
    }
  } catch (e) {
    console.error(`\n❌ 追踪失败: ${(e as Error).message}`);
    process.exit(1);
  }
}
