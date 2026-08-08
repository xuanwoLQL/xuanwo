/**
 * MCP Client 封装
 * 连接本地 MCP Server（stdio 或 http），发现工具并注册为 Agent 可调用工具。
 */
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { AgentTool } from "../agent/react.js";

export interface McpServerConfig {
  name: string;
  command: string; // 可执行文件
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string; // http/streamable 模式
}

export interface McpServerInfo {
  name: string;
  tools: Tool[];
  connected: boolean;
}

export class McpClient {
  private client: Client;
  private transport: StdioClientTransport | null = null;
  private proc: ReturnType<typeof spawn> | null = null;
  private tools: Tool[] = [];
  connected = false;

  constructor(public config: McpServerConfig) {
    this.client = new Client(
      { name: "xuanwo", version: "0.1.0" },
      { capabilities: {} }
    );
  }

  async connect(): Promise<void> {
    if (this.config.url) {
      // HTTP/Streamable 模式（预留，阶段八先用 stdio）
      throw new Error("HTTP MCP 模式暂未支持，请配置本地 stdio server");
    }
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args ?? [],
      env: this.config.env,
      cwd: this.config.cwd,
      stderr: "pipe",
    });
    await this.client.connect(this.transport);
    this.connected = true;

    // 发现工具
    const res = await this.client.listTools();
    this.tools = res.tools ?? [];
  }

  /** 已发现工具列表 */
  listTools(): Tool[] {
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const res = await this.client.callTool({ name, arguments: args as never });
    if (res.isError) {
      return `MCP 工具 ${name} 执行错误: ${JSON.stringify(res.content ?? "unknown")}`;
    }
    const content: unknown[] = Array.isArray(res.content) ? res.content : [];
    return content
      .map((c) => {
        const obj = c as { type?: string; text?: string; resource?: unknown };
        if (obj.type === "text") return obj.text ?? "";
        if (obj.type === "resource") return `[resource] ${JSON.stringify(obj.resource)}`;
        return JSON.stringify(c);
      })
      .join("\n");
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      /* ignore */
    }
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
    this.connected = false;
  }
}

/** 将 MCP 工具包装为 Agent 可调用的 AgentTool */
export function toAgentTool(mcp: McpClient, tool: Tool): AgentTool {
  return {
    definition: {
      name: `mcp_${tool.name}`,
      description: `[MCP:${mcp.config.name}] ${tool.description ?? tool.name}`,
      parameters: tool.inputSchema,
    },
    execute: async (args) => mcp.callTool(tool.name, args),
  };
}

/** 创建 MCP server 集合（一个连接池） */
export class McpManager {
  private clients: McpClient[] = [];

  constructor(private servers: McpServerConfig[]) {}

  async connectAll(): Promise<{ name: string; ok: boolean; tools: number; error?: string }[]> {
    const results: { name: string; ok: boolean; tools: number; error?: string }[] = [];
    for (const cfg of this.servers) {
      try {
        const client = new McpClient(cfg);
        await client.connect();
        this.clients.push(client);
        results.push({ name: cfg.name, ok: true, tools: client.listTools().length });
      } catch (e) {
        results.push({ name: cfg.name, ok: false, tools: 0, error: (e as Error).message });
      }
    }
    return results;
  }

  /** 收集所有 MCP 工具为 Agent 工具 */
  allTools(): AgentTool[] {
    const out: AgentTool[] = [];
    for (const c of this.clients) {
      for (const t of c.listTools()) {
        out.push(toAgentTool(c, t));
      }
    }
    return out;
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.clients.map((c) => c.close()));
    this.clients = [];
  }
}
