import { AgentRuntime } from "@xuanwo/core";

/**
 * agent 命令：运行指定智能体执行任务
 * xuanwo agent <agent-id> <task>
 * xuanwo agent list
 */
export async function runAgentCommand(args: string[], opts: { maxSteps?: string } = {}) {
  const runtime = await AgentRuntime.create();

  if (args[0] === "list") {
    console.log("可用智能体：");
    runtime.availableAgents().forEach((a) => {
      console.log(`  ${a.id} — ${a.name}（${a.role}）`);
      console.log(`      ${a.description}`);
    });
    return;
  }

  const agentId = args[0];
  const task = args.slice(1).join(" ");
  if (!agentId || !task) {
    console.error("用法: xuanwo agent <agent-id> \"任务描述\"  或  xuanwo agent list");
    process.exit(1);
  }
  if (!runtime.availableAgents().some((a) => a.id === agentId)) {
    console.error(`❌ 智能体不存在: ${agentId}`);
    console.error("可用: " + runtime.availableAgents().map((a) => a.id).join(", "));
    process.exit(1);
  }

  console.log(`[agent] 目标: ${agentId}`);
  console.log(`[agent] 任务: ${task}`);
  console.log(`[agent] 知识库模式数: ${runtime.knowledge.size}\n`);

  try {
    const { conclusion, context } = await runtime.runTask(task, {}, (step) => {
      const mark =
        step.type === "think" ? "🧠" : step.type === "tool" ? "🛠" : step.type === "observe" ? "👀" : "✅";
      console.log(`  ${mark} [${step.agentId}] ${step.type}: ${String(step.content).slice(0, 500)}`);
    });

    console.log("\n===== 结论 =====");
    console.log(conclusion);
    console.log("\n===== 可疑点 =====");
    if (context.suspiciousPoints.length === 0) {
      console.log("  （无）");
    }
    context.suspiciousPoints.forEach((p, i) => {
      console.log(`  ${i + 1}. [${p.type}] ${p.location} (置信度 ${p.confidence})`);
      console.log(`     ${p.description}`);
    });
  } catch (e) {
    console.error(`\n❌ 执行失败: ${(e as Error).message}`);
    process.exit(1);
  }
}
