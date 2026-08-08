import { AgentRuntime } from "@xuanwo/core";

/** xuanwo skill list | skill <id> | skill validate */
export async function runSkillCommand(args: string[]) {
  const runtime = await AgentRuntime.create();
  const action = args[0] ?? "list";

  switch (action) {
    case "list": {
      const list = runtime.skills.list();
      if (list.length === 0) {
        console.log("无可用技能");
        return;
      }
      console.log(`技能清单 (${list.length}):`);
      list.forEach((s) => {
        console.log(`  ${s.id} — ${s.name}`);
        console.log(`      ${s.description}`);
        console.log(`      声明工具: ${s.tools.join(", ") || "无"}`);
      });
      const rejected = runtime.skills.getRejected();
      if (rejected.length > 0) {
        console.log(`\n⚠️ 被拒绝的技能 (${rejected.length}):`);
        rejected.forEach((r) => console.log(`  ${r.file}: ${r.reason}`));
      }
      return;
    }
    case "validate": {
      const ok = runtime.skills.list().every((s) =>
        s.tools.every((t) => ["grep", "git", "read"].includes(t))
      );
      console.log(`技能工具白名单校验: ${ok ? "PASS ✅" : "FAIL ❌"}`);
      return;
    }
    default: {
      // 查看技能详情
      const skill = runtime.skills.get(action);
      if (!skill) {
        console.error(`技能不存在: ${action}`);
        console.error("可用: " + runtime.skills.list().map((s) => s.id).join(", "));
        process.exit(1);
      }
      console.log(`# ${skill.name} (${skill.id})\n`);
      console.log(skill.body);
    }
  }
}
