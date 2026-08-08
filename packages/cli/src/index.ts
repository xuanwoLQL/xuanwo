import { Command } from "commander";
import { ConfigManager, runSetup, DISCLAIMER } from "@xuanwo/core";
import { runAgentCommand } from "./commands/agent.js";
import { runKnowledgeCommand } from "./commands/knowledge.js";
import { runSessionCommand, runResumeCommand } from "./commands/session.js";
import { runScanCommand, runAnalyzeCommand, runReportCommand } from "./commands/scan.js";
import { runTraceCommand } from "./commands/trace.js";
import { runChainCommand } from "./commands/chain.js";
import { runVerifyCommand } from "./commands/verify.js";
import { runSkillCommand } from "./commands/skill.js";
import { runMcpCommand } from "./commands/mcp.js";
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
  .description("启动源码扫描（0day 自动挖掘）")
  .option("--max-files <n>", "最大深度分析文件数", "10")
  .option("--concurrency <n>", "并发数", "3")
  .option("--report", "生成报告文件")
  .action((path, opts) => {
    const cfg = new ConfigManager();
    if (!cfg.requireAccepted()) {
      console.log("❌ 尚未接受免责声明。请先运行: xuanwo setup");
      process.exit(1);
    }
    runScanCommand(path, opts);
  });

program
  .command("analyze <file>")
  .description("深度分析单个文件")
  .action((file) => {
    const cfg = new ConfigManager();
    if (!cfg.requireAccepted()) {
      console.log("❌ 尚未接受免责声明。请先运行: xuanwo setup");
      process.exit(1);
    }
    runAnalyzeCommand(file);
  });

program
  .command("trace <file> <func>")
  .description("跨函数污点追踪")
  .option("--var <vars>", "污点变量（逗号分隔）")
  .option("--sink <hint>", "期望汇点提示")
  .option("--depth <n>", "最大追踪深度")
  .action((file, func, opts) => {
    const cfg = new ConfigManager();
    if (!cfg.requireAccepted()) {
      console.log("❌ 尚未接受免责声明。请先运行: xuanwo setup");
      process.exit(1);
    }
    runTraceCommand(file, func, opts);
  });

program
  .command("report [file]")
  .description("查看审计报告")
  .action((file) => {
    runReportCommand(file);
  });

program
  .command("chain <file>")
  .description("从审计结果生成攻击链（借鉴 CyberStrikeAI）")
  .option("--module <m>", "目标模块")
  .option("--from-report <path>", "从 JSON 报告读取")
  .action((file, opts) => {
    const cfg = new ConfigManager();
    if (!cfg.requireAccepted()) {
      console.log("❌ 尚未接受免责声明。请先运行: xuanwo setup");
      process.exit(1);
    }
    runChainCommand(file, opts);
  });

program
  .command("verify <file>")
  .description("验证闭环：生成复现程序 + ASAN 编译运行确认漏洞")
  .option("--type <类型>", "只验证指定类型")
  .action((file, opts) => {
    const cfg = new ConfigManager();
    if (!cfg.requireAccepted()) {
      console.log("❌ 尚未接受免责声明。请先运行: xuanwo setup");
      process.exit(1);
    }
    runVerifyCommand(file, opts);
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
  .description("启动交互式 TUI（Ink 对话界面 /scan /analyze /knowledge 等）")
  .option("--legacy", "使用轻量 TUI（兼容管道/无 TTY 环境）")
  .action(async (opts) => {
    const cfg = new ConfigManager();
    if (!cfg.requireAccepted()) {
      console.log("❌ 尚未接受免责声明。请先运行: xuanwo setup");
      process.exit(1);
    }
    if ((opts.legacy || !process.stdin.isTTY) && !process.env.XUANWO_INK_FORCE) {
      await runTui();
    } else {
      const { runInkTui } = await import("./ui/ink-index.js");
      await runInkTui();
    }
  });

program
  .command("skill <args...>")
  .description("技能管理: list | validate | <skill-id>")
  .action((args) => {
    runSkillCommand(args);
  });

program
  .command("mcp <args...>")
  .description("MCP 管理: list | add <name> <cmd> | test | use")
  .action((args) => {
    runMcpCommand(args);
  });

program.parse();
