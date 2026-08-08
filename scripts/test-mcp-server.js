/**
 * 测试 MCP Server：提供文件统计/读取工具
 * 用于验证 xuanwo 的 MCP Client 集成。
 * 运行: node scripts/test-mcp-server.js
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const server = new McpServer({
  name: "xuanwo-test-server",
  version: "0.1.0",
});

server.registerTool(
  "file_info",
  {
    title: "获取文件信息",
    description: "返回文件的路径、大小、字节数",
    inputSchema: { path: z.string().describe("文件绝对路径") },
  },
  async (params) => {
    const abs = resolve(params.path);
    const st = statSync(abs);
    return {
      content: [{ type: "text", text: `文件: ${abs}\n大小: ${st.size} 字节` }],
    };
  }
);

server.registerTool(
  "file_head",
  {
    title: "读取文件头部",
    description: "读取文件前 N 行",
    inputSchema: {
      path: z.string().describe("文件绝对路径"),
      lines: z.number().optional().describe("读取行数，默认 5"),
    },
  },
  async (params) => {
    const abs = resolve(params.path);
    const text = readFileSync(abs, "utf8");
    const head = text.split("\n").slice(0, params.lines ?? 5).join("\n");
    return {
      content: [{ type: "text", text: head }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
