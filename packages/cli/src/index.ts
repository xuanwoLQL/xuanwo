import { Command } from "commander";
import { ConfigManager, runSetup, DISCLAIMER } from "@xuanwo/core";
import { runAgentCommand } from "./commands/agent.js";
import { runKnowledgeCommand } from "./commands/knowledge.js";
import { runSessionCommand, runResumeCommand } from "./commands/session.js";
import { runTui } from "./ui/index.js";

const program = new Command();

program
  .name("xuanwo")
  .description("OpenHarmony AI 漏洞挖掘命令行工具")
  .version("0.1.0");

program
  .command("agent <args...>")
  .description("运行智能体: xuanwo agent <agent-id> \"任务\" 或 xuanwo agent list")
  .option("--max-steps <n>", "最大 ReAct 迭代数")
  .action(async (args, opts) => {
    const cfg = new ConfigManager();
    if (!cfg.requireAccepted()) {
      console.log("❌ 尚未接受免责声明。请先运行: xuanwo setup");
      process.exit(1);
    }
    await runAgentCommand(args, opts);
  });

program
  .command("setup")
  .description("首次设置向导（免责声明 + API Key + 默认模型 + 授权目录）")
  .action(async () => {
    const result = await runSetup();
    if (!result.accepted) {
      console.log("未接受免责声明，退出。");
      process.exit(1);
    }
    console.log(`提供商: ${result.provider}\n默认模型: ${result.model}`);
    if (result.baseUrl) console.log(`Base URL: ${result.baseUrl}`);
    console.log(`授权目录: ${result.authorizedPaths.length ? result.authorizedPaths.join(", ") : "（无，可后续添加）"}`);
  });

program
  .command("config")
  .description("查看或编辑配置（授权路径 / 免责声明）")
  .option("--show", "显示当前配置")
  .option("--authorize <path>", "添加授权目录")
  .option("--accept", "确认接受免责声明")
  .option("--check <path>", "检查路径是否已授权")
  .action(async (opts) => {
    const cfg = new ConfigManager();
    if (opts.accept) {
      cfg.setAccepted();
      console.log("已确认接受免责声明。");
    }
    if (opts.authorize) {
      cfg.addAuthorizedPath(opts.authorize);
      console.log(`已添加授权目录: ${opts.authorize}`);
    }
    if (opts.check) {
      const ok = cfg.isAuthorized(opts.check);
      console.log(`路径 "${opts.check}" ${ok ? "已授权 ✅" : "未授权 ❌"}`);
    }
    if (opts.show || (!opts.accept && !opts.authorize && !opts.check)) {
      console.log(JSON.stringify(cfg.get(), null, 2));
    }
  });

program
  .command("knowledge")
  .description("知识库管理")
  .option("--update --log <path>", "从日志重新解析并合并模式")
  .option("--list", "列出已加载模式")
  .option("--search <query>", "全文检索模式")
  .option("--module <path>", "按模块过滤（配合 --search）")
  .option("--stats", "知识库统计")
  .action(async (opts) => {
    if (opts.log) {
      console.log(`知识库更新: 请运行 scripts/extract-knowledge.js (log=${opts.log})`);
      return;
    }
    await runKnowledgeCommand(opts);
  });

program
  .command("scan <path>")
  .description("启动源码扫描")
  .action((path) => {
    const cfg = new ConfigManager();
    if (!cfg.requireAccepted()) {
      console.log("❌ 尚未接受免责声明。请先运行: xuanwo setup");
      process.exit(1);
    }
    if (!cfg.isAuthorized(path)) {
      console.log(`❌ 路径未授权: ${path}`);
      console.log(`   请运行: xuanwo config --authorize "${path}"`);
      console.log("   或设置环境变量 XUANWO_AUTHORIZED_TARGET");
      process.exit(1);
    }
    console.log(`扫描功能将在阶段六提供 (${path})`);
  });

program
  .command("resume <session-id>")
  .description("恢复历史会话（断点续扫）")
  .action((sessionId) => {
    runResumeCommand(sessionId);
  });

program
  .command("session <action> [id]")
  .description("会话管理: list | save <id> | load <id>")
  .action((action, id) => {
    runSessionCommand(action, id);
  });

program
  .command("tui")
  .description("启动交互式 TUI（/scan /analyze /nday /knowledge 等）")
  .action(async () => {
    const cfg = new ConfigManager();
    if (!cfg.requireAccepted()) {
      console.log("❌ 尚未接受免责声明。请先运行: xuanwo setup");
      process.exit(1);
    }
    await runTui();
  });

program.parse();
