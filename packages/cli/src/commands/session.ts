import { SessionManager } from "@xuanwo/core";

/**
 * 会话管理命令
 * xuanwo session list
 * xuanwo session save <id>
 * xuanwo session load <id>
 * xuanwo resume <id>
 */
export async function runSessionCommand(action: string, arg?: string) {
  const mgr = new SessionManager();

  switch (action) {
    case "list": {
      const list = mgr.list();
      if (list.length === 0) {
        console.log("暂无会话");
        return;
      }
      console.log(`会话列表 (${list.length}):`);
      list.forEach((s) => {
        console.log(`  ${s.id} — ${s.title} (${s.updatedAt})`);
      });
      return;
    }
    case "save": {
      if (!arg) {
        console.error("用法: xuanwo session save <id>");
        process.exit(1);
      }
      const s = mgr.load(arg);
      if (!s) {
        console.error(`会话不存在: ${arg}`);
        process.exit(1);
      }
      const file = mgr.save(s);
      console.log(`已保存会话 ${arg} → ${file}`);
      return;
    }
    case "load": {
      if (!arg) {
        console.error("用法: xuanwo session load <id>");
        process.exit(1);
      }
      const s = mgr.load(arg);
      if (!s) {
        console.error(`会话不存在: ${arg}`);
        process.exit(1);
      }
      console.log(`会话: ${s.title}`);
      console.log(`智能体: ${s.agentId}`);
      console.log(`消息数: ${s.messages.length}`);
      console.log(`可疑点: ${s.context.suspiciousPoints.length}`);
      console.log(`已分析文件: ${s.analyzedFiles.length}`);
      if (s.context.suspiciousPoints.length > 0) {
        console.log("\n已发现可疑点:");
        s.context.suspiciousPoints.forEach((p, i) => {
          console.log(`  ${i + 1}. [${p.type}] ${p.location} (conf=${p.confidence})`);
        });
      }
      return;
    }
    default:
      console.error("用法: xuanwo session <list|save|load> [id]");
      process.exit(1);
  }
}

/** 恢复会话：打印上下文摘要，提示可用断点续扫 */
export async function runResumeCommand(sessionId: string) {
  const mgr = new SessionManager();
  const s = mgr.load(sessionId);
  if (!s) {
    console.error(`会话不存在: ${sessionId}. 可用: xuanwo session list`);
    process.exit(1);
  }
  console.log(`恢复会话: ${s.title}`);
  console.log(`智能体: ${s.agentId} | 创建: ${s.createdAt}`);
  console.log(`已分析文件 (${s.analyzedFiles.length}):`);
  s.analyzedFiles.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  console.log(`\n可疑点 (${s.context.suspiciousPoints.length}):`);
  s.context.suspiciousPoints.forEach((p, i) => {
    console.log(`  ${i + 1}. [${p.type}] ${p.location} conf=${p.confidence}`);
    console.log(`     ${p.description}`);
  });
  console.log(`\n分析链: ${s.context.analysisStack.join(" → ") || "空"}`);
  console.log(`\n断点续扫: 可继续执行 xuanwo agent ${s.agentId} "<新任务>" 携带上述上下文`);
}
