/**
 * 编程模式命令
 * xuanwo code <task> — 用编程智能体(coder)处理任务
 * xuanwo code --explore <task> — 用 explorer 探索
 */
import { AgentRuntime } from "@xuanwo/core";

export async function runCodeCommand(args: string[], opts: { explore?: boolean } = {}) {
  const runtime = await AgentRuntime.create();
  const agentId = opts.explore ? "explorer" : "coder";
  const task = args.join(" ");

  if (!task) {
    console.error("用法: xuanwo code <任务描述>   或  xuanwo code --explore <探索任务>");
    process.exit(1);
  }
  if (!runtime.availableAgents().some((a) => a.id === agentId)) {
    console.error(`❌ 智能体不存在: ${agentId}`);
    process.exit(1);
  }

  console.log(`[编程模式] 智能体: ${agentId}`);
  console.log(`[编程模式] 任务: ${task}\n`);

  try {
    const result = await runtime.runAgent(agentId, task, {}, (step) => {
      if (step.type === "tool") {
        console.log(`  🛠 ${step.agentId}: ${String(step.content).slice(0, 60)}...`);
      }
    });
    console.log("\n===== 结果 =====");
    console.log(result.conclusion);
  } catch (e) {
    console.error(`\n❌ 执行失败: ${(e as Error).message}`);
    process.exit(1);
  }
}
