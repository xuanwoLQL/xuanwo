import { AgentRuntime, McpManager, loadMcpConfig, saveMcpConfig, mcpConfigPath } from "@xuanwo/core";

/** xuanwo mcp list | mcp add <name> <command> | mcp test */
export async function runMcpCommand(args: string[]) {
  const action = args[0] ?? "list";

  switch (action) {
    case "list": {
      const servers = loadMcpConfig();
      if (servers.length === 0) {
        console.log("未配置 MCP server。配置路径: " + mcpConfigPath());
        console.log("示例: xuanwo mcp add my-fs node C:/path/server.js");
        return;
      }
      console.log(`MCP servers (${servers.length}):`);
      servers.forEach((s) => {
        console.log(`  ${s.name} — ${s.command} ${(s.args ?? []).join(" ")}`);
      });
      return;
    }
    case "add": {
      const name = args[1];
      const command = args[2];
      if (!name || !command) {
        console.error("用法: xuanwo mcp add <name> <command> [args...]");
        process.exit(1);
      }
      const servers = loadMcpConfig();
      servers.push({ name, command, args: args.slice(3) });
      saveMcpConfig(servers);
      console.log(`已添加 MCP server: ${name}`);
      return;
    }
    case "test": {
      const servers = loadMcpConfig();
      if (servers.length === 0) {
        console.log("无 MCP server 可测试");
        return;
      }
      const mgr = new McpManager(servers);
      const results = await mgr.connectAll();
      console.log("MCP 连接测试:");
      results.forEach((r) => {
        console.log(`  ${r.name}: ${r.ok ? `OK (${r.tools} tools)` : `FAIL ${r.error ?? ""}`}`);
      });
      if (results.some((r) => r.ok)) {
        console.log("\n可用 MCP 工具（前缀 mcp_）：");
        mgr.allTools().forEach((t) => {
          console.log(`  ${t.definition.name}: ${t.definition.description.slice(0, 80)}`);
        });
      }
      await mgr.closeAll();
      return;
    }
    case "agent":
    case "use": {
      // 用 MCP 工具测试智能体集成
      const runtime = await AgentRuntime.create();
      const mcpTools = runtime.mcpManager ? runtime.mcpManager.allTools() : [];
      console.log(`MCP 工具已注册到智能体: ${mcpTools.length} 个`);
      runtime.orchestrator.listTools().forEach((t) => {
        if (t.startsWith("mcp_")) console.log(`  ${t}`);
      });
      return;
    }
    default:
      console.error("用法: xuanwo mcp <list|add|test|use>");
      process.exit(1);
  }
}
